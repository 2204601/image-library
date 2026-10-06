// User-level actions shared by several components (dialogs + API + refresh).
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { currentFolderId, useStore } from "../store";

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
    filters: [{ name: "画像", extensions: [...exts, ...exts.map((e) => e.toUpperCase())] }],
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

/** Adds items to one or more folders, optionally taking them out of the open folder. */
export async function addToFolders(ids: string[], folderIds: string[], removeFromCurrent = false) {
  if (!ids.length || !folderIds.length) return;
  const current = currentFolderId();
  await st().run(async () => {
    for (const f of folderIds) await api.addToFolder(ids, f);
    if (removeFromCurrent && current && !folderIds.includes(current)) {
      await api.removeFromFolder(ids, current);
    }
  });
  st().rememberFolders(folderIds);
  folderIds.forEach((f) => st().flashTarget(`folder:${f}`));
  const where = folderIds.length === 1 ? `「${folderName(folderIds[0])}」` : `${folderIds.length} 個のフォルダ`;
  st().toast(`${ids.length} 件を${where}に追加しました`);
}

/** Shift+D: repeat the last "add to folder". */
export function addToLastFolder(ids: string[]) {
  const last = st().recentFolders[0];
  if (!last) {
    st().setPicker("add");
    return;
  }
  return addToFolders(ids, [last]);
}

/** Creates a folder and starts renaming it in the sidebar. */
export async function createFolder(parentId: string | null, itemIds: string[] = []) {
  try {
    const id = await api.createFolder("新しいフォルダ", parentId);
    if (itemIds.length) await api.addToFolder(itemIds, id);
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

/** Manual order: move `ids` in front of `before` (null = end) in the open folder. */
export async function reorder(ids: string[], before: string | null) {
  const folder = currentFolderId();
  if (!folder) return;
  await st().run(() => api.reorderInFolder(folder, ids, before));
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
