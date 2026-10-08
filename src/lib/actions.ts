// User-level actions shared by several components (dialogs + API + refresh).
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { api, EMPTY_FILTER, type Item, type OrientOp } from "./api";
import { activeConditions, currentFolderId, useStore } from "../store";

const st = () => useStore.getState();

export async function createLibraryDialog() {
  const path = await save({ title: "新しいライブラリの保存先", defaultPath: "MyPictures.library" });
  if (!path) return;
  try {
    st().setLibrary(await api.createLibrary(path));
  } catch (e) {
    st().toast(String(e), true);
  }
}

export async function openLibraryDialog() {
  const path = await open({ title: "ライブラリフォルダを選択", directory: true });
  if (typeof path !== "string") return;
  try {
    st().setLibrary(await api.openLibrary(path));
  } catch (e) {
    st().toast(String(e), true);
  }
}

let busy = false;

async function guarded(fn: () => Promise<void>) {
  if (busy) {
    st().toast("インポート中です。完了までお待ちください。", true);
    return;
  }
  busy = true;
  try {
    await fn();
  } catch (e) {
    st().toast(String(e), true);
  } finally {
    busy = false;
    st().setImporting(null);
    await st().refresh();
  }
}

/** `folderId` overrides the folder currently open in the grid. */
export function importPaths(paths: string[], folderId?: string) {
  if (!paths.length || !st().library) return;
  const folder = folderId ?? currentFolderId();
  return guarded(async () => st().importDone(await api.importPaths(paths, folder)));
}

export async function importFilesDialog() {
  const exts = await api.supportedExts();
  const picked = await open({
    title: "画像を追加",
    multiple: true,
    filters: [{ name: "画像・フォント", extensions: [...exts, ...exts.map((e) => e.toUpperCase())] }],
  });
  if (picked) await importPaths(Array.isArray(picked) ? picked : [picked]);
}

export async function importFolderDialog() {
  const picked = await open({ title: "フォルダから追加", directory: true, multiple: true });
  if (picked) await importPaths(Array.isArray(picked) ? picked : [picked]);
}

export function importClipboardFiles(files: File[]) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!images.length || !st().library) return;
  const folder = currentFolderId();
  return guarded(async () => {
    const total = { imported: 0, duplicates: 0, failed: [] as string[] };
    for (const f of images) {
      const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      // Clipboard images are usually all called "image.png"; give them a dated name.
      const name =
        f.name && f.name !== "image.png"
          ? f.name
          : `pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      const s = await api.importBytes(name, new Uint8Array(await f.arrayBuffer()), folder);
      total.imported += s.imported;
      total.duplicates += s.duplicates;
      total.failed.push(...s.failed);
    }
    st().importDone(total);
  });
}

/** Moves to trash, or deletes permanently when already in the trash. */
export async function deleteSelection(ids: string[]) {
  if (!ids.length) return;
  if (st().view.kind === "trash") {
    const ok = await ask(`${ids.length} 件の画像を完全に削除します。元に戻せません。`, {
      title: "完全に削除",
      kind: "warning",
      okLabel: "削除",
      cancelLabel: "キャンセル",
    });
    if (ok) await st().run(() => api.deleteItems(ids));
  } else {
    await st().run(() => api.trashItems(ids));
    st().toast(`${ids.length} 件をゴミ箱へ移動しました`, false, {
      label: "元に戻す",
      onClick: () => st().run(() => api.restoreItems(ids)),
    });
  }
}

/** Splits the similar view's list into its groups (best copy first in each). */
export function similarGroups(items: Item[]): Item[][] {
  const out: Item[][] = [];
  for (const i of items) {
    if (i.group === undefined) continue;
    if (out.length && out[out.length - 1][0].group === i.group) out[out.length - 1].push(i);
    else out.push([i]);
  }
  return out;
}

/** The copy to keep: the one the user picked, else the best (first). */
export function keeperOf(group: Item[], picked: Set<string>): Item {
  return group.find((i) => picked.has(i.id)) ?? group[0];
}

/** Per group: the id to keep first, then the ids to trash. */
export function keepPlan(groups: Item[][], picked: Set<string>): string[][] {
  return groups.map((g) => {
    const keep = keeperOf(g, picked);
    return [keep.id, ...g.filter((i) => i !== keep).map((i) => i.id)];
  });
}

/**
 * Opens the tidy-up review for `groups` (each: the copy to keep, then the
 * copies to trash). Nothing changes until the user confirms there.
 */
export async function reviewDuplicates(groups: string[][]) {
  const byId = new Map(st().items.map((i) => [i.id, i]));
  const review = groups
    .filter((g) => g.length > 1 && g.every((id) => byId.has(id)))
    .map(([keep, ...remove]) => ({ keep: byId.get(keep)!, remove: remove.map((id) => byId.get(id)!) }));
  if (!review.length) return;
  st().setReview({ groups: review, effects: null });
  try {
    const effects = await api.previewDuplicates(review.map(planOf));
    if (st().review) st().setReview({ groups: review, effects });
  } catch (e) {
    st().setReview(null);
    st().toast(String(e), true);
  }
}

const planOf = (g: { keep: Item; remove: Item[] }) => ({ keep: g.keep.id, remove: g.remove.map((i) => i.id) });

/** Runs the tidy-up that the review dialog showed. */
export async function confirmDuplicates() {
  const review = st().review;
  if (!review) return;
  st().setReview(null);
  const plan = review.groups.map(planOf);
  const removed = plan.flatMap((p) => p.remove);
  try {
    const effects = await api.resolveDuplicates(plan);
    const tags = new Set(effects.flatMap((e) => e.addedTags)).size;
    const carried = [
      tags ? `タグ ${tags} 種` : "",
      effects.some((e) => e.rating != null) ? "評価" : "",
      effects.some((e) => e.folderId) ? "フォルダ" : "",
    ].filter(Boolean);
    st().toast(
      `${plan.length} グループの重複 ${removed.length} 枚をゴミ箱へ移動しました` +
        (carried.length ? `（${carried.join("・")}を残す1枚へ引き継ぎ）` : ""),
      false,
      {
        label: "元に戻す",
        onClick: () => st().run(() => api.restoreItems(removed)),
      },
    );
  } catch (e) {
    st().toast(String(e), true);
  }
  useStore.setState({ keepPick: new Set() });
  await st().refresh();
}

/** Marks a group as "not duplicates" so it stops being proposed. */
export async function dismissDuplicates(ids: string[]) {
  try {
    await api.dismissDuplicates(ids);
    const gone = new Set(ids);
    useStore.setState({ keepPick: new Set([...st().keepPick].filter((x) => !gone.has(x))) });
    st().toast(`${ids.length} 枚のグループを重複ではないとしました`, false, {
      label: "元に戻す",
      onClick: () => st().run(() => api.undismissDuplicates(ids)),
    });
  } catch (e) {
    st().toast(String(e), true);
  }
  await st().refresh();
}

/** Brings back every group dismissed as "not duplicates". */
export async function clearDismissedDuplicates() {
  try {
    await api.clearDismissedDuplicates();
    st().toast("無視した候補をすべて解除しました");
  } catch (e) {
    st().toast(String(e), true);
  }
  await st().refresh();
}

export async function emptyTrash() {
  const n = st().counts.trash;
  if (!n) return;
  const ok = await ask(`ゴミ箱の ${n} 件を完全に削除します。元に戻せません。`, {
    title: "ゴミ箱を空にする",
    kind: "warning",
    okLabel: "空にする",
    cancelLabel: "キャンセル",
  });
  if (ok) await st().run(() => api.emptyTrash());
}

export async function confirmDeleteFolder(id: string, name: string) {
  const ok = await ask(
    `フォルダ「${name}」とそのサブフォルダを削除します。\n中の画像は削除されません。`,
    { title: "フォルダを削除", kind: "warning", okLabel: "削除", cancelLabel: "キャンセル" },
  );
  if (ok) await st().run(() => api.deleteFolder(id));
}

export async function confirmDeleteTag(id: number, name: string) {
  const ok = await ask(`タグ「${name}」を削除します。画像からも外れます。`, {
    title: "タグを削除",
    kind: "warning",
    okLabel: "削除",
    cancelLabel: "キャンセル",
  });
  if (ok) await st().run(() => api.deleteTag(id));
}

// ------------------------------------------------------------ organizing

const folderName = (id: string) => st().folders.find((f) => f.id === id)?.name ?? "";

/** Moves items into a folder (an item is in one folder at most). */
export async function moveToFolder(ids: string[], folderId: string) {
  if (!ids.length) return;
  await st().run(() => api.moveToFolder(ids, folderId));
  st().rememberFolders([folderId]);
  st().flashTarget(`folder:${folderId}`);
  st().toast(`${ids.length} 件を「${folderName(folderId)}」へ移動しました`);
}

/** Shift+D: repeat the last "move to folder". */
export function moveToLastFolder(ids: string[]) {
  const last = st().recentFolders[0];
  if (!last) {
    st().setPicker("move");
    return;
  }
  return moveToFolder(ids, last);
}

/** Creates a folder and starts renaming it in the sidebar. */
export async function createFolder(parentId: string | null, itemIds: string[] = []) {
  try {
    const id = await api.createFolder("新しいフォルダ", parentId);
    if (itemIds.length) await api.moveToFolder(itemIds, id);
    await st().refresh();
    if (!st().sidebarOpen) st().toggleSidebar();
    st().setRenamingFolder(id);
    return id;
  } catch (e) {
    st().toast(String(e), true);
  }
}

/** ⌘⇧N: new folder next to the open one (or at the top level). */
export function createFolderHere() {
  const cur = currentFolderId();
  const parent = cur ? (st().folders.find((f) => f.id === cur)?.parentId ?? null) : null;
  return createFolder(parent);
}

export async function setRating(ids: string[], rating: number) {
  if (!ids.length) return;
  await st().run(() => api.setRating(ids, rating));
}

/** True when every one of `ids` has the flag (so a toggle turns it off). */
function allHave(ids: string[], flag: (i: Item) => boolean): boolean {
  const byId = new Map(st().rawItems.map((i) => [i.id, i]));
  return ids.length > 0 && ids.every((id) => flag(byId.get(id)!));
}

/** F: adds to favourites, or removes when every selected image already is one. */
export async function toggleFavorite(ids: string[]) {
  if (!ids.length) return;
  const on = !allHave(ids, (i) => i.favorite);
  await st().run(() => api.setFavorite(ids, on));
}

/** P: pins to the top of every list, or unpins when all are pinned. */
export async function togglePinned(ids: string[]) {
  if (!ids.length) return;
  const on = !allHave(ids, (i) => i.pinnedAt !== null);
  await st().run(() => api.setPinned(ids, on));
  if (on) st().toast(`${ids.length} 件をピン留めしました（一覧の先頭に表示）`);
}

/** Rotates / flips the images without changing the files. */
export async function orient(ids: string[], op: OrientOp) {
  if (!ids.length) return;
  await st().run(() => api.orientItems(ids, op));
}

/** Manual order: move `ids` in front of `before` (null = end) in the open folder or the tray. */
export async function reorder(ids: string[], before: string | null) {
  if (st().view.kind === "tray") return st().run(() => api.reorderTray(ids, before));
  const folder = currentFolderId();
  if (!folder) return;
  await st().run(() => api.reorderInFolder(folder, ids, before));
}

// ------------------------------------------------------------ work tray

/** Puts items on the work tray (after the ones already there). */
export async function addToTray(ids: string[]) {
  if (!ids.length) return;
  let added = 0;
  await st().run(async () => {
    added = await api.addToTray(ids);
  });
  st().flashTarget("tray");
  st().toast(added ? `${added} 件を作業台に追加しました` : "すでに作業台にあります");
}

/** B: puts items on the tray, or takes them off when all are already there. */
export async function toggleTray(ids: string[]) {
  if (!ids.length) return;
  if (!allHave(ids, (i) => i.inTray)) return addToTray(ids);
  await st().run(() => api.removeFromTray(ids));
  st().toast(`${ids.length} 件を作業台から外しました`, false, {
    label: "元に戻す",
    onClick: () => st().run(() => api.addToTray(ids)),
  });
}

/** Takes everything off the tray (the images themselves stay). */
export async function clearTray() {
  try {
    const ids = await api.clearTray();
    if (ids.length)
      st().toast(`作業台を空にしました（${ids.length} 件）`, false, {
        label: "元に戻す",
        onClick: () => st().run(() => api.addToTray(ids)),
      });
  } catch (e) {
    st().toast(String(e), true);
  }
  await st().refresh();
}

/** Everything on the tray in its order (whatever the tray view's sort). */
function trayItems(): Promise<Item[]> {
  return api.queryItems({
    view: { kind: "tray" },
    search: "",
    tagIds: [],
    tagMatchAll: false,
    includeSubfolders: false,
    minRating: 0,
    filter: EMPTY_FILTER,
    similarLevel: "standard",
    sort: "manual",
    desc: false,
  });
}

/**
 * The items an action from the tray works on: what is selected in the tray
 * view, else everything on it in the order shown.
 */
async function trayTargets(): Promise<Item[]> {
  const s = st();
  if (s.view.kind !== "tray") return trayItems();
  const shown = displayOrder();
  const sel = shown.filter((i) => s.selected.has(i.id));
  return sel.length ? sel : shown;
}

/** Items as the list shows them (one listed in several groups counts once, where it first appears). */
function displayOrder(): Item[] {
  const seen = new Set<string>();
  return st().items.filter((i) => !seen.has(i.id) && seen.add(i.id));
}

export async function sheetFromTray() {
  try {
    const items = await trayTargets();
    if (items.length) st().setSheet(items);
  } catch (e) {
    st().toast(String(e), true);
  }
}

export async function exportTray() {
  try {
    const items = await trayTargets();
    if (items.length) await exportSelection(items.map((i) => i.id));
  } catch (e) {
    st().toast(String(e), true);
  }
}

// ------------------------------------------------------- contact sheet

/** Opens "まとめて出力" for the listed items `ids`, in the order the list shows them. */
export function openSheet(ids: string[]) {
  const want = new Set(ids);
  const items = displayOrder().filter((i) => want.has(i.id));
  if (items.length) st().setSheet(items);
}

// ---------------------------------------------------------- taking out

export async function copySelection(ids: string[]) {
  if (!ids.length) return;
  try {
    const n = await api.copyItems(ids);
    st().toast(`${n} 件をクリップボードにコピーしました`);
  } catch (e) {
    st().toast(String(e), true);
  }
}

export async function exportSelection(ids: string[]) {
  if (!ids.length) return;
  const dest = await open({ title: "書き出し先のフォルダを選択", directory: true });
  if (typeof dest !== "string") return;
  try {
    const n = await api.exportItems(ids, dest);
    st().toast(`${n} 件を書き出しました`);
  } catch (e) {
    st().toast(String(e), true);
  }
}

export async function openSelection(ids: string[]) {
  if (!ids.length) return;
  if (ids.length > 10) {
    const ok = await ask(`${ids.length} 件を既定のアプリで開きます。よろしいですか？`, {
      title: "既定のアプリで開く",
      okLabel: "開く",
      cancelLabel: "キャンセル",
    });
    if (!ok) return;
  }
  await st().run(() => api.openItems(ids));
}

// -------------------------------------------------------- smart folders

/**
 * Saves the current conditions as a new smart folder and opens it. With no
 * conditions set yet, the new folder opens straight into editing them.
 */
export async function createSmartFolder() {
  const s = st();
  const empty = activeConditions(s) === 0;
  try {
    const rule = s.currentRule();
    const id = await api.createSmartFolder("新しいスマートフォルダ", rule);
    // The conditions now live in the folder; start it with a clean slate.
    useStore.setState({ search: "", tagFilter: [], minRating: 0, filter: EMPTY_FILTER });
    s.setView({ kind: "smart", id });
    if (!st().sidebarOpen) st().toggleSidebar();
    st().setRenamingFolder(id);
    if (empty) st().startEditSmart({ id, name: "新しいスマートフォルダ", rule, count: 0, color: null });
  } catch (e) {
    s.toast(String(e), true);
  }
}

/** Writes the edited conditions back to the smart folder being edited. */
export async function saveEditedSmartFolder() {
  const s = st();
  const editing = s.editingSmart;
  if (!editing) return;
  try {
    await api.updateSmartFolder(editing.id, { rule: s.currentRule() });
    leaveSmartEdit(editing.id);
    st().toast(`スマートフォルダ「${editing.name}」の条件を保存しました`);
  } catch (e) {
    s.toast(String(e), true);
  }
}

export function cancelSmartEdit() {
  const editing = st().editingSmart;
  if (editing) leaveSmartEdit(editing.id);
}

function leaveSmartEdit(id: string) {
  useStore.setState({ editingSmart: null, search: "", tagFilter: [], minRating: 0, filter: EMPTY_FILTER });
  st().setView({ kind: "smart", id });
}

export async function renameSmartFolder(id: string, name: string) {
  await st().run(() => api.updateSmartFolder(id, { name }));
}

export async function confirmDeleteSmartFolder(id: string, name: string) {
  const ok = await ask(`スマートフォルダ「${name}」を削除します。\n画像は削除されません。`, {
    title: "スマートフォルダを削除",
    kind: "warning",
    okLabel: "削除",
    cancelLabel: "キャンセル",
  });
  if (ok) await st().run(() => api.deleteSmartFolder(id));
}

// --------------------------------------------------------- folder order

/** ⌘[ / ⌘] (one step) and ⌘⇧[ / ⌘⇧] (to the top / bottom). */
export async function shiftFolder(id: string, by: -1 | 1, toEnd = false) {
  await st().run(() => api.shiftFolder(id, toEnd ? by * 1_000_000 : by));
  st().flashTarget(`folder:${id}`);
}

export async function sortFoldersByName(parentId: string | null) {
  await st().run(() => api.sortFoldersByName(parentId));
}

// ------------------------------------------------------- tag clipboard

/** ⌘⇧C: copies the tags of the selection (all of them, for several images). */
export async function copyTags(ids: string[]) {
  if (!ids.length) return;
  try {
    const info = await api.selectionInfo(ids);
    const names = info.tags.map((t) => t.name);
    st().setTagClipboard(names);
    st().toast(names.length ? `タグ ${names.length} 件をコピーしました：${names.join("、")}` : "タグはありません");
  } catch (e) {
    st().toast(String(e), true);
  }
}

/** ⌘⇧V: adds the copied tags to the selection. */
export async function pasteTags(ids: string[]) {
  const names = st().tagClipboard;
  if (!ids.length) return;
  if (!names.length) {
    st().toast("コピーしたタグがありません（⌘⇧C でコピー）");
    return;
  }
  await st().run(() => api.addTags(ids, names));
  st().rememberTags(names);
  st().toast(`${ids.length} 件にタグ ${names.length} 件を貼り付けました`);
}
