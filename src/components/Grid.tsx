import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, Star } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addToLastFolder,
  copySelection,
  createFolder,
  createFolderHere,
  deleteSelection,
  exportSelection,
  importFilesDialog,
  openSelection,
  setRating,
} from "../lib/actions";
import { api, type Item } from "../lib/api";
import { currentFolderId, useStore } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";

const PAD = 16;
const GAP = 12;
const LABEL = 34;

const Cell = memo(function Cell({
  item,
  index,
  selected,
  dimmed,
  size,
  reorderable,
  insert,
}: {
  item: Item;
  index: number;
  selected: boolean;
  dimmed: boolean;
  size: number;
  /** Manual-order folder view: the cell is a drop target for reordering. */
  reorderable: boolean;
  /** Where the reorder drop indicator is shown, if here. */
  insert: "before" | "after" | null;
}) {
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = useStore.getState();
    const mod = e.metaKey || e.ctrlKey;
    if (e.shiftKey) s.select(item.id, "range");
    else if (mod) s.select(item.id, "toggle");
    else if (!s.selected.has(item.id)) s.select(item.id, "only");
    startPointerDrag(
      e,
      () => ({ kind: "items", ids: [...useStore.getState().selected] }),
      // Plain click on an already-selected item narrows the selection to it.
      () => !e.shiftKey && !mod && useStore.getState().select(item.id, "only"),
    );
  };

  return (
    <div
      className={`relative flex flex-col items-center transition-[opacity,transform] duration-200 ${
        dimmed ? "scale-95 opacity-35" : ""
      }`}
      style={{ width: size }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().openViewer(index)}
      onContextMenu={(e) => showItemMenu(e, item, index)}
      data-drop={reorderable ? `item:${item.id}` : undefined}
    >
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-raised transition-shadow duration-150 ${
          selected ? "ring-3 ring-accent" : "hover:ring-2 hover:ring-white/15"
        }`}
        style={{ width: size, height: size }}
      >
        <img
          src={convertFileSrc(item.thumbPath)}
          loading="lazy"
          decoding="async"
          draggable={false}
          alt=""
          ref={(img) => {
            if (img?.complete) img.classList.add("loaded");
          }}
          onLoad={(e) => e.currentTarget.classList.add("loaded")}
          className="thumb max-h-full max-w-full object-contain"
        />
      </div>
      {insert && (
        <span
          className="pointer-events-none absolute top-0 w-1 animate-fade-in rounded-full bg-accent shadow-[0_0_8px] shadow-accent"
          style={{ height: size, [insert === "before" ? "left" : "right"]: -GAP / 2 - 2 }}
        />
      )}
      <div className="mt-1.5 w-full text-center">
        <div className={`truncate text-xs ${selected ? "text-white" : ""}`}>{item.name}</div>
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-dim tabular-nums">
          {item.rating > 0 && <Stars n={item.rating} />}
          <span>
            {item.width} × {item.height}
          </span>
        </div>
      </div>
    </div>
  );
});

function Stars({ n }: { n: number }) {
  return (
    <span className="flex text-amber-400" title={`★${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} size={9} fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  );
}

function showItemMenu(e: React.MouseEvent, item: Item, index: number) {
  const s = useStore.getState();
  if (!s.selected.has(item.id)) s.select(item.id, "only");
  const ids = [...useStore.getState().selected];
  const folder = currentFolderId();
  const many = ids.length > 1 ? `（${ids.length} 件）` : "";
  if (s.view.kind === "trash") {
    useMenu.getState().show(e, [
      { label: `復元${many}`, onClick: () => s.run(() => api.restoreItems(ids)) },
      { label: `完全に削除${many}`, danger: true, onClick: () => deleteSelection(ids) },
    ]);
    return;
  }
  useMenu.getState().show(e, [
    { label: "表示", hint: "Enter", onClick: () => s.openViewer(index) },
    { label: "既定のアプリで開く", onClick: () => openSelection(ids) },
    { label: "Finder / エクスプローラで表示", onClick: () => s.run(() => api.revealItem(item.id)) },
    { separator: true },
    { label: `コピー${many}`, hint: "⌘C", onClick: () => copySelection(ids) },
    { label: `書き出し…${many}`, onClick: () => exportSelection(ids) },
    { separator: true },
    { label: "フォルダに追加…", hint: "⌘⇧J", onClick: () => s.setPicker("add") },
    ...(s.recentFolders[0]
      ? [
          {
            label: `「${s.folders.find((f) => f.id === s.recentFolders[0])?.name}」に追加`,
            hint: "⇧D",
            onClick: () => addToLastFolder(ids),
          },
        ]
      : []),
    { label: "選択から新規フォルダ", onClick: () => createFolder(null, ids) },
    ...(folder
      ? [{ label: "このフォルダから外す", onClick: () => s.run(() => api.removeFromFolder(ids, folder)) }]
      : []),
    { separator: true },
    { label: `ゴミ箱へ移動${many}`, hint: "⌘⌫", danger: true, onClick: () => deleteSelection(ids) },
  ]);
}

type Rect = { x1: number; y1: number; x2: number; y2: number };

export function Grid() {
  const items = useStore((s) => s.items);
  const selected = useStore((s) => s.selected);
  const thumbSize = useStore((s) => s.thumbSize);
  const viewKind = useStore((s) => s.view.kind);
  const filtering = useStore((s) => s.search !== "" || s.tagFilter.length > 0);
  const dragIds = useStore((s) => (s.drag?.kind === "items" ? s.drag.ids : null));
  const dragging = useMemo(() => new Set(dragIds ?? []), [dragIds]);
  const reorderable = useStore(
    (s) => s.view.kind === "folder" && s.sort === "manual" && !s.showSubfolders,
  );
  const dropTarget = useStore((s) => (s.drag?.kind === "items" ? s.dropTarget : null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, width - PAD * 2);
  const cols = Math.max(1, Math.floor((inner + GAP) / (thumbSize + GAP)));
  const size = Math.max(40, Math.floor((inner - GAP * (cols - 1)) / cols));
  const rowH = size + LABEL + GAP;
  const rows = Math.ceil(items.length / cols);

  const virt = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 3,
    paddingStart: PAD,
    paddingEnd: PAD,
  });
  useEffect(() => virt.measure(), [rowH, virt]);

  const layout = useRef({ cols, size, rowH, items });
  layout.current = { cols, size, rowH, items };

  /** Ids of cells intersecting a rectangle in content coordinates. */
  const hitTest = (r: Rect): string[] => {
    const { cols, size, rowH, items } = layout.current;
    const top = Math.min(r.y1, r.y2);
    const bottom = Math.max(r.y1, r.y2);
    const left = Math.min(r.x1, r.x2);
    const right = Math.max(r.x1, r.x2);
    const hits: string[] = [];
    const r0 = Math.max(0, Math.floor((top - PAD) / rowH));
    const r1 = Math.floor((bottom - PAD) / rowH);
    for (let row = r0; row <= r1; row++) {
      const y0 = PAD + row * rowH;
      if (y0 > bottom || y0 + size + LABEL < top) continue;
      for (let c = 0; c < cols; c++) {
        const x0 = PAD + c * (size + GAP);
        const i = row * cols + c;
        if (i >= items.length) break;
        if (x0 <= right && x0 + size >= left) hits.push(items[i].id);
      }
    }
    return hits;
  };

  // Rubber-band selection on empty space; Shift/Cmd/Ctrl adds to the selection.
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (e.button !== 0 || !el) return;
    const box = el.getBoundingClientRect();
    if (e.clientX - box.left >= el.clientWidth) return; // scrollbar
    const s = useStore.getState();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? [...s.selected] : [];
    if (!additive) s.setSelection([]);
    const toContent = (cx: number, cy: number) => ({
      x: cx - box.left,
      y: cy - box.top + el.scrollTop,
    });
    const start = toContent(e.clientX, e.clientY);
    let pointer = { x: e.clientX, y: e.clientY };
    let moved = false;
    let raf = 0;

    const update = () => {
      const cur = toContent(pointer.x, pointer.y);
      const r = { x1: start.x, y1: start.y, x2: cur.x, y2: cur.y };
      setMarquee(r);
      const ids = new Set([...base, ...hitTest(r)]);
      useStore.getState().setSelection(layout.current.items.filter((i) => ids.has(i.id)).map((i) => i.id));
    };
    // Scroll while the pointer is held near the top/bottom edge.
    const tick = () => {
      const edge = 40;
      const dy =
        pointer.y < box.top + edge
          ? -(box.top + edge - pointer.y)
          : pointer.y > box.bottom - edge
            ? pointer.y - (box.bottom - edge)
            : 0;
      if (dy) {
        el.scrollTop += dy / 3;
        update();
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!moved) {
        moved = true;
        raf = requestAnimationFrame(tick);
      }
      update();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Keyboard shortcuts for the list (Eagle-compatible where possible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea, select")) return;
      const s = useStore.getState();
      if (s.viewer !== null || s.drag || s.picker) return;
      const mod = e.metaKey || e.ctrlKey;
      const sel = () => [...useStore.getState().selected];
      const handled = () => e.preventDefault();

      // Panels
      if (mod && e.altKey && e.code === "Digit1") return handled(), s.toggleSidebar();
      if (mod && e.altKey && e.code === "Digit2") return handled(), s.toggleInspector();
      if (mod && !e.altKey && e.code === "KeyI") return handled(), s.toggleInspector();
      if (e.key === "Tab" && !mod && !e.shiftKey) return handled(), s.toggleSidebar();

      // Selection / navigation
      if (mod && e.code === "KeyA") return handled(), s.setSelection(s.items.map((i) => i.id));
      if (mod && e.code === "KeyF") return handled(), document.getElementById("search")?.focus();
      if (mod && !e.shiftKey && e.code === "KeyJ") return handled(), s.setPicker("goto");

      // Organizing
      if (mod && e.shiftKey && e.code === "KeyJ") return handled(), s.selected.size && s.setPicker("add");
      if (mod && e.shiftKey && e.code === "KeyN") return handled(), void createFolderHere();
      if (!mod && e.shiftKey && e.code === "KeyD") return handled(), void addToLastFolder(sel());
      if (mod && !e.shiftKey && e.code === "KeyC") return handled(), void copySelection(sel());
      if (e.key === "F2" || (mod && e.code === "KeyR")) {
        handled();
        if (s.selected.size === 1) s.requestItemRename();
        else if (s.view.kind === "folder") s.setRenamingFolder(s.view.id);
        return;
      }

      // Thumbnail size
      if (mod && (e.key === "=" || e.key === "+" || e.key === ";")) {
        return handled(), s.setThumbSize(Math.min(360, s.thumbSize + 20));
      }
      if (mod && e.key === "-") return handled(), s.setThumbSize(Math.max(80, s.thumbSize - 20));

      // Ratings: 0-5, Shift+number rates and moves to the next image.
      const digit = /^(Digit|Numpad)([0-5])$/.exec(e.code);
      if (digit && !mod && !e.altKey) {
        handled();
        const ids = sel();
        if (!ids.length) return;
        void setRating(ids, Number(digit[2]));
        if (e.shiftKey) move(1, false);
        return;
      }

      const cur = s.items.findIndex((i) => i.id === s.focus);
      const delta: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -cols,
        ArrowDown: cols,
      };
      // A / D act like ← / → (Shift+D is "add to last folder" above).
      const key = !mod && !e.shiftKey && e.code === "KeyA" ? "ArrowLeft" : !mod && !e.shiftKey && e.code === "KeyD" ? "ArrowRight" : e.key;
      if (key in delta && !mod) {
        handled();
        move(delta[key], e.shiftKey);
      } else if ((e.key === " " || e.key === "Enter") && cur >= 0) {
        handled();
        s.openViewer(cur);
      } else if (e.key === "Delete" || (mod && e.key === "Backspace")) {
        // Plain Backspace no longer deletes (too easy to hit by accident).
        handled();
        void deleteSelection(sel());
      } else if (e.key === "Escape") {
        s.setSelection([]);
      }
    };
    const move = (d: number, extend: boolean) => {
      const s = useStore.getState();
      if (!s.items.length) return;
      const cur = s.items.findIndex((i) => i.id === s.focus);
      const next = cur < 0 ? 0 : Math.min(s.items.length - 1, Math.max(0, cur + d));
      s.select(s.items[next].id, extend ? "range" : "only");
      virt.scrollToIndex(Math.floor(next / cols));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cols, virt]);

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-y-auto"
      onPointerDown={onBackgroundPointerDown}
    >
      {items.length === 0 ? (
        <Empty kind={viewKind} filtering={filtering} />
      ) : (
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {marquee && (
            <div
              className="pointer-events-none absolute z-10 rounded-sm border border-accent bg-accent/15"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1),
              }}
            />
          )}
          {virt.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute left-0 flex"
              style={{ top: row.start, gap: GAP, paddingLeft: PAD, height: rowH }}
            >
              {items.slice(row.index * cols, row.index * cols + cols).map((item, j) => (
                <Cell
                  key={item.id}
                  item={item}
                  index={row.index * cols + j}
                  selected={selected.has(item.id)}
                  dimmed={dragging.has(item.id)}
                  size={size}
                  reorderable={reorderable}
                  insert={
                    dropTarget?.startsWith(`item:${item.id}:`)
                      ? (dropTarget.slice(-6) === "before" ? "before" : "after")
                      : null
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ kind, filtering }: { kind: string; filtering: boolean }) {
  if (kind === "trash") return <p className="mt-24 text-center text-dim">ゴミ箱は空です</p>;
  if (filtering) return <p className="mt-24 text-center text-dim">条件に一致する画像はありません</p>;
  if (kind === "unfiled" || kind === "untagged")
    return <p className="mt-24 text-center text-dim">該当する画像はありません</p>;
  if (kind === "folder")
    return (
      <div className="mt-24 flex flex-col items-center gap-2 text-dim">
        <ImagePlus size={40} strokeWidth={1.25} />
        <p>このフォルダは空です</p>
        <p className="text-xs">画像をサイドバーのフォルダへドラッグするか、ここにファイルをドロップして追加</p>
      </div>
    );
  return (
    <div className="mt-24 flex flex-col items-center gap-3 text-dim">
      <ImagePlus size={40} strokeWidth={1.25} />
      <p>画像やフォルダをここにドラッグ&ドロップ、またはクリップボードから貼り付け</p>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={importFilesDialog}
        className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:brightness-110"
      >
        画像を選択して追加
      </button>
    </div>
  );
}
