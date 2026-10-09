// Dev-only in-memory stand-in for the Rust backend, used when the UI is
// opened in a normal browser (`npm run dev`) instead of inside Tauri.
// Mirrors the semantics of src-tauri/src/db.rs closely enough for UI work.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Folder, Item, ItemQuery, Rule, SimilarLevel, Tag } from "../lib/api";

type MockItem = Omit<
  Item,
  | "filePath"
  | "thumbPath"
  | "displayPath"
  | "preview"
  | "folderId"
  | "tagIds"
  | "sourceUrl"
  | "fontFamily"
  | "fontWeight"
  | "fontScript"
  | "fontCategory"
  | "fontCategoryUser"
  | "inTray"
> & {
  hue: number;
  sourceUrl?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontScript?: string;
  fontCategory?: string | null;
  fontCategoryUser?: string | null;
};

const items: MockItem[] = [];
const folders: Omit<Folder, "count">[] = [];
const tags: { id: number; name: string; color: string | null }[] = [];
// `${itemId}|${folderId}` -> manual position
const itemFolders = new Map<string, number>();
let posSeq = 0;
// An item is in at most one folder; linking moves it.
const link = (i: string, f: string) => {
  if (itemFolders.has(`${i}|${f}`)) return;
  [...itemFolders.keys()].filter((k) => k.startsWith(`${i}|`)).forEach((k) => itemFolders.delete(k));
  itemFolders.set(`${i}|${f}`, ++posSeq);
};
const itemTags = new Set<string>(); // `${itemId}|${tagId}`
// Work tray: item id -> position.
const tray = new Map<string, number>();
let traySeq = 0;
const smartFolders: { id: string; name: string; rule: Rule; color: string | null }[] = [];
const EXTS = ["jpg", "png", "jpg", "webp", "jpg", "heic"];
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
    const ext = EXTS[i % EXTS.length];
    items.push({
      id: id(),
      kind: "image",
      name: `sample-${String(i).padStart(3, "0")}.${ext}`,
      fileName: `sample-${i}.${ext}`,
      ext,
      width: width * (1 + (i % 3)),
      height: height * (1 + (i % 3)),
      size: 40_000 + i * 997 * (i % 9) * 30,
      thumb: "",
      note: "",
      rating: i % 7 === 0 ? 3 : i % 11 === 0 ? 5 : i % 5 === 0 ? 1 : 0,
      importedAt: Date.now() - (120 - i) * 60_000,
      deletedAt: null,
      favorite: i % 13 === 0,
      pinnedAt: i === 8 ? Date.now() - 1000 : i === 21 ? Date.now() : null,
      rotation: 0,
      flipped: false,
      hue: (i * 47) % 360,
      ...(i % 6 === 1 ? { sourceUrl: `https://www.example.com/gallery/${i}?ref=web` } : {}),
    });
  }
  // Fonts: no pixel size, a sample as the thumbnail. Noto Sans JP comes as
  // one file per weight (grouped by family), Inter as one variable font.
  const fontFiles: [string, string, number, string, string | null][] = [
    ["NotoSansJP-Bold.ttf", "Noto Sans JP", 700, "ja", "gothic"],
    ["NotoSansJP-Regular.ttf", "Noto Sans JP", 400, "ja", "gothic"],
    ["Inter[wght].woff2", "Inter", 400, "latin", "gothic"],
    ["Hiragino.ttc", "ヒラギノ角ゴシック", 300, "ja", "gothic"],
    ["NotoSansJP-Light.ttf", "Noto Sans JP", 300, "ja", "gothic"],
    ["NotoSerifJP-Regular.otf", "Noto Serif JP", 400, "ja", "mincho"],
    ["Garamond-Regular.otf", "EB Garamond", 400, "latin", "mincho"],
    ["JetBrainsMono-Regular.ttf", "JetBrains Mono", 400, "latin", "mono"],
    ["keifont.ttf", "けいふぉんと", 400, "ja", null],
  ];
  for (const [i, [file, fontFamily, fontWeight, fontScript, fontCategory]] of fontFiles.entries()) {
    items.push({
      fontFamily,
      fontWeight,
      fontScript,
      fontCategory,
      id: id(),
      kind: "font",
      name: file,
      fileName: file,
      ext: file.split(".").pop()!,
      width: 0,
      height: 0,
      size: 300_000 * (i + 1),
      thumb: "",
      note: "",
      rating: 0,
      importedAt: Date.now() - 30_000 + i,
      deletedAt: null,
      favorite: false,
      pinnedAt: null,
      rotation: 0,
      flipped: false,
      hue: 0,
    });
  }
  // Files: PDF and office documents, 0 × 0 like fonts.
  const docFiles = ["企画書.pdf", "議事録 2026-10.docx", "売上集計.xlsx", "提案資料.pptx", "カタログ.pdf", "メモ.pages", "発表.key", "旧仕様書.doc"];
  for (const [i, file] of docFiles.entries()) {
    items.push({
      id: id(),
      kind: "file",
      name: file,
      fileName: file,
      ext: file.split(".").pop()!,
      width: 0,
      height: 0,
      size: 180_000 * (i + 2),
      thumb: "",
      note: "",
      rating: i === 0 ? 4 : 0,
      importedAt: Date.now() - 20_000 + i,
      deletedAt: null,
      favorite: i === 1,
      pinnedAt: null,
      rotation: 0,
      flipped: false,
      hue: (i * 67) % 360,
    });
  }
  const animals = { id: id(), parentId: null, name: "動物", color: "orange" };
  folders.push(
    animals,
    { id: id(), parentId: animals.id, name: "ねこ", color: null },
    { id: id(), parentId: null, name: "風景", color: "green" },
  );
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
        name: orig.name.replace(/\.(\w+)$/, k > 1 ? ` (コピー ${k}).$1` : " (コピー).$1"),
        width: Math.round(orig.width / (k + 1)),
        height: Math.round(orig.height / (k + 1)),
        size: Math.round(orig.size / (k + 1)),
        rating: 0,
        favorite: false,
        pinnedAt: null,
        importedAt: orig.importedAt + k * 1000,
      });
    }
  }
}

/** Pairs dismissed as "not duplicates": "a|b" (a < b) -> batch number (one per dismiss action). */
const dismissed = new Map<string, number>();
let dismissSeq = 0;
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const pairsOf = (ids: string[]) => ids.flatMap((x, k) => ids.slice(k + 1).map((y) => pairKey(x, y)));

/** Mock stand-in for the perceptual hash: same colours and shape = look-alike. */
function similar(r: MockItem[], level: SimilarLevel): MockItem[] {
  const key = (i: MockItem) =>
    level === "loose"
      ? `${Math.round(i.hue / 20)}|${(i.width / i.height).toFixed(1)}`
      : `${i.hue}|${(i.width / i.height).toFixed(2)}`;
  const groups = new Map<string, MockItem[]>();
  r.forEach((i) => groups.set(key(i), [...(groups.get(key(i)) ?? []), i]));
  return [...groups.values()]
    .map((g) =>
      [...g].sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size),
    )
    // Strict: only copies that are barely smaller than the best one.
    .map((g) => (level === "strict" ? g.filter((i) => i.width >= g[0].width / 2.2) : g))
    .filter((g) => g.length > 1)
    // Simplified: a group disappears once every pair in it was dismissed.
    .filter((g) => !pairsOf(g.map((i) => i.id)).every((p) => dismissed.has(p)))
    .flatMap((g, n) =>
      g.map((i) => ({ ...i, group: n, distance: Math.round(Math.log2(g[0].width / i.width) * 4) })),
    );
}

/** Font thumbnail: "Aa" and a line of sample text, like fonts.rs renders it. */
function fontSvg(it: MockItem) {
  const weight = it.fontWeight ?? 400;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384"><rect width="100%" height="100%" fill="#f4f4f5"/><g font-family="sans-serif" font-weight="${weight}" fill="#18181b" text-anchor="middle"><text x="256" y="215" font-size="170">Aa</text><text x="256" y="320" font-size="52">${it.fontScript === "ja" ? "あア永" : "ABC abc 123"}</text></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

/** File thumbnail: a page (PDF / Word / Pages), a slide or a sheet, roughly what Quick Look gives. */
function fileSvg(it: MockItem) {
  const wide = ["ppt", "pptx", "key"].includes(it.ext);
  const [w, h] = wide ? [512, 288] : [362, 512];
  const lines = Array.from({ length: wide ? 3 : 14 }, (_, k) => {
    const y = (wide ? 150 : 110) + k * (wide ? 30 : 26);
    return `<rect x="${wide ? 60 : 40}" y="${y}" width="${(wide ? 300 : 280) - ((k * 37) % 90)}" height="${wide ? 12 : 8}" rx="3" fill="#c4c4cc"/>`;
  }).join("");
  const head = `<rect x="${wide ? 60 : 40}" y="${wide ? 70 : 50}" width="${wide ? 320 : 200}" height="${wide ? 40 : 22}" rx="4" fill="hsl(${it.hue},55%,45%)"/>`;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/>${head}${lines}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

/** A one-page PDF with the item's name, for the viewer's PDF frame. */
function pdfData(it: MockItem) {
  const text = `BT /F1 28 Tf 72 760 Td (${it.name.replace(/[^\x20-\x7e]/g, "?")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, k) => {
    offsets.push(out.length);
    out += `${k + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${btoa(out)}`;
}

/** The "file" (unrotated), or with `oriented` the thumbnail showing the item's rotation / flip. */
function svg(it: MockItem, scale: number, oriented = false) {
  const sideways = it.rotation % 2 === 1;
  const ow = Math.round((sideways ? it.height : it.width) / scale);
  const oh = Math.round((sideways ? it.width : it.height) / scale);
  const body = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${it.hue},60%,35%)"/><stop offset="1" stop-color="hsl(${(it.hue + 60) % 360},70%,60%)"/></linearGradient></defs><rect width="${ow}" height="${oh}" fill="url(#g)"/><text x="${ow / 2}" y="${oh / 2}" font-family="sans-serif" font-size="${ow / 10}" fill="white" text-anchor="middle" dominant-baseline="middle">${it.name}</text>`;
  const [w, h] = oriented && sideways ? [oh, ow] : [ow, oh];
  // Flip first, then rotate (as in orient.rs); SVG applies the list right to left.
  const t = `translate(${w / 2} ${h / 2}) rotate(${oriented ? it.rotation * 90 : 0}) scale(${oriented && it.flipped ? -1 : 1} 1) translate(${-ow / 2} ${-oh / 2})`;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g transform="${t}">${body}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

/** The mock image drawn to PNG data, as the real command hands it out. */
async function sheetImage(it: MockItem, maxSide: number): Promise<ArrayBuffer> {
  const img = new Image();
  img.src = it.kind === "font" ? fontSvg(it) : it.kind === "file" ? fileSvg(it) : svg(it, 1, true);
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
  return blob.arrayBuffer();
}

const view = (it: MockItem): Item => {
  const filePath = it.kind === "file" ? (it.ext === "pdf" ? pdfData(it) : fileSvg(it)) : svg(it, 1);
  const folderId = folders.find((f) => inFolder(it.id, f.id))?.id ?? null;
  const tagIds = tags.filter((t) => hasTag(it.id, t.id)).map((t) => t.id);
  const thumbPath = it.kind === "font" ? fontSvg(it) : it.kind === "file" ? fileSvg(it) : svg(it, 3, true);
  return {
    ...it,
    sourceUrl: it.sourceUrl ?? null,
    fontFamily: it.fontFamily ?? null,
    fontWeight: it.fontWeight ?? null,
    fontScript: it.fontScript ?? null,
    fontCategory: it.fontCategory ?? null,
    fontCategoryUser: it.fontCategoryUser ?? null,
    inTray: tray.has(it.id),
    preview: null,
    folderId,
    tagIds,
    filePath,
    displayPath: filePath,
    thumbPath,
  };
};
const inFolder = (i: string, f: string) => itemFolders.has(`${i}|${f}`);
const hasTag = (i: string, t: number) => itemTags.has(`${i}|${t}`);
const live = () => items.filter((i) => i.deletedAt === null);

function addTags(ids: string[], names: string[]) {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let t = tags.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) tags.push((t = { id: ++tagSeq, name, color: name === "参考" ? "blue" : null }));
    ids.forEach((i) => itemTags.add(`${i}|${t!.id}`));
  }
}

function descendants(fid: string): string[] {
  return [fid, ...folders.filter((f) => f.parentId === fid).flatMap((f) => descendants(f.id))];
}

const aliases = (e: string) =>
  ({ jpeg: "jpg", tiff: "tif", heif: "heic" })[e.toLowerCase()] ?? e.toLowerCase();

// Simplified search (AND + "-exclude"); the real parser lives in src-tauri/src/search.rs.
function applyRule(r: MockItem[], rule: Rule): MockItem[] {
  for (const raw of rule.search.toLowerCase().split(/\s+/).filter(Boolean)) {
    const neg = raw.startsWith("-") && raw.length > 1;
    const w = neg ? raw.slice(1) : raw;
    const hit = (i: MockItem) =>
      i.name.toLowerCase().includes(w) ||
      i.note.toLowerCase().includes(w) ||
      (i.fontFamily ?? "").toLowerCase().includes(w) ||
      tags.some((t) => hasTag(i.id, t.id) && t.name.toLowerCase().includes(w));
    r = r.filter((i) => hit(i) !== neg);
  }
  const tagIds = rule.tagIds.filter((t) => tags.some((x) => x.id === t));
  if (tagIds.length) {
    const need = rule.tagMatchAll ? tagIds.length : 1;
    r = r.filter((i) => tagIds.filter((t) => hasTag(i.id, t)).length >= need);
  }
  if (rule.minRating) r = r.filter((i) => i.rating >= rule.minRating);
  const f = rule.filter;
  if (!f) return r;
  if (f.kinds?.length) r = r.filter((i) => f.kinds.includes(i.kind));
  if (f.fontScripts?.length) r = r.filter((i) => i.kind === "font" && f.fontScripts.includes(i.fontScript ?? ""));
  if (f.fontCategories?.length)
    r = r.filter(
      (i) => i.kind === "font" && f.fontCategories.includes(i.fontCategoryUser ?? i.fontCategory ?? "none"),
    );
  if (f.exts.length) r = r.filter((i) => f.exts.map(aliases).includes(aliases(i.ext)));
  // Shape and pixel size only apply to images (fonts are 0 × 0), as in db.rs.
  const sized = f.shapes.length || [f.minWidth, f.maxWidth, f.minHeight, f.maxHeight].some((v) => v != null);
  if (sized) r = r.filter((i) => i.kind === "image");
  if (f.shapes.length) {
    r = r.filter((i) =>
      f.shapes.some((s) =>
        s === "landscape"
          ? i.width > i.height * 1.05
          : s === "portrait"
            ? i.height > i.width * 1.05
            : i.width <= i.height * 1.05 && i.height <= i.width * 1.05,
      ),
    );
  }
  const within = (v: number, min: number | null, max: number | null) =>
    (min == null || v >= min) && (max == null || v <= max);
  return r.filter(
    (i) =>
      within(i.width, f.minWidth, f.maxWidth) &&
      within(i.height, f.minHeight, f.maxHeight) &&
      within(i.size, f.minSize, f.maxSize) &&
      (f.importedAfter == null || i.importedAt >= f.importedAfter) &&
      (f.importedBefore == null || i.importedAt < f.importedBefore),
  );
}

/** Puts `fid` among the children of `parent`, before sibling `before` (null = last). */
function placeFolder(fid: string, parent: string | null, before: string | null): boolean {
  for (let c: string | null = parent; c; c = folders.find((f) => f.id === c)?.parentId ?? null) {
    if (c === fid) return false;
  }
  const f = folders.splice(folders.findIndex((x) => x.id === fid), 1)[0];
  f.parentId = parent;
  const at = before ? folders.findIndex((x) => x.id === before) : -1;
  folders.splice(at < 0 ? folders.length : at, 0, f);
  return true;
}

/** Rewrites the order of `parent`'s children (array order = sibling order). */
function reorderSiblings(parent: string | null, order: (sibs: typeof folders) => typeof folders) {
  const slots = folders.map((f, i) => (f.parentId === parent ? i : -1)).filter((i) => i >= 0);
  const next = order(slots.map((i) => folders[i]));
  slots.forEach((slot, k) => (folders[slot] = next[k]));
}

function query(q: ItemQuery): Item[] {
  let r = q.view.kind === "trash" ? items.filter((i) => i.deletedAt !== null) : live();
  const v = q.view;
  if (v.kind === "unfiled") r = r.filter((i) => !folders.some((f) => inFolder(i.id, f.id)));
  if (v.kind === "untagged") r = r.filter((i) => !tags.some((t) => hasTag(i.id, t.id)));
  if (v.kind === "favorites") r = r.filter((i) => i.favorite);
  if (v.kind === "pinned") r = r.filter((i) => i.pinnedAt !== null);
  if (v.kind === "tray") r = r.filter((i) => tray.has(i.id));
  if (v.kind === "folder") {
    const ids = q.includeSubfolders ? descendants(v.id) : [v.id];
    r = r.filter((i) => ids.some((f) => inFolder(i.id, f)));
  }
  r = applyRule(r, q);
  if (v.kind === "smart") {
    const sf = smartFolders.find((f) => f.id === v.id);
    r = sf ? applyRule(r, sf.rule) : [];
  }
  // Pinned items lead every list, latest pin first.
  const pin = (a: MockItem, b: MockItem) => (b.pinnedAt ?? -Infinity) - (a.pinnedAt ?? -Infinity);
  // The tray's own order ignores pins, as in db.rs.
  if (q.sort === "manual" && v.kind === "tray") {
    return [...r].sort((a, b) => tray.get(a.id)! - tray.get(b.id)!).map(view);
  }
  if (q.sort === "manual" && v.kind === "folder") {
    const pos = (i: MockItem) => itemFolders.get(`${i.id}|${v.id}`) ?? Infinity;
    return [...r].sort((a, b) => pin(a, b) || pos(a) - pos(b)).map(view);
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
  r = [...r].sort((a, b) => pin(a, b) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (q.desc ? -1 : 1));
  return (v.kind === "similar" ? similar(r, q.similarLevel ?? "standard") : r).map(view);
}

function removeFolder(fid: string) {
  folders.filter((f) => f.parentId === fid).forEach((f) => removeFolder(f.id));
  folders.splice(folders.findIndex((f) => f.id === fid), 1);
  [...itemFolders.keys()].filter((k) => k.endsWith(`|${fid}`)).forEach((k) => itemFolders.delete(k));
}

const mockLibraries = [
  { root: "/mock/Demo.library", name: "Demo (mock)", favorite: true, lastOpened: 3, exists: true, current: true },
  { root: "/Users/me/Pictures/Fonts.library", name: "Fonts", favorite: false, lastOpened: 2, exists: true, current: false },
  { root: "/Volumes/Archive/Old.library", name: "Old", favorite: false, lastOpened: 1, exists: false, current: false },
];

// library.db `settings` (JSON by key) and settings.json's app settings.
const librarySettings: Record<string, unknown> = {};
const appSettings = { startup: "last", autoUpdate: true };

const webImport = { enabled: false, running: false, port: 41620, error: null, extensionDir: null as string | null };
const mcp = { enabled: false, running: false, port: 41621, error: null, token: "mock-token" };
const claudeChanges = [
  { id: 2, at: Date.now() - 60_000, source: "mcp", summary: "フォルダへ移しました（「写真/旅行/京都」4 件）", undone: false },
  { id: 1, at: Date.now() - 120_000, source: "mcp", summary: "タグを付けました（「京都」4 件、「東京」2 件）", undone: false },
];

function mcpStatus() {
  const on = mcp.enabled;
  return {
    enabled: on,
    running: mcp.running,
    port: mcp.port,
    error: mcp.error,
    claudeCodeCommand: on
      ? `claude mcp add --scope user --transport http image-library http://127.0.0.1:41621/mcp --header "Authorization: Bearer ${mcp.token}"`
      : null,
    desktopConfig: on
      ? JSON.stringify({ mcpServers: { "image-library": { command: "/Applications/Image Library.app/Contents/MacOS/image-library", args: ["--mcp"] } } }, null, 2)
      : null,
  };
}

function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}

/** Keeps items of `kind` (all when null), like the `kind` argument in db.rs. */
const ofKind = (kind: string | null | undefined) => (xs: MockItem[]) =>
  kind ? xs.filter((i) => i.kind === kind) : xs;

// The menu bar (src/lib/menuBar.ts): items by resource id, and the menu set
// as the app menu, for checking its structure in the browser
// (`window.__MOCK_MENU__()` prints it as text).
const menuItems = new Map<number, { kind: string; options: any }>();
let menuSeq = 0;
let appMenu: number | null = null;
function menuText(rid: number, depth = 0): string[] {
  const m = menuItems.get(rid);
  if (!m) return [];
  const o = m.options ?? {};
  const pad = "  ".repeat(depth);
  const flags = `${o.enabled === false ? " [off]" : ""}${o.checked ? " ✓" : ""}${o.accelerator ? `  <${o.accelerator}>` : ""}`;
  const name = m.kind === "Predefined" ? `(${typeof o.item === "string" ? o.item : "About"})` : (o.text ?? "");
  const head = m.kind === "Menu" ? [] : [`${pad}${name}${flags}`];
  const kids = (o.items ?? []).flatMap((i: [number, string]) => menuText(i[0], m.kind === "Menu" ? depth : depth + 1));
  return [...head, ...kids];
}
(window as unknown as { __MOCK_MENU__: () => string }).__MOCK_MENU__ = () =>
  appMenu === null ? "(no menu)" : menuText(appMenu).join("\n");

function handle(cmd: string, a: any): unknown {
  if (cmd.startsWith("plugin:menu|")) {
    const op = cmd.slice("plugin:menu|".length);
    if (op === "new") {
      const rid = ++menuSeq;
      menuItems.set(rid, { kind: a.kind, options: a.options });
      return [rid, `m${rid}`];
    }
    if (op === "set_as_app_menu") {
      appMenu = a.rid;
      return null;
    }
    const item = menuItems.get(a.rid);
    if (item && op === "set_text") item.options.text = a.text;
    if (item && op === "set_enabled") item.options.enabled = a.enabled;
    if (item && op === "set_checked") item.options.checked = a.checked;
    return null;
  }
  switch (cmd) {
    case "open_last_library":
    case "create_library":
    case "open_library":
      // "Fonts" acts as open on another PC (library.lock), to try the question.
      if (a.path?.endsWith("Fonts.library") && !a.force)
        throw `LOCKED:${JSON.stringify({ machine: "x", name: "会議室の Windows", pid: 1, at: Date.now() - 60_000 })}`;
      return { root: "/mock/Demo.library", name: "Demo (mock)" };
    case "list_libraries":
      return mockLibraries;
    case "get_app_settings":
      return { ...appSettings };
    case "set_app_settings":
      Object.assign(appSettings, a.settings);
      return { ...appSettings };
    case "get_library_settings":
      return { ...librarySettings };
    case "set_library_setting":
      if (a.value === null) delete librarySettings[a.key];
      else librarySettings[a.key] = a.value;
      return null;
    case "library_size":
      return items.reduce((n, i) => n + i.size, 0);
    case "set_library_favorite": {
      const l = mockLibraries.find((x) => x.root === a.path);
      if (l) l.favorite = a.favorite;
      mockLibraries.sort((x, y) => Number(y.favorite) - Number(x.favorite) || y.lastOpened - x.lastOpened);
      return null;
    }
    case "forget_library":
      mockLibraries.splice(mockLibraries.findIndex((x) => x.root === a.path), 1);
      return null;
    case "transfer_items": {
      const ids: string[] = a.ids ?? items.filter((i) => i.kind === a.kind && i.deletedAt === null).map((i) => i.id);
      if (a.moveItems) for (const i of items) if (ids.includes(i.id)) i.deletedAt = Date.now();
      return { copied: ids.length - 1, duplicates: 1, failed: [], unusedKinds: {} };
    }
    case "query_items":
      return query(a.query);
    case "get_counts": {
      const of = ofKind(a.kind);
      return {
        all: of(live()).length,
        unfiled: of(live()).filter((i) => !folders.some((f) => inFolder(i.id, f.id))).length,
        untagged: of(live()).filter((i) => !tags.some((t) => hasTag(i.id, t.id))).length,
        trash: of(items).length - of(live()).length,
        favorites: of(live()).filter((i) => i.favorite).length,
        pinned: of(live()).filter((i) => i.pinnedAt !== null).length,
        tray: of(live()).filter((i) => tray.has(i.id)).length,
        kinds: Object.fromEntries(
          (["image", "font", "file"] as const)
            .map((k) => [k, live().filter((i) => i.kind === k).length])
            .filter(([, n]) => n),
        ),
        fontScripts: countBy(live().filter((i) => i.kind === "font"), (i) => i.fontScript ?? "other"),
        fontCategories: countBy(
          live().filter((i) => i.kind === "font"),
          (i) => i.fontCategoryUser ?? i.fontCategory ?? "none",
        ),
      };
    }
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
    case "set_favorite":
      items.filter((i) => a.ids.includes(i.id)).forEach((i) => (i.favorite = a.on));
      return;
    case "set_pinned":
      items.filter((i) => a.ids.includes(i.id)).forEach((i) => (i.pinnedAt = a.on ? (i.pinnedAt ?? Date.now()) : null));
      return;
    case "font_info":
    case "font_faces": {
      const it = items.find((i) => i.id === a.id)!;
      const ja = it.fontScript === "ja";
      const latin = Array.from({ length: 94 }, (_, k) => 0x21 + k);
      const kana = Array.from({ length: 83 }, (_, k) => 0x3041 + k);
      const chars = ja ? [...latin, ...kana] : latin;
      const face = { glyphs: ja ? 17000 : 2500, charCount: chars.length, italic: false, designer: "Mock Type Foundry", version: "Version 2.004" };
      const faces =
        it.ext === "ttc"
          ? ["W3", "W6"].map((w) => ({ ...face, family: "ヒラギノ角ゴシック", style: w, fullName: `ヒラギノ角ゴシック ${w}`, weight: w === "W3" ? 300 : 600, axes: [], instances: [] }))
          : ja
            ? [{ ...face, family: it.fontFamily ?? "", style: it.name.split(/[-.]/)[1], fullName: it.name, weight: it.fontWeight ?? 400, axes: [], instances: [] }]
            : [{ ...face, family: it.fontFamily ?? "", style: "Regular", fullName: it.name, weight: 400, ...(it.ext === "woff2" ? { axes: [{ tag: "wght", name: "Weight", min: 100, default: 400, max: 900 }, { tag: "opsz", name: "Optical size", min: 14, default: 14, max: 32 }], instances: ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black"] } : { axes: [], instances: [] }) }];
      return cmd === "font_faces" ? faces : { faces, chars };
    }
    case "set_font_category": {
      const fonts = items.filter((i) => a.ids.includes(i.id) && i.kind === "font");
      fonts.forEach((i) => (i.fontCategoryUser = a.category));
      return fonts.length;
    }
    case "font_list_preview": {
      const it = items.find((i) => i.id === a.id)!;
      return {
        sample: it.fontScript === "ja" ? "永遠の青い空 いろは アイウ Aa 123" : "The quick brown fox jumps over 0123",
        style: it.ext === "ttc" ? "W3" : (it.name.split(/[-.]/)[1] ?? "Regular"),
        faces: it.ext === "ttc" ? 2 : 1,
      };
    }
    case "font_data":
      // No font files in the browser mock: the viewer falls back to the system font.
      throw "モックではフォントを読み込めません";
    case "orient_items": {
      let n = 0;
      for (const i of items.filter((i) => a.ids.includes(i.id) && i.kind === "image")) {
        const r = i.rotation;
        const [rotation, flipped] =
          a.op === "rotateCw" ? [(r + 1) % 4, i.flipped]
          : a.op === "rotateCcw" ? [(r + 3) % 4, i.flipped]
          : a.op === "flipH" ? [(4 - r) % 4, !i.flipped]
          : a.op === "flipV" ? [(6 - r) % 4, !i.flipped]
          : [0, false];
        if (rotation === r && flipped === i.flipped) continue;
        if (rotation % 2 !== r % 2) [i.width, i.height] = [i.height, i.width];
        Object.assign(i, { rotation, flipped });
        n++;
      }
      return n;
    }
    case "add_to_tray": {
      const fresh = (a.ids as string[]).filter((i) => !tray.has(i) && items.some((x) => x.id === i));
      fresh.forEach((i) => tray.set(i, ++traySeq));
      return fresh.length;
    }
    case "remove_from_tray":
      a.ids.forEach((i: string) => tray.delete(i));
      return;
    case "clear_tray": {
      const ids = [...tray.entries()].sort((x, y) => x[1] - y[1]).map(([i]) => i);
      tray.clear();
      return ids;
    }
    case "reorder_tray": {
      const order = [...tray.entries()]
        .sort((x, y) => x[1] - y[1])
        .map(([i]) => i)
        .filter((i) => !a.ids.includes(i));
      const at = a.before ? order.indexOf(a.before) : -1;
      order.splice(at < 0 ? order.length : at, 0, ...a.ids.filter((i: string) => tray.has(i)));
      order.forEach((i, n) => tray.set(i, n + 1));
      return;
    }
    case "sheet_image": {
      const it = items.find((i) => i.id === a.id)!;
      return sheetImage(it, a.maxSide);
    }
    case "save_file":
    case "copy_image":
      console.info(`[mock] ${cmd}`, a instanceof Uint8Array ? `${a.length} bytes` : a);
      (window as unknown as { __MOCK_LAST_FILE__: unknown }).__MOCK_LAST_FILE__ = a;
      return;
    case "reveal_path":
      return;
    case "copy_items":
    case "export_items":
      return a.ids.length;
    case "index_similar":
    case "index_fonts":
      return 0;
    case "dismiss_duplicates": {
      const batch = ++dismissSeq;
      for (const p of pairsOf(a.ids as string[])) if (!dismissed.has(p)) dismissed.set(p, batch);
      return null;
    }
    case "undismiss_duplicates":
      for (const p of pairsOf(a.ids as string[])) dismissed.delete(p);
      return null;
    case "clear_dismissed_duplicates":
      dismissed.clear();
      return null;
    case "count_dismissed_duplicates":
      return new Set(dismissed.values()).size;
    case "preview_duplicates":
    case "resolve_duplicates": {
      const effects = (a.groups as { keep: string; remove: string[] }[]).map((g) => {
        const keep = items.find((i) => i.id === g.keep)!;
        const removed = g.remove.map((rid) => items.find((i) => i.id === rid)!);
        const addedTags = tags
          .filter((t) => !hasTag(keep.id, t.id) && g.remove.some((rid) => hasTag(rid, t.id)))
          .map((t) => t.name);
        const best = Math.max(...removed.map((i) => i.rating));
        const hasFolder = folders.some((f) => inFolder(keep.id, f.id));
        const folderId = hasFolder
          ? null
          : (folders.find((f) => g.remove.some((rid) => inFolder(rid, f.id)))?.id ?? null);
        return { keep: g.keep, remove: g.remove, addedTags, rating: best > keep.rating ? best : null, folderId };
      });
      if (cmd === "resolve_duplicates") {
        for (const e of effects) {
          const keep = items.find((i) => i.id === e.keep)!;
          for (const rid of e.remove) {
            tags.forEach((t) => hasTag(rid, t.id) && itemTags.add(`${keep.id}|${t.id}`));
            items.find((i) => i.id === rid)!.deletedAt ??= Date.now();
          }
          if (e.rating != null) keep.rating = e.rating;
          if (e.folderId) link(keep.id, e.folderId);
        }
      }
      return effects;
    }
    case "supported_exts":
      return [
        ...["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "svg", "heic", "heif", "avif"],
        ...["ttf", "otf", "woff", "woff2", "ttc", "otc"],
        ...["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pages", "numbers", "key"],
      ];
    case "import_paths":
    case "import_bytes":
      return { imported: 0, duplicates: 0, failed: ["mock backend: import is not available in the browser"] };
    case "web_import_status":
      return { ...webImport };
    case "set_web_import":
      webImport.enabled = webImport.running = a.enabled;
      return { ...webImport };
    case "reset_web_import_token":
      return { ...webImport };
    case "answer_web_pair":
      return null;
    case "mcp_status":
      return mcpStatus();
    case "set_mcp":
      mcp.enabled = mcp.running = a.enabled;
      return mcpStatus();
    case "reset_mcp_token":
      mcp.token = `mock-${Date.now()}`;
      return mcpStatus();
    case "list_changes":
      return claudeChanges.map((c) => ({ ...c }));
    case "undo_change": {
      const c = claudeChanges.find((x) => x.id === a.id);
      if (!c) throw "この変更の記録はもうありません";
      if (c.undone) throw "この変更はすでに元に戻しています";
      c.undone = true;
      return { summary: c.summary, skipped: 0 };
    }
    case "install_extension":
      webImport.extensionDir = "/Users/mock/Library/Application Support/com.local.imagelibrary/chrome-extension";
      return webImport.extensionDir;
    case "list_folders":
      return folders.map((f) => ({ ...f, count: ofKind(a.kind)(live()).filter((i) => inFolder(i.id, f.id)).length }));
    case "place_folder":
      return placeFolder(a.id, a.parentId ?? null, a.before ?? null);
    case "shift_folder": {
      const parent = folders.find((f) => f.id === a.id)?.parentId ?? null;
      reorderSiblings(parent, (sibs) => {
        const from = sibs.findIndex((f) => f.id === a.id);
        const [f] = sibs.splice(from, 1);
        sibs.splice(Math.max(0, Math.min(sibs.length, from + a.by)), 0, f);
        return sibs;
      });
      return;
    }
    case "sort_folders_by_name":
      reorderSiblings(a.parentId ?? null, (sibs) => [...sibs].sort((x, y) => x.name.localeCompare(y.name)));
      return;
    case "list_smart_folders":
      return smartFolders.map((f) => ({ ...f, count: applyRule(ofKind(a.kind)(live()), f.rule).length }));
    case "create_smart_folder": {
      const f = { id: id(), name: a.name, rule: a.rule, color: null };
      smartFolders.push(f);
      return f.id;
    }
    case "update_smart_folder": {
      const f = smartFolders.find((x) => x.id === a.id)!;
      if (a.name) f.name = a.name;
      if (a.rule) f.rule = a.rule;
      return;
    }
    case "delete_smart_folder":
      smartFolders.splice(smartFolders.findIndex((x) => x.id === a.id), 1);
      return;
    case "list_exts": {
      const m = new Map<string, number>();
      ofKind(a.kind)(live()).forEach((i) => m.set(aliases(i.ext), (m.get(aliases(i.ext)) ?? 0) + 1));
      return [...m.entries()].sort((x, y) => y[1] - x[1]);
    }
    case "create_folder": {
      const f = { id: id(), parentId: a.parentId ?? null, name: a.name, color: null };
      folders.push(f);
      return f.id;
    }
    case "rename_folder":
      folders.find((f) => f.id === a.id)!.name = a.name;
      return;
    case "delete_folder":
      removeFolder(a.id);
      return;
    case "move_folder":
      return placeFolder(a.id, a.parentId ?? null, null);
    case "move_to_folder":
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
        .map((t) => ({ ...t, count: ofKind(a.kind)(live()).filter((i) => hasTag(i.id, t.id)).length })) satisfies Tag[];
    case "add_tags":
      addTags(a.ids, a.names);
      return;
    case "remove_tag":
      a.ids.forEach((i: string) => itemTags.delete(`${i}|${a.tagId}`));
      return;
    case "set_folder_color":
      folders.find((f) => f.id === a.id)!.color = a.color;
      return;
    case "set_smart_folder_color":
      smartFolders.find((f) => f.id === a.id)!.color = a.color;
      return;
    case "set_tag_color":
      tags.find((t) => t.id === a.id)!.color = a.color;
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
      return null;
    case "plugin:dialog|save":
      // Lets the contact sheet be "saved" (see save_file); other saves are cancelled.
      return a.options?.title === "まとめて出力" ? `/mock/${a.options.defaultPath}` : null;
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
