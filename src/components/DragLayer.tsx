// In-app drag & drop (images -> folder, folder -> folder) built on pointer
// events. HTML5 DnD is avoided because Tauri's native file-drop handling
// disables it on Windows.
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { api } from "../lib/api";
import { useStore, type Drag } from "../store";

const THRESHOLD = 5;

/**
 * Call from onPointerDown. Starts a drag once the pointer moves a few pixels;
 * otherwise `onClick` runs on release.
 */
export function startPointerDrag(
  e: React.PointerEvent,
  makeDrag: (x: number, y: number) => Drag,
  onClick?: () => void,
) {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > THRESHOLD) {
      dragging = true;
      useStore.getState().setDrag(makeDrag(ev.clientX, ev.clientY));
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!dragging) onClick?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function targetAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  return el?.dataset.drop ?? null;
}

async function drop(drag: Drag, target: string) {
  const s = useStore.getState();
  if (drag.kind === "items") {
    if (!target.startsWith("folder:")) return;
    const folderId = target.slice(7);
    const name = s.folders.find((f) => f.id === folderId)?.name ?? "";
    await s.run(() => api.addToFolder(drag.ids, folderId));
    s.toast(`${drag.ids.length} 件を「${name}」に追加しました`);
  } else {
    const parent = target === "root" ? null : target.slice(7);
    if (parent === drag.id) return;
    await s.run(async () => {
      if (!(await api.moveFolder(drag.id, parent))) {
        s.toast("フォルダを自分のサブフォルダには移動できません", true);
      }
    });
  }
}

export function DragLayer() {
  const drag = useStore((s) => s.drag);
  const items = useStore((s) => s.items);
  const folders = useStore((s) => s.folders);
  const active = drag !== null;

  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      const s = useStore.getState();
      if (s.drag) s.setDrag({ ...s.drag, x: e.clientX, y: e.clientY });
      s.setDropTarget(targetAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      const s = useStore.getState();
      const d = s.drag;
      const target = targetAt(e.clientX, e.clientY);
      s.setDrag(null);
      if (d && target) drop(d, target);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && useStore.getState().setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
    };
  }, [active]);

  if (!drag) return null;
  let label: string;
  let thumb: string | undefined;
  if (drag.kind === "items") {
    const first = items.find((i) => i.id === drag.ids[0]);
    thumb = first?.thumbPath;
    label = drag.ids.length > 1 ? `${drag.ids.length} 件` : (first?.name ?? "");
  } else {
    label = folders.find((f) => f.id === drag.id)?.name ?? "";
  }
  return (
    <div
      className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-md bg-accent px-2 py-1 text-white shadow-lg"
      style={{ left: drag.x + 12, top: drag.y + 12 }}
    >
      {thumb && <ThumbImg path={thumb} className="h-8 w-8 rounded object-cover" />}
      <span className="max-w-56 truncate">{label}</span>
    </div>
  );
}

export function ThumbImg({ path, className }: { path: string; className?: string }) {
  return <img src={convertFileSrc(path)} className={className} draggable={false} alt="" />;
}
