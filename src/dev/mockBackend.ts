// Dev-only in-memory stand-in for the Rust backend, used when the UI is
// opened in a normal browser (`npm run dev`) instead of inside Tauri.
// Mirrors the semantics of src-tauri/src/db.rs closely enough for UI work.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Folder, Item, ItemQuery, Tag } from "../lib/api";

type MockItem = Omit<Item, "filePath" | "thumbPath"> & { hue: number };

const items: MockItem[] = [];
const folders: Omit<Folder, "count">[] = [];
const tags: { id: number; name: string }[] = [];
// `${itemId}|${folderId}` -> manual position
const itemFolders = new Map<string, number>();
let posSeq = 0;
const link = (i: string, f: string) => {
  const k = `${i}|${f}`;
  if (!itemFolders.has(k)) itemFolders.set(k, ++posSeq);
};
const itemTags = new Set<string>(); // `${itemId}|${tagId}`
let tagSeq = 0;
let uid = 0;
const id = () => `m${(++uid).toString(36)}`;

function seed() {
  const sizes = [
    [800, 600],
    [600, 800],
    [1200, 500],
    [700, 700],
  ];
  for (let i = 0; i < 120; i++) {
    const [width, height] = sizes[i % 4];
    items.push({
      id: id(),
      name: `sample-${String(i).padStart(3, "0")}.jpg`,
      fileName: `sample-${i}.jpg`,
      ext: "jpg",
      width,
      height,
      size: 40_000 + i * 997,
      thumb: "",
      note: "",
      rating: i % 7 === 0 ? 3 : i % 11 === 0 ? 5 : 0,
      importedAt: Date.now() - (120 - i) * 60_000,
      deletedAt: null,
      hue: (i * 47) % 360,
    });
  }
  const animals = { id: id(), parentId: null, name: "動物" };
  folders.push(animals, { id: id(), parentId: animals.id, name: "ねこ" }, { id: id(), parentId: null, name: "風景" });
  items.slice(0, 30).forEach((it) => link(it.id, animals.id));
  items.slice(30, 36).forEach((it) => link(it.id, folders[1].id));
  addTags(items.slice(0, 40).map((i) => i.id), ["参考"]);
  addTags(items.slice(20, 60).map((i) => i.id), ["ブルー", "背景"]);
  // Look-alikes for the similar view: smaller re-saves of a few images.
  for (const [src, n] of [[3, 1], [10, 2], [57, 1]] as const) {
    const orig = items[src];
    for (let k = 1; k <= n; k++) {
      items.push({
        ...orig,
        id: id(),
        name: orig.name.replace(".jpg", k > 1 ? ` (コピー ${k}).jpg` : " (コピー).jpg"),
        width: Math.round(orig.width / (k + 1)),
        height: Math.round(orig.height / (k + 1)),
        size: Math.round(orig.size / (k + 1)),
        rating: 0,
        importedAt: orig.importedAt + k * 1000,
      });
    }
  }
}

/** Mock stand-in for the perceptual hash: same colours and shape = look-alike. */
function similar(r: MockItem[]): MockItem[] {
  const key = (i: MockItem) => `${i.hue}|${(i.width / i.height).toFixed(2)}`;
  const groups = new Map<string, MockItem[]>();
  r.forEach((i) => groups.set(key(i), [...(groups.get(key(i)) ?? []), i]));
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .flatMap((g, n) =>
      [...g]
        .sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size)
        .map((i) => ({ ...i, group: n })),
    );
}

function svg(it: MockItem, scale: number) {
  const w = Math.round(it.width / scale);
  const h = Math.round(it.height / scale);
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${it.hue},60%,35%)"/><stop offset="1" stop-color="hsl(${(it.hue + 60) % 360},70%,60%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" font-family="sans-serif" font-size="${w / 10}" fill="white" text-anchor="middle" dominant-baseline="middle">${it.name}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

const view = (it: MockItem): Item => ({ ...it, filePath: svg(it, 1), thumbPath: svg(it, 3) });
const inFolder = (i: string, f: string) => itemFolders.has(`${i}|${f}`);
const hasTag = (i: string, t: number) => itemTags.has(`${i}|${t}`);
const live = () => items.filter((i) => i.deletedAt === null);

function addTags(ids: string[], names: string[]) {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let t = tags.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) tags.push((t = { id: ++tagSeq, name }));
    ids.forEach((i) => itemTags.add(`${i}|${t!.id}`));
  }
}

function descendants(fid: string): string[] {
  return [fid, ...folders.filter((f) => f.parentId === fid).flatMap((f) => descendants(f.id))];
}

// Simplified search (AND + "-exclude"); the real parser lives in src-tauri/src/search.rs.
function query(q: ItemQuery): Item[] {
  let r = q.view.kind === "trash" ? items.filter((i) => i.deletedAt !== null) : live();
  const v = q.view;
  if (v.kind === "unfiled") r = r.filter((i) => !folders.some((f) => inFolder(i.id, f.id)));
  if (v.kind === "untagged") r = r.filter((i) => !tags.some((t) => hasTag(i.id, t.id)));
  if (v.kind === "folder") {
    const ids = q.includeSubfolders ? descendants(v.id) : [v.id];
    r = r.filter((i) => ids.some((f) => inFolder(i.id, f)));
  }
  for (const raw of q.search.toLowerCase().split(/\s+/).filter(Boolean)) {
    const neg = raw.startsWith("-") && raw.length > 1;
    const w = neg ? raw.slice(1) : raw;
    const hit = (i: MockItem) =>
      i.name.toLowerCase().includes(w) ||
      i.note.toLowerCase().includes(w) ||
      tags.some((t) => hasTag(i.id, t.id) && t.name.toLowerCase().includes(w));
    r = r.filter((i) => hit(i) !== neg);
  }
  if (q.tagIds.length) {
    const need = q.tagMatchAll ? q.tagIds.length : 1;
    r = r.filter((i) => q.tagIds.filter((t) => hasTag(i.id, t)).length >= need);
  }
  if (q.minRating) r = r.filter((i) => i.rating >= q.minRating);
  if (q.sort === "manual" && v.kind === "folder") {
    const pos = (i: MockItem) => itemFolders.get(`${i.id}|${v.id}`) ?? Infinity;
    return [...r].sort((a, b) => pos(a) - pos(b)).map(view);
  }
  const key = (i: MockItem): number | string =>
    q.sort === "name"
      ? i.name.toLowerCase()
      : q.sort === "size"
        ? i.size
        : q.sort === "dimensions"
          ? i.width * i.height
          : q.sort === "rating"
            ? i.rating
            : i.importedAt;
  r = [...r].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (q.desc ? -1 : 1));
  return (v.kind === "similar" ? similar(r) : r).map(view);
}

function removeFolder(fid: string) {
  folders.filter((f) => f.parentId === fid).forEach((f) => removeFolder(f.id));
  folders.splice(folders.findIndex((f) => f.id === fid), 1);
  [...itemFolders.keys()].filter((k) => k.endsWith(`|${fid}`)).forEach((k) => itemFolders.delete(k));
}

function handle(cmd: string, a: any): unknown {
  switch (cmd) {
    case "open_last_library":
    case "create_library":
    case "open_library":
      return { root: "/mock/Demo.library", name: "Demo (mock)" };
    case "query_items":
      return query(a.query);
    case "get_counts":
      return {
        all: live().length,
        unfiled: live().filter((i) => !folders.some((f) => inFolder(i.id, f.id))).length,
        untagged: live().filter((i) => !tags.some((t) => hasTag(i.id, t.id))).length,
        trash: items.length - live().length,
      };
    case "selection_info": {
      const ids: string[] = a.ids;
      return {
        tags: tags
          .map((t) => ({ ...t, count: ids.filter((i) => hasTag(i, t.id)).length }))
          .filter((t) => t.count > 0),
        folders: folders
          .map((f) => ({ id: f.id, count: ids.filter((i) => inFolder(i, f.id)).length }))
          .filter((f) => f.count > 0),
      };
    }
    case "set_note":
      items.find((i) => i.id === a.id)!.note = a.note;
      return;
    case "rename_item":
      items.find((i) => i.id === a.id)!.name = a.name;
      return;
    case "trash_items":
      items.filter((i) => a.ids.includes(i.id)).forEach((i) => (i.deletedAt ??= Date.now()));
      return;
    case "restore_items":
      items.filter((i) => a.ids.includes(i.id)).forEach((i) => (i.deletedAt = null));
      return;
    case "delete_items":
    case "empty_trash": {
      const del = cmd === "empty_trash" ? items.filter((i) => i.deletedAt !== null).map((i) => i.id) : a.ids;
      for (const d of del) items.splice(items.findIndex((i) => i.id === d), 1);
      return;
    }
    case "reveal_item":
    case "open_items":
      return;
    case "set_rating":
      items.filter((i) => a.ids.includes(i.id)).forEach((i) => (i.rating = Math.min(5, a.rating)));
      return;
    case "copy_items":
    case "export_items":
      return a.ids.length;
    case "index_similar":
      return 0;
    case "resolve_duplicates":
      for (const g of a.groups as { keep: string; remove: string[] }[]) {
        const keep = items.find((i) => i.id === g.keep)!;
        for (const rid of g.remove) {
          const it = items.find((i) => i.id === rid)!;
          tags.forEach((t) => hasTag(rid, t.id) && itemTags.add(`${keep.id}|${t.id}`));
          folders.forEach((f) => inFolder(rid, f.id) && link(keep.id, f.id));
          keep.rating = Math.max(keep.rating, it.rating);
          it.deletedAt ??= Date.now();
        }
      }
      return;
    case "supported_exts":
      return ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
    case "import_paths":
    case "import_bytes":
      return { imported: 0, duplicates: 0, failed: ["mock backend: import is not available in the browser"] };
    case "list_folders":
      return [...folders]
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((f) => ({ ...f, count: live().filter((i) => inFolder(i.id, f.id)).length }));
    case "create_folder": {
      const f = { id: id(), parentId: a.parentId ?? null, name: a.name };
      folders.push(f);
      return f.id;
    }
    case "rename_folder":
      folders.find((f) => f.id === a.id)!.name = a.name;
      return;
    case "delete_folder":
      removeFolder(a.id);
      return;
    case "move_folder": {
      for (let c: string | null = a.parentId; c; c = folders.find((f) => f.id === c)?.parentId ?? null) {
        if (c === a.id) return false;
      }
      folders.find((f) => f.id === a.id)!.parentId = a.parentId ?? null;
      return true;
    }
    case "add_to_folder":
      a.ids.forEach((i: string) => link(i, a.folderId));
      return;
    case "reorder_in_folder": {
      const order = [...itemFolders.entries()]
        .filter(([k]) => k.endsWith(`|${a.folderId}`))
        .sort((x, y) => x[1] - y[1])
        .map(([k]) => k.split("|")[0])
        .filter((id) => !a.ids.includes(id));
      const at = a.before ? order.indexOf(a.before) : -1;
      order.splice(at < 0 ? order.length : at, 0, ...a.ids);
      order.forEach((id, n) => itemFolders.set(`${id}|${a.folderId}`, n + 1));
      return;
    }
    case "remove_from_folder":
      a.ids.forEach((i: string) => itemFolders.delete(`${i}|${a.folderId}`));
      return;
    case "list_tags":
      return [...tags]
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((t) => ({ ...t, count: live().filter((i) => hasTag(i.id, t.id)).length })) satisfies Tag[];
    case "add_tags":
      addTags(a.ids, a.names);
      return;
    case "remove_tag":
      a.ids.forEach((i: string) => itemTags.delete(`${i}|${a.tagId}`));
      return;
    case "rename_tag": {
      const t = tags.find((x) => x.id === a.id)!;
      const other = tags.find((x) => x.id !== a.id && x.name.toLowerCase() === a.name.trim().toLowerCase());
      if (other) {
        [...itemTags].filter((k) => k.endsWith(`|${t.id}`)).forEach((k) => {
          itemTags.delete(k);
          itemTags.add(`${k.split("|")[0]}|${other.id}`);
        });
        tags.splice(tags.indexOf(t), 1);
      } else t.name = a.name.trim();
      return;
    }
    case "delete_tag":
      tags.splice(tags.findIndex((t) => t.id === a.id), 1);
      [...itemTags].filter((k) => k.endsWith(`|${a.id}`)).forEach((k) => itemTags.delete(k));
      return;
    case "plugin:dialog|ask":
    case "plugin:dialog|confirm":
      return window.confirm(a.message);
    case "plugin:dialog|open":
    case "plugin:dialog|save":
      return null;
    default:
      console.warn("[mock] unhandled command", cmd, a);
      return null;
  }
}

export function installMockBackend() {
  seed();
  mockWindows("main");
  mockIPC((cmd, payload) => handle(cmd, payload), { shouldMockEvents: true });
  // Thumbnails are data: URLs already; pass them through untouched.
  (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = (p) => p;
  (window as unknown as { __MOCK_BACKEND__: boolean }).__MOCK_BACKEND__ = true;
  console.info("[mock] in-memory backend installed");
}
