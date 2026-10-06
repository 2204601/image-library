import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ImageDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ContextMenu } from "./components/ContextMenu";
import { DragLayer } from "./components/DragLayer";
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

export default function App() {
  const library = useStore((s) => s.library);
  const [ready, setReady] = useState(false);
  const [fileOver, setFileOver] = useState(false);

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
      if (p.type === "enter" || p.type === "over") setFileOver(!!useStore.getState().library);
      else if (p.type === "leave") setFileOver(false);
      else if (p.type === "drop") {
        setFileOver(false);
        importPaths(p.paths);
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
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Toolbar />
            <Grid />
          </main>
          <Inspector />
        </>
      ) : (
        <div className="flex-1">
          <Welcome />
        </div>
      )}
      {fileOver && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-accent/15 ring-4 ring-accent ring-inset">
          <div className="flex items-center gap-2 rounded-lg bg-raised px-5 py-3 text-base shadow-xl">
            <ImageDown size={20} className="text-accent" />
            ドロップして追加
          </div>
        </div>
      )}
      <Viewer />
      <DragLayer />
      <ContextMenu />
      <Toasts />
    </div>
  );
}
