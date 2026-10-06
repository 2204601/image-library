// In-app drag & drop (images -> folder, folder -> folder) built on pointer
// events. HTML5 DnD is avoided because Tauri's native file-drop handling
// disables it on Windows.
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { addToFolders, reorder } from "../lib/actions";
import { api, type Folder } from "../lib/api";
import { useStore, type Drag } from "../store";

const THRESHOLD = 5;

/**
 * Call from onPointerDown. Starts a drag once the pointer moves a few pixels;
 * otherwise `onClick` runs on release.
 */
export function startPointerDrag(
  e: React.PointerEvent,
  makeDrag: () => { kind: "items"; ids: string[] } | { kind: "folder"; id: string },
  onClick?: () => void,
) {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > THRESHOLD) {
      dragging = true;
      useStore.getState().setDrag({ ...makeDrag(), x: ev.clientX, y: ev.clientY, sx, sy });
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

function isDescendant(folders: Folder[], id: string, ancestor: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (let f = byId.get(id); f; f = f.parentId ? byId.get(f.parentId) : undefined) {
    if (f.id === ancestor) return true;
  }
  return false;
}

/**
 * The drop target under the pointer, or null if this drag can't go there.
 * "folder:<id>" | "root" | "item:<id>:before|after" (manual reordering).
 */
function targetAt(x: number, y: number, drag: Drag): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  const t = el?.dataset.drop ?? null;
  if (!t || !el) return null;
  if (drag.kind === "items") {
    if (t.startsWith("folder:")) return t;
    if (t.startsWith("item:") && !drag.ids.includes(t.slice(5))) {
      const r = el.getBoundingClientRect();
      return `${t}:${x < r.left + r.width / 2 ? "before" : "after"}`;
    }
    return null;
  }
  if (t !== "root" && !t.startsWith("folder:")) return null;
  if (t === "root") {
    const f = useStore.getState().folders.find((x) => x.id === drag.id);
    return f?.parentId ? t : null; // already top-level
  }
  const fid = t.slice(7);
  // A folder can't go into itself or its own subfolders.
  return isDescendant(useStore.getState().folders, fid, drag.id) ? null : t;
}

function targetRect(target: string): DOMRect | null {
  const base = target.replace(/:(before|after)$/, "");
  return document.querySelector(`[data-drop="${CSS.escape(base)}"]`)?.getBoundingClientRect() ?? null;
}

async function drop(drag: Drag, target: string) {
  const s = useStore.getState();
  if (drag.kind === "items" && target.startsWith("item:")) {
    const [, id, side] = target.split(":");
    // Keep the dragged items in their current visual order.
    const moving = s.items.filter((i) => drag.ids.includes(i.id)).map((i) => i.id);
    let before: string | null = id;
    if (side === "after") {
      const rest = s.items.filter((i) => !drag.ids.includes(i.id));
      before = rest[rest.findIndex((i) => i.id === id) + 1]?.id ?? null;
    }
    await reorder(moving, before);
  } else if (drag.kind === "items") {
    await addToFolders(drag.ids, [target.slice(7)]);
  } else {
    await s.run(() => api.moveFolder(drag.id, target === "root" ? null : target.slice(7)));
    s.flashTarget(target);
  }
}

/** Leaving the window with images hands the drag to the OS (drop into other apps). */
function dragOut(drag: Drag & { kind: "items" }) {
  const items = useStore.getState().items.filter((i) => drag.ids.includes(i.id));
  if (!items.length) return;
  startDrag({ item: items.map((i) => i.filePath), icon: items[0].thumbPath }).catch((e) =>
    console.warn("drag out failed", e),
  );
}

function targetLabel(target: string | null, folders: Folder[]): string | null {
  if (!target) return null;
  if (target === "root") return "最上位へ移動";
  if (target.startsWith("item:")) return "ここへ並べ替え";
  const name = folders.find((f) => f.id === target.slice(7))?.name;
  return name ? `「${name}」へ` : null;
}

export function DragLayer() {
  const drag = useStore((s) => s.drag);
  const dropTarget = useStore((s) => s.dropTarget);
  const items = useStore((s) => s.items);
  const folders = useStore((s) => s.folders);
  const ghost = useRef<HTMLDivElement>(null);
  const active = drag !== null;

  useEffect(() => {
    if (!active) return;
    document.body.style.cursor = "grabbing";
    let landing = false; // ignore input while the drop animation plays
    const move = (e: PointerEvent) => {
      const s = useStore.getState();
      if (!s.drag || landing) return;
      const edge = 2;
      const outside =
        e.clientX <= edge ||
        e.clientY <= edge ||
        e.clientX >= window.innerWidth - edge ||
        e.clientY >= window.innerHeight - edge;
      if (outside && s.drag.kind === "items" && !("__MOCK_BACKEND__" in window)) {
        landing = true;
        const d = s.drag;
        s.setDrag(null);
        dragOut(d);
        return;
      }
      s.setDrag({ ...s.drag, x: e.clientX, y: e.clientY });
      s.setDropTarget(targetAt(e.clientX, e.clientY, s.drag));
    };
    const finish = async (commit: boolean, e?: PointerEvent) => {
      const s = useStore.getState();
      const d = s.drag;
      const el = ghost.current;
      if (!d || landing) return;
      landing = true;
      const target = commit && e ? targetAt(e.clientX, e.clientY, d) : null;
      const rect = target ? targetRect(target) : null;
      // Animate the ghost into the target row, or back to where it came from.
      if (el) {
        const to = rect
          ? { x: rect.left + 24 - d.x - 12, y: rect.top + rect.height / 2 - d.y - 12, scale: 0.2, opacity: 0.2 }
          : { x: d.sx - d.x, y: d.sy - d.y, scale: 0.6, opacity: 0 };
        const duration = rect ? 320 : 260;
        const anim = el.animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: `translate(${to.x}px, ${to.y}px) scale(${to.scale})`, opacity: to.opacity },
          ],
          { duration, easing: "cubic-bezier(0.5, 0, 0.3, 1)", fill: "forwards" },
        );
        // `finished` can stay pending if the animation is dropped (e.g. the
        // element re-renders), so never wait longer than the animation itself.
        await new Promise<void>((done) => {
          anim.onfinish = anim.oncancel = () => done();
          setTimeout(done, duration + 100);
        });
      }
      s.setDrag(null);
      if (d && target) drop(d, target);
    };
    const up = (e: PointerEvent) => finish(true, e);
    const key = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
    };
  }, [active]);

  if (!drag) return null;
  const label = targetLabel(dropTarget, folders);

  return (
    <div
      ref={ghost}
      className="pointer-events-none fixed z-50"
      style={{ left: drag.x + 12, top: drag.y + 12, transformOrigin: "0 0" }}
    >
      {drag.kind === "items" ? (
        <ItemsGhost ids={drag.ids} items={items} />
      ) : (
        <div className="rounded-md bg-raised px-3 py-1.5 shadow-xl ring-1 ring-accent">
          📁 {folders.find((f) => f.id === drag.id)?.name}
        </div>
      )}
      <div
        className={`mt-2 w-max rounded-md px-2 py-0.5 text-xs shadow-lg transition-colors ${
          label ? "bg-accent text-white" : "bg-black/70 text-white/70"
        }`}
      >
        {label ?? (drag.kind === "items" ? "フォルダへドロップ / 窓の外で他のアプリへ" : "移動先のフォルダへドロップ")}
      </div>
    </div>
  );
}

function ItemsGhost({ ids, items }: { ids: string[]; items: { id: string; thumbPath: string }[] }) {
  const thumbs = ids
    .slice(0, 3)
    .map((id) => items.find((i) => i.id === id)?.thumbPath)
    .filter(Boolean) as string[];
  return (
    <div className="relative h-20 w-20">
      {thumbs
        .map((t, i) => (
          <img
            key={t}
            src={convertFileSrc(t)}
            draggable={false}
            alt=""
            className="absolute inset-0 h-20 w-20 rounded-lg bg-raised object-cover shadow-xl ring-2 ring-white/80"
            style={{ transform: `rotate(${[0, -7, 6][i]}deg) translate(${i * 3}px, ${i * 2}px)` }}
          />
        ))
        .reverse()}
      {ids.length > 1 && (
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-bold text-white shadow">
          {ids.length}
        </span>
      )}
    </div>
  );
}
