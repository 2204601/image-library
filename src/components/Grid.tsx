import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, Star } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addToLastFolder,
  copySelection,
  copyTags,
  createFolder,
  createFolderHere,
  createSmartFolder,
  deleteSelection,
  exportSelection,
  importFilesDialog,
  openSelection,
  pasteTags,
  resolveDuplicates,
  setRating,
  shiftFolder,
} from "../lib/actions";
import { api, formatBytes, type Item } from "../lib/api";
import {
  computeLayout,
  GAP,
  HEADER,
  neighbour,
  PAD,
  rawAspect,
  clampedAspect,
  visibleRange,
  type Placement,
} from "../lib/layouts";
import { currentFolderId, useStore, type ShowInfo } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";

/** Extra rows rendered above / below the viewport. */
const OVERSCAN = 600;

/** Index one past the last item of the group starting at `start`. */
function groupEnd(items: Item[], start: number): number {
  let end = start + 1;
  while (end < items.length && items[end].group === items[start].group) end++;
  return end;
}

function onItemPointerDown(e: React.PointerEvent, item: Item) {
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
}

function Thumb({ item, fit }: { item: Item; fit: "cover" | "contain" }) {
  return (
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
      // Cover when the box already has the image's shape (hides sub-pixel
      // rounding); clamped panoramas / strips and the grid layout show it whole.
      className={`thumb h-full w-full ${
        fit === "cover" && clampedAspect(item) === rawAspect(item) ? "object-cover" : "object-contain"
      }`}
    />
  );
}

type CellProps = {
  item: Item;
  index: number;
  selected: boolean;
  dimmed: boolean;
  width: number;
  height: number;
  label: number;
  fit: "cover" | "contain";
  info: ShowInfo;
  /** Manual-order folder view: the cell is a drop target for reordering. */
  reorderable: boolean;
  /** Where the reorder drop indicator is shown, if here. */
  insert: "before" | "after" | null;
  /** Similar view: this is the copy that would be kept. */
  best?: boolean;
};

const Cell = memo(function Cell({
  item,
  index,
  selected,
  dimmed,
  width,
  height,
  label,
  fit,
  info,
  reorderable,
  insert,
  best,
}: CellProps) {
  const detail = info.dims || info.rating || info.meta;
  return (
    <div
      className={`relative flex flex-col items-center transition-[opacity,transform] duration-200 ${
        dimmed ? "scale-95 opacity-35" : ""
      }`}
      style={{ width }}
      onPointerDown={(e) => onItemPointerDown(e, item)}
      onDoubleClick={() => useStore.getState().openViewer(index)}
      onContextMenu={(e) => showItemMenu(e, item, index)}
      data-drop={reorderable ? `item:${item.id}` : undefined}
    >
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-raised transition-shadow duration-150 ${
          selected ? "ring-3 ring-accent" : "hover:ring-2 hover:ring-white/15"
        }`}
        style={{ width, height }}
      >
        <Thumb item={item} fit={fit} />
        {best && (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
            最高画質
          </span>
        )}
      </div>
      {insert && (
        <span
          className="pointer-events-none absolute top-0 w-1 animate-fade-in rounded-full bg-accent shadow-[0_0_8px] shadow-accent"
          style={{ height, [insert === "before" ? "left" : "right"]: -GAP / 2 - 2 }}
        />
      )}
      {label > 0 && (
        <div className="mt-1.5 w-full text-center leading-[15px]">
          {info.name && <div className={`truncate text-xs ${selected ? "text-white" : ""}`}>{item.name}</div>}
          {detail && (
            <div className="flex items-center justify-center gap-1.5 overflow-hidden text-[11px] whitespace-nowrap text-dim tabular-nums">
              {info.rating && item.rating > 0 && <Stars n={item.rating} />}
              {info.dims && (
                <span>
                  {item.width} × {item.height}
                </span>
              )}
              {info.meta && (
                <span className="truncate">
                  {item.ext.toUpperCase()} · {formatBytes(item.size)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/** List layout row: thumbnail plus the details as columns. */
const ListRow = memo(function ListRow({
  item,
  index,
  selected,
  dimmed,
  width,
  height,
  reorderable,
  insert,
  best,
}: CellProps) {
  return (
    <div
      className={`relative flex items-center gap-3 rounded-md px-2 text-xs transition-opacity duration-200 ${
        selected ? "bg-accent/25 text-white" : "hover:bg-white/5"
      } ${dimmed ? "opacity-35" : ""}`}
      style={{ width, height }}
      onPointerDown={(e) => onItemPointerDown(e, item)}
      onDoubleClick={() => useStore.getState().openViewer(index)}
      onContextMenu={(e) => showItemMenu(e, item, index)}
      data-drop={reorderable ? `item:${item.id}` : undefined}
      data-axis="y"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-raised">
        <Thumb item={item} fit="contain" />
      </div>
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {item.name}
        {best && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">最高画質</span>}
      </span>
      <span className="w-24 shrink-0">{item.rating > 0 && <Stars n={item.rating} />}</span>
      <span className="w-28 shrink-0 text-right text-dim tabular-nums">
        {item.width} × {item.height}
      </span>
      <span className="w-12 shrink-0 text-dim uppercase">{item.ext}</span>
      <span className="w-20 shrink-0 text-right text-dim tabular-nums">{formatBytes(item.size)}</span>
      <span className="w-24 shrink-0 text-right text-dim tabular-nums @max-3xl:hidden">
        {new Date(item.importedAt).toLocaleDateString("ja-JP")}
      </span>
      {insert && (
        <span
          className={`pointer-events-none absolute right-2 left-2 h-0.5 rounded-full bg-accent shadow-[0_0_6px] shadow-accent ${
            insert === "before" ? "-top-px" : "-bottom-px"
          }`}
        />
      )}
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
  const kind = useStore((s) => s.layout);
  const info = useStore((s) => s.showInfo);
  const viewKind = useStore((s) => s.view.kind);
  const analyzing = useStore((s) => s.analyzing);
  const filtering = useStore((s) => s.search !== "" || s.tagFilter.length > 0);
  const dragIds = useStore((s) => (s.drag?.kind === "items" ? s.drag.ids : null));
  const dragging = useMemo(() => new Set(dragIds ?? []), [dragIds]);
  const reorderable = useStore(
    (s) => s.view.kind === "folder" && s.sort === "manual" && !s.showSubfolders,
  );
  const dropTarget = useStore((s) => (s.drag?.kind === "items" ? s.dropTarget : null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [marquee, setMarquee] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setViewport({ top: el.scrollTop, height: el.clientHeight });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, width - PAD * 2);
  const placement = useMemo<Placement>(
    () =>
      inner > 0
        ? computeLayout(kind, items, inner, thumbSize, info)
        : { boxes: [], headers: [], height: 0, label: 0, fit: "cover" },
    [kind, items, inner, thumbSize, info],
  );
  const visible = useMemo(
    () => visibleRange(placement, viewport.top - OVERSCAN, viewport.top + viewport.height + OVERSCAN),
    [placement, viewport],
  );

  const layout = useRef({ placement, items });
  layout.current = { placement, items };

  // Re-render on scroll, at most once per frame.
  const frame = useRef(0);
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scrollRef.current;
      if (el) setViewport({ top: el.scrollTop, height: el.clientHeight });
    });
  };

  /** Scrolls item `i` into view. */
  const reveal = (i: number) => {
    const el = scrollRef.current;
    const b = layout.current.placement.boxes[i];
    if (!el || !b) return;
    const bottom = b.y + b.h + layout.current.placement.label;
    if (b.y - PAD < el.scrollTop) el.scrollTop = b.y - PAD;
    else if (bottom + PAD > el.scrollTop + el.clientHeight) el.scrollTop = bottom + PAD - el.clientHeight;
  };

  // Keep the focused item on screen when the layout changes (e.g. switching layouts).
  useEffect(() => {
    const s = useStore.getState();
    const i = s.items.findIndex((it) => it.id === s.focus);
    if (i >= 0) reveal(i);
  }, [kind]);

  /** Ids of cells intersecting a rectangle in content coordinates. */
  const hitTest = (r: Rect): string[] => {
    const { placement, items } = layout.current;
    const top = Math.min(r.y1, r.y2);
    const bottom = Math.max(r.y1, r.y2);
    const left = Math.min(r.x1, r.x2);
    const right = Math.max(r.x1, r.x2);
    const hits: string[] = [];
    placement.boxes.forEach((b, i) => {
      if (b.x <= right && b.x + b.w >= left && b.y <= bottom && b.y + b.h + placement.label >= top) {
        hits.push(items[i].id);
      }
    });
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
      if (mod && e.shiftKey && e.code === "KeyF") return handled(), s.toggleFilterOpen();
      if (mod && e.code === "KeyF") return handled(), document.getElementById("search")?.focus();
      if (mod && !e.shiftKey && e.code === "KeyJ") return handled(), s.setPicker("goto");

      // Organizing
      if (mod && e.shiftKey && e.code === "KeyJ") return handled(), s.selected.size && s.setPicker("add");
      if (mod && e.shiftKey && e.altKey && e.code === "KeyN") return handled(), void createSmartFolder();
      if (mod && e.shiftKey && e.code === "KeyN") return handled(), void createFolderHere();
      // Folder order: ⌘[ / ⌘] one step, with Shift to the top / bottom.
      if (mod && (e.code === "BracketLeft" || e.code === "BracketRight") && s.view.kind === "folder") {
        handled();
        void shiftFolder(s.view.id, e.code === "BracketLeft" ? -1 : 1, e.shiftKey);
        return;
      }
      if (mod && e.shiftKey && e.code === "KeyC") return handled(), void copyTags(sel());
      if (mod && e.shiftKey && e.code === "KeyV") return handled(), void pasteTags(sel());
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
      const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
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
    /** ±1 = previous/next item, ±2 = the box above/below (layout-aware). */
    const move = (d: number, extend: boolean) => {
      const s = useStore.getState();
      const { placement } = layout.current;
      if (!s.items.length || !placement.boxes.length) return;
      const cur = s.items.findIndex((i) => i.id === s.focus);
      let next: number;
      if (cur < 0) next = 0;
      else if (Math.abs(d) === 1) next = Math.min(s.items.length - 1, Math.max(0, cur + d));
      else next = neighbour(placement, cur, d < 0 ? "up" : "down");
      s.select(s.items[next].id, extend ? "range" : "only");
      reveal(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Comp = kind === "list" ? ListRow : Cell;
  return (
    <div
      ref={scrollRef}
      className="@container relative min-h-0 flex-1 overflow-y-auto"
      onScroll={onScroll}
      onPointerDown={onBackgroundPointerDown}
    >
      {items.length === 0 ? (
        <Empty kind={viewKind} filtering={filtering} analyzing={analyzing} />
      ) : (
        <div style={{ height: placement.height, position: "relative" }}>
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
          {placement.headers.map((h) => (
            <div key={`h${h.start}`} className="absolute left-0" style={{ top: h.y, width }}>
              <GroupHeader items={items} start={h.start} selected={selected} />
            </div>
          ))}
          {visible.map((i) => {
            const item = items[i];
            const b = placement.boxes[i];
            return (
              <div key={item.id} className="absolute" style={{ left: b.x, top: b.y }}>
                <Comp
                  item={item}
                  index={i}
                  selected={selected.has(item.id)}
                  dimmed={dragging.has(item.id)}
                  width={b.w}
                  height={b.h}
                  label={placement.label}
                  fit={placement.fit}
                  info={info}
                  reorderable={reorderable}
                  insert={
                    dropTarget?.startsWith(`item:${item.id}:`)
                      ? dropTarget.endsWith("before")
                        ? "before"
                        : "after"
                      : null
                  }
                  best={item.group !== undefined && (i === 0 || items[i - 1].group !== item.group)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Similar view: names the group and offers to keep one copy. */
function GroupHeader({ items, start, selected }: { items: Item[]; start: number; selected: Set<string> }) {
  const group = items.slice(start, groupEnd(items, start));
  // Keep the copy the user picked, if exactly one in this group is selected.
  const picked = group.filter((i) => selected.has(i.id));
  const keep = picked.length === 1 ? picked[0] : group[0];
  const ids = [keep.id, ...group.filter((i) => i !== keep).map((i) => i.id)];
  return (
    <div
      className={`flex items-center gap-3 text-xs ${start > 0 ? "border-t border-line" : ""}`}
      style={{ height: HEADER - 8, marginLeft: PAD, marginRight: PAD, marginBottom: 8 }}
    >
      <span className="font-semibold">グループ {(group[0].group ?? 0) + 1}</span>
      <span className="text-dim">{group.length} 件</span>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => resolveDuplicates([ids])}
        title="残す1枚にタグ・フォルダ・評価を引き継ぎ、他はゴミ箱へ移動します"
        className="ml-auto rounded-md border border-line px-2 py-0.5 hover:bg-white/5"
      >
        {picked.length === 1 ? "選択中の1枚を残して整理" : "最高画質の1枚を残して整理"}
      </button>
    </div>
  );
}

function Empty({ kind, filtering, analyzing }: { kind: string; filtering: boolean; analyzing: boolean }) {
  if (kind === "trash") return <p className="mt-24 text-center text-dim">ゴミ箱は空です</p>;
  if (kind === "similar")
    return (
      <p className="mt-24 text-center text-dim">
        {analyzing ? "画像を解析しています…" : "似ている画像は見つかりませんでした"}
      </p>
    );
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
