import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ImageDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ContextMenu } from "./components/ContextMenu";
import { DragLayer } from "./components/DragLayer";
import { DuplicateReview } from "./components/DuplicateReview";
import { FolderPicker } from "./components/FolderPicker";
import { Grid } from "./components/Grid";
import { Inspector } from "./components/Inspector";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { Viewer } from "./components/Viewer";
import { Welcome } from "./components/Welcome";
import { importClipboardFiles, importPaths } from "./lib/actions";
import { api } from "./lib/api";
import { useStore } from "./store";

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
      useStore.getState().setImporting(e.payload.total > 1 ? e.payload : null),
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
            className={`flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
              sidebarOpen ? "w-60" : "w-0"
            }`}
          >
            <Sidebar />
          </div>
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Toolbar />
            <Grid />
          </main>
          <div
            className={`flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
              inspectorOpen ? "w-72" : "w-0"
            }`}
          >
            <Inspector />
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
      <DragLayer />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
