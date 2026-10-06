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

export function importPaths(paths: string[]) {
  if (!paths.length || !st().library) return;
  const folder = currentFolderId();
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
