import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../store";

export function Viewer() {
  const index = useStore((s) => s.viewer);
  const items = useStore((s) => s.items);
  const openViewer = useStore((s) => s.openViewer);
  const item = index !== null ? items[index] : undefined;

  useEffect(() => {
    if (index === null) return;
    const go = (d: number) => {
      const next = Math.min(items.length - 1, Math.max(0, index + d));
      openViewer(next);
      useStore.getState().select(items[next].id, "only");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        openViewer(null);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items, openViewer]);

  if (!item || index === null) return null;
  const nav =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/70 hover:text-white disabled:invisible";
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/95" onClick={() => openViewer(null)}>
      <div className="flex items-center gap-3 px-4 py-2 text-sm text-white/80">
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <span className="tabular-nums text-white/50">
          {index + 1} / {items.length}
        </span>
        <button className="rounded p-1 hover:bg-white/10" onClick={() => openViewer(null)}>
          <X size={18} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <img
          key={item.id}
          src={convertFileSrc(item.filePath)}
          alt={item.name}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-4"
        />
        <button
          className={`${nav} left-4`}
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation();
            openViewer(index - 1);
          }}
        >
          <ChevronLeft size={24} />
        </button>
        <button
          className={`${nav} right-4`}
          disabled={index === items.length - 1}
          onClick={(e) => {
            e.stopPropagation();
            openViewer(index + 1);
          }}
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
}
