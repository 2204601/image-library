import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ImageDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ContextMenu } from "./components/ContextMenu";
import { ResizeHandle } from "./components/ResizeHandle";
import { DragLayer } from "./components/DragLayer";
import { DuplicateReview } from "./components/DuplicateReview";
import { FolderPicker } from "./components/FolderPicker";
import { Grid } from "./components/Grid";
import { Inspector } from "./components/Inspector";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { Viewer } from "./components/Viewer";
import { SheetDialog } from "./components/SheetDialog";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { TransferDialog } from "./components/TransferDialog";
import { PairDialog } from "./components/WebImportDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExportDialog } from "./components/ExportDialog";
import { Welcome } from "./components/Welcome";
import { importClipboardFiles, importPaths, undoChanges } from "./lib/actions";
import { api, type Change, type ImportSummary } from "./lib/api";
import { loadAppVersion, scheduleUpdateCheck } from "./lib/update";
import { installMenuBar } from "./lib/menuBar";
import { notifyUnusedKinds, useStore } from "./store";

/** Sidebar folder under a native file drag (position is in physical pixels). */
function folderAt(pos: { x: number; y: number }): string | null {
  const r = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(pos.x / r, pos.y / r)?.closest<HTMLElement>("[data-drop]");
  const t = el?.dataset.drop;
  return t?.startsWith("folder:") ? t : null;
}

export default function App() {
  const library = useStore((s) => s.library);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const inspectorWidth = useStore((s) => s.inspectorWidth);
  // A panel's edge is being dragged: no width animation.
  const [resizing, setResizing] = useState(false);
  const fileOver = useStore((s) => s.fileDrag);
  const fileTarget = useStore((s) => (s.fileDrag ? s.dropTarget : null));
  const folders = useStore((s) => s.folders);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .openLastLibrary()
      .then((lib) => lib && useStore.getState().setLibrary(lib))
      .catch((e) => useStore.getState().toast(String(e), true))
      .finally(() => setReady(true));
    loadAppVersion();
    return scheduleUpdateCheck();
  }, []);

  // The menu bar (macOS and Windows), made from the command table.
  useEffect(() => installMenuBar(), []);

  // Saved from the browser extension (src-tauri/src/webimport.rs). A batch
  // from the extension's image list arrives one by one: report it once.
  useEffect(() => {
    let added = 0;
    let known = 0;
    let kinds: Record<string, number> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen<ImportSummary>("web-import", (e) => {
      added += e.payload.imported;
      known += e.payload.duplicates;
      for (const [k, n] of Object.entries(e.payload.kinds ?? {})) kinds[k] = (kinds[k] ?? 0) + (n ?? 0);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useStore.getState();
        s.refresh();
        s.notify({
          title: added ? `ブラウザから ${added} 件を追加しました` : "ブラウザから追加されたものはありません",
          detail: known ? `${known} 件はすでにライブラリにあります` : undefined,
          kind: added ? "success" : "info",
        });
        notifyUnusedKinds(kinds);
        added = known = 0;
        kinds = {};
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      unlisten.then((f) => f());
    };
  }, []);

  // Changed from Claude (src-tauri/src/mcp/). Claude often calls several
  // tools in a row: one toast for the run, undoing all of it.
  useEffect(() => {
    let changes: Change[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen<Change>("library-changed", (e) => {
      changes.push(e.payload);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useStore.getState();
        const ids = changes.map((c) => c.id);
        s.refresh();
        s.notify({
          title: changes.length > 1 ? `Claude が ${changes.length} 件の変更をしました` : `Claude：${changes[0].summary}`,
          detail: changes.length > 1 ? changes.map((c) => c.summary).join(" / ") : undefined,
          kind: "info",
          action: { label: "元に戻す", onClick: () => undoChanges(ids) },
        });
        changes = [];
      }, 1500);
    });
    return () => {
      clearTimeout(timer);
      unlisten.then((f) => f());
    };
  }, []);

  // An extension asks to connect; the question closes itself if it times out.
  useEffect(() => {
    const ask = listen<{ id: string; code: string }>("web-pair", (e) => useStore.getState().setPairRequest(e.payload));
    const end = listen<string>("web-pair-end", (e) => {
      if (useStore.getState().pairRequest?.id === e.payload) useStore.getState().setPairRequest(null);
    });
    return () => {
      ask.then((f) => f());
      end.then((f) => f());
    };
  }, []);

  // Files dropped from Finder / Explorer.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      const s = useStore.getState();
      if (p.type === "enter" || p.type === "over") {
        if (!s.library) return;
        s.setFileDrag(true);
        s.setDropTarget(folderAt(p.position));
      } else if (p.type === "leave") {
        s.setFileDrag(false);
      } else if (p.type === "drop") {
        const target = folderAt(p.position);
        s.setFileDrag(false);
        importPaths(p.paths, target ? target.slice(7) : undefined)?.then(
          () => target && useStore.getState().flashTarget(target),
        );
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ done: number; total: number }>("import-progress", (e) =>
      useStore.getState().setImporting(e.payload.total > 1 ? { label: "読み込み中…", ...e.payload } : null),
    );
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        importClipboardFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => {
      unlisten.then((f) => f());
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  if (!ready) return null;

  return (
    <div className="flex h-full" onContextMenu={(e) => e.preventDefault()}>
      {library ? (
        <>
          <div
            className={`relative flex shrink-0 overflow-hidden ${resizing ? "" : "transition-[width] duration-200 ease-out"}`}
            style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          >
            <Sidebar />
            {sidebarOpen && <ResizeHandle panel="sidebar" onResizing={setResizing} />}
          </div>
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Toolbar />
            <Grid />
          </main>
          <div
            className={`relative flex shrink-0 overflow-hidden ${resizing ? "" : "transition-[width] duration-200 ease-out"}`}
            style={{ width: inspectorOpen ? inspectorWidth : 0 }}
          >
            <Inspector />
            {inspectorOpen && <ResizeHandle panel="inspector" onResizing={setResizing} />}
          </div>
        </>
      ) : (
        <div className="flex-1">
          <Welcome />
        </div>
      )}
      {fileOver && (
        <div
          className={`pointer-events-none fixed inset-0 z-30 flex animate-fade-in items-center justify-center ring-4 ring-inset transition-colors ${
            fileTarget ? "bg-transparent ring-transparent" : "bg-accent/15 ring-accent"
          }`}
        >
          <div className="flex animate-zoom-in items-center gap-2 rounded-lg bg-raised px-5 py-3 text-base shadow-xl">
            <ImageDown size={20} className="text-accent" />
            {fileTarget
              ? `「${folders.find((f) => `folder:${f.id}` === fileTarget)?.name ?? ""}」に追加`
              : "ドロップして追加"}
          </div>
        </div>
      )}
      <Viewer />
      <FolderPicker />
      <DuplicateReview />
      <SheetDialog />
      <TransferDialog />
      <ExportDialog />
      <SettingsDialog />
      <PairDialog />
      <ShortcutHelp />
      <DragLayer />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
