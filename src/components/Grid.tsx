import { convertFileSrc } from "@tauri-apps/api/core";
import { Check, Heart, ImagePlus, Layers, Pin, Star, Trash2 } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  moveToLastFolder,
  copySelection,
  copyTags,
  createFolder,
  createFolderHere,
  createSmartFolder,
  deleteSelection,
  exportSelection,
  importFilesDialog,
  openSelection,
  openSheet,
  orient,
  pasteTags,
  keepPlan,
  keeperOf,
  dismissDuplicates,
  reviewDuplicates,
  similarGroups,
  setRating,
  shiftFolder,
  toggleFavorite,
  togglePinned,
  toggleTray,
} from "../lib/actions";
import { FontListCells, SpecimenRow } from "../features/fonts/FontRows";
import { api, formatBytes, kindLabel, sizeLabel, type Item } from "../lib/api";
import { colorHex } from "../lib/colors";
import type { Section } from "../lib/grouping";
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
import { activeConditions, currentFolderId, MODES, useStore, type Mode, type ShowInfo } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";

/** Extra rows rendered above / below the viewport. */
const OVERSCAN = 600;

/**
 * Display index of the focused item. With tag grouping an image can appear
 * more than once, so the position it was clicked / moved to is remembered
 * and preferred over the first occurrence.
 */
let focusAt: number | null = null;
function focusIndex(s: { items: Item[]; focus: string | null }): number {
  if (focusAt !== null && s.items[focusAt]?.id === s.focus) return focusAt;
  return s.items.findIndex((i) => i.id === s.focus);
}

export function onItemPointerDown(e: React.PointerEvent, item: Item, index: number) {
  if (e.button !== 0) return;
  e.stopPropagation();
  focusAt = index;
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

export type CellProps = {
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
  /** Similar view: what the tidy-up would do with this copy. */
  similar?: SimilarMark;
  /** Show the favourite / pin marks (hidden in the similar view). */
  flags: boolean;
};

/** Favourite heart (also a toggle on hover) and pin mark on a thumbnail. */
function FlagOverlay({ item }: { item: Item }) {
  // Everything in the tray view is on the tray; the mark would only add noise.
  const trayMark = useStore((s) => item.inTray && s.view.kind !== "tray");
  return (
    <>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={() => toggleFavorite([item.id])}
        title={item.favorite ? "お気に入りから外す（F）" : "お気に入りに追加（F）"}
        className={`absolute top-1.5 right-1.5 rounded-full p-1 transition-colors ${
          item.favorite
            ? "bg-black/45 text-pink-400 hover:bg-black/70"
            : "hidden bg-black/45 text-white/80 group-hover:block hover:text-pink-400"
        }`}
      >
        <Heart size={13} fill={item.favorite ? "currentColor" : "none"} strokeWidth={2} />
      </button>
      {(item.pinnedAt !== null || trayMark) && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 flex gap-1">
          {item.pinnedAt !== null && (
            <span title="ピン留め中（一覧の先頭に表示）" className="pointer-events-auto rounded-full bg-accent p-1 text-white shadow">
              <Pin size={11} fill="currentColor" strokeWidth={2} />
            </span>
          )}
          {trayMark && (
            <span title="作業台にあります（B で外す）" className="pointer-events-auto rounded-full bg-emerald-600 p-1 text-white shadow">
              <Layers size={11} strokeWidth={2.25} />
            </span>
          )}
        </span>
      )}
    </>
  );
}

type SimilarMark = {
  /** This copy would be kept (otherwise trashed). */
  keep: boolean;
  /** Highest quality of its group. */
  best: boolean;
  /** Percent match with the best copy. */
  match: number;
};

/** Badges on a thumbnail in the similar view. */
function SimilarOverlay({ item, mark }: { item: Item; mark: SimilarMark }) {
  return (
    <>
      {!mark.keep && <div className="pointer-events-none absolute inset-0 bg-black/40" />}
      <span
        className={`absolute top-1.5 left-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${
          mark.keep ? "bg-emerald-600/90" : "bg-danger/85"
        }`}
      >
        {mark.keep ? <Check size={11} strokeWidth={3} /> : <Trash2 size={11} />}
        {mark.keep ? "残す" : "ゴミ箱へ"}
      </span>
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
        {mark.best ? "最高画質" : `一致 ${mark.match}%`}
      </span>
      {!mark.keep && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => useStore.getState().pickKeeper(item.id)}
          className="absolute top-1.5 right-1.5 hidden rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-black shadow group-hover:block hover:bg-white/90"
        >
          これを残す
        </button>
      )}
    </>
  );
}

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
  similar,
  flags,
}: CellProps) {
  const detail = info.dims || info.rating || info.meta;
  return (
    <div
      className={`group relative flex flex-col items-center transition-[opacity,transform] duration-200 ${
        dimmed ? "scale-95 opacity-35" : ""
      }`}
      style={{ width }}
      onPointerDown={(e) => onItemPointerDown(e, item, index)}
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
        {similar && <SimilarOverlay item={item} mark={similar} />}
        {flags && <FlagOverlay item={item} />}
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
                  {sizeLabel(item)}
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
  similar,
  flags,
}: CellProps) {
  return (
    <div
      className={`relative flex items-center gap-3 rounded-md px-2 text-xs transition-opacity duration-200 ${
        selected ? "bg-accent/25 text-white" : "hover:bg-white/5"
      } ${dimmed ? "opacity-35" : ""}`}
      style={{ width, height }}
      onPointerDown={(e) => onItemPointerDown(e, item, index)}
      onDoubleClick={() => useStore.getState().openViewer(index)}
      onContextMenu={(e) => showItemMenu(e, item, index)}
      data-drop={reorderable ? `item:${item.id}` : undefined}
      data-axis="y"
    >
      {item.kind === "font" ? (
        <FontListCells item={item} />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-raised">
          <Thumb item={item} fit="contain" />
        </div>
      )}
      <span className={`min-w-0 truncate text-[13px] ${item.kind === "font" ? "hidden" : "flex-1"}`}>
        {item.name}
        {similar && (
          <span
            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] text-white ${
              similar.keep ? "bg-emerald-600/90" : "bg-danger/85"
            }`}
          >
            {similar.keep ? "残す" : "ゴミ箱へ"}
          </span>
        )}
        {similar && (
          <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">
            {similar.best ? "最高画質" : `一致 ${similar.match}%`}
          </span>
        )}
        {similar && !similar.keep && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useStore.getState().pickKeeper(item.id)}
            className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] hover:bg-white/10"
          >
            これを残す
          </button>
        )}
      </span>
      <span className="flex w-10 shrink-0 items-center gap-1">
        {flags && item.pinnedAt !== null && <Pin size={12} className="text-accent" fill="currentColor" />}
        {flags && item.inTray && <Layers size={12} className="text-emerald-400" />}
        {flags && item.favorite && <Heart size={12} className="text-pink-400" fill="currentColor" />}
      </span>
      <span className="w-24 shrink-0">{item.rating > 0 && <Stars n={item.rating} />}</span>
      <span className="w-28 shrink-0 text-right text-dim tabular-nums">
        {sizeLabel(item)}
      </span>
      <span className="w-12 shrink-0 text-dim uppercase">{item.ext}</span>
      <span className="w-20 shrink-0 text-right text-dim tabular-nums">{formatBytes(item.size)}</span>
      <span className="w-24 shrink-0 text-right text-dim tabular-nums @max-4xl:hidden">
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

export function Stars({ n, size = 9 }: { n: number; size?: number }) {
  return (
    <span className="flex text-amber-400" title={`★${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} size={size} fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  );
}

export function showItemMenu(e: React.MouseEvent, item: Item, index: number) {
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
  const all = (flag: (i: Item) => boolean) => ids.every((id) => flag(s.rawItems.find((i) => i.id === id)!));
  const allFav = all((i) => i.favorite);
  const allPinned = all((i) => i.pinnedAt !== null);
  const allInTray = all((i) => i.inTray);
  const turned = !all((i) => i.rotation === 0 && !i.flipped);
  // Only images can be rotated; the entries go when there are none selected.
  const rotatable = !all((i) => i.kind !== "image");
  useMenu.getState().show(e, [
    { label: "表示", hint: "Enter", onClick: () => s.openViewer(index) },
    { label: "既定のアプリで開く", onClick: () => openSelection(ids) },
    { label: "Finder / エクスプローラで表示", onClick: () => s.run(() => api.revealItem(item.id)) },
    { separator: true },
    { label: allFav ? `お気に入りから外す${many}` : `お気に入りに追加${many}`, hint: "F", onClick: () => toggleFavorite(ids) },
    { label: allPinned ? `ピン留めを解除${many}` : `ピン留め${many}`, hint: "P", onClick: () => togglePinned(ids) },
    { label: allInTray ? `作業台から外す${many}` : `作業台に追加${many}`, hint: "B", onClick: () => toggleTray(ids) },
    { separator: true },
    ...(rotatable
      ? [
          { label: `左に回転${many}`, hint: "⌘⇧L", onClick: () => orient(ids, "rotateCcw") },
          { label: `右に回転${many}`, hint: "⌘⇧R", onClick: () => orient(ids, "rotateCw") },
          { label: `左右反転${many}`, onClick: () => orient(ids, "flipH") },
          { label: `上下反転${many}`, onClick: () => orient(ids, "flipV") },
          ...(turned ? [{ label: `元の向きに戻す${many}`, onClick: () => orient(ids, "reset") }] : []),
          { separator: true as const },
        ]
      : []),
    { label: `コピー${many}`, hint: "⌘C", onClick: () => copySelection(ids) },
    { label: `書き出し…${many}`, onClick: () => exportSelection(ids) },
    { label: `まとめて出力…${many}`, onClick: () => openSheet(ids) },
    { separator: true },
    { label: "フォルダへ移動…", hint: "⌘⇧J", onClick: () => s.setPicker("move") },
    ...(s.recentFolders[0]
      ? [
          {
            label: `「${s.folders.find((f) => f.id === s.recentFolders[0])?.name}」へ移動`,
            hint: "⇧D",
            onClick: () => moveToLastFolder(ids),
          },
        ]
      : []),
    { label: "選択から新規フォルダ", onClick: () => createFolder(null, ids) },
    {
      label: `別のライブラリへ…${many}`,
      onClick: () => s.setTransfer({ ids, kind: s.mode, count: ids.length }),
    },
    ...(folder
      ? [{ label: "未分類に戻す", onClick: () => s.run(() => api.removeFromFolder(ids, folder)) }]
      : []),
    { separator: true },
    { label: `ゴミ箱へ移動${many}`, hint: "⌘⌫", danger: true, onClick: () => deleteSelection(ids) },
  ]);
}

type Rect = { x1: number; y1: number; x2: number; y2: number };

export function Grid() {
  const items = useStore((s) => s.items);
  const sections = useStore((s) => s.sections);
  const selected = useStore((s) => s.selected);
  const thumbSize = useStore((s) => s.thumbSize);
  const specimenSize = useStore((s) => s.specimenSize);
  const kind = useStore((s) => s.layout);
  const showInfo = useStore((s) => s.showInfo);
  const viewKind = useStore((s) => s.view.kind);
  const mode = useStore((s) => s.mode);
  const keepPick = useStore((s) => s.keepPick);
  // Comparing copies needs their size and format at a glance.
  const info = useMemo(
    () => (viewKind === "similar" ? { ...showInfo, name: true, dims: true, meta: true } : showInfo),
    [viewKind, showInfo],
  );
  const keepIds = useMemo(
    () => new Set(viewKind === "similar" ? similarGroups(items).map((g) => keeperOf(g, keepPick).id) : []),
    [viewKind, items, keepPick],
  );
  const analyzing = useStore((s) => s.analyzing);
  const filtering = useStore((s) => activeConditions(s) > 0);
  const dragIds = useStore((s) => (s.drag?.kind === "items" ? s.drag.ids : null));
  const dragging = useMemo(() => new Set(dragIds ?? []), [dragIds]);
  const reorderable = useStore(
    (s) => s.sort === "manual" && ((s.view.kind === "folder" && !s.showSubfolders) || s.view.kind === "tray"),
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
        ? computeLayout(kind, items, inner, kind === "specimen" ? specimenSize : thumbSize, info, sections)
        : { boxes: [], headers: [], height: 0, label: 0, fit: "cover" },
    [kind, items, inner, thumbSize, specimenSize, info, sections],
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
    const i = focusIndex(useStore.getState());
    if (i >= 0) reveal(i);
  }, [kind, sections]);

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
      if (s.viewer !== null || s.drag || s.picker || s.sheet) return;
      const mod = e.metaKey || e.ctrlKey;
      const sel = () => [...useStore.getState().selected];
      const handled = () => e.preventDefault();

      // Panels
      if (mod && e.altKey && e.code === "Digit1") return handled(), s.toggleSidebar();
      if (mod && e.altKey && e.code === "Digit2") return handled(), s.toggleInspector();
      // ⌘1 / ⌘2 / ⌘3: images / fonts / files.
      const modeKey = MODES[Number(/^Digit([1-9])$/.exec(e.code)?.[1]) - 1];
      if (mod && !e.altKey && !e.shiftKey && modeKey) return handled(), s.setMode(modeKey);
      if (mod && !e.altKey && e.code === "KeyI") return handled(), s.toggleInspector();
      if (e.key === "Tab" && !mod && !e.shiftKey) return handled(), s.toggleSidebar();

      // Selection / navigation
      if (mod && e.code === "KeyA") return handled(), s.setSelection(s.items.map((i) => i.id));
      if (mod && e.shiftKey && e.code === "KeyF") return handled(), s.toggleFilterOpen();
      if (mod && e.code === "KeyF") return handled(), document.getElementById("search")?.focus();
      if (mod && !e.shiftKey && e.code === "KeyJ") return handled(), s.setPicker("goto");

      // Organizing
      if (mod && e.shiftKey && e.code === "KeyJ") return handled(), s.selected.size && s.setPicker("move");
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
      if (!mod && e.shiftKey && e.code === "KeyD") return handled(), void moveToLastFolder(sel());
      if (mod && !e.shiftKey && e.code === "KeyC") return handled(), void copySelection(sel());
      // Favourite / pin (not in the trash).
      if (!mod && !e.shiftKey && !e.altKey && e.code === "KeyF" && s.view.kind !== "trash") {
        return handled(), void toggleFavorite(sel());
      }
      if (!mod && !e.shiftKey && !e.altKey && e.code === "KeyP" && s.view.kind !== "trash") {
        return handled(), void togglePinned(sel());
      }
      if (!mod && !e.shiftKey && !e.altKey && e.code === "KeyB" && s.view.kind !== "trash") {
        return handled(), void toggleTray(sel());
      }
      // Rotate (before ⌘R = rename). The files are not changed.
      if (mod && e.shiftKey && !e.altKey && (e.code === "KeyR" || e.code === "KeyL") && s.view.kind !== "trash") {
        return handled(), void orient(sel(), e.code === "KeyR" ? "rotateCw" : "rotateCcw");
      }
      if (e.key === "F2" || (mod && e.code === "KeyR")) {
        handled();
        if (s.selected.size === 1) s.requestItemRename();
        else if (s.view.kind === "folder") s.setRenamingFolder(s.view.id);
        return;
      }

      // Thumbnail size
      // (the sample size in the specimen layout)
      if (mod && (e.key === "=" || e.key === "+" || e.key === ";")) {
        if (s.layout === "specimen") return handled(), s.setSpecimenSize(s.specimenSize + 8);
        return handled(), s.setThumbSize(Math.min(360, s.thumbSize + 20));
      }
      if (mod && e.key === "-") {
        if (s.layout === "specimen") return handled(), s.setSpecimenSize(s.specimenSize - 8);
        return handled(), s.setThumbSize(Math.max(80, s.thumbSize - 20));
      }

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

      const cur = focusIndex(s);
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
      const cur = focusIndex(s);
      let next: number;
      if (cur < 0) next = 0;
      else if (Math.abs(d) === 1) next = Math.min(s.items.length - 1, Math.max(0, cur + d));
      else next = neighbour(placement, cur, d < 0 ? "up" : "down");
      focusAt = next;
      s.select(s.items[next].id, extend ? "range" : "only");
      reveal(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Comp = kind === "list" ? ListRow : kind === "specimen" ? SpecimenRow : Cell;
  return (
    <div
      ref={scrollRef}
      className="@container relative min-h-0 flex-1 overflow-y-auto"
      onScroll={onScroll}
      onPointerDown={onBackgroundPointerDown}
    >
      {items.length === 0 ? (
        <Empty kind={viewKind} mode={mode} filtering={filtering} analyzing={analyzing} />
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
          {placement.headers.map((h, n) => (
            <div key={`h${h.start}`} className="absolute left-0" style={{ top: h.y, width }}>
              {viewKind === "similar" ? (
                <GroupHeader items={items} section={sections[n]} keepPick={keepPick} />
              ) : (
                <SectionHeader items={items} section={sections[n]} />
              )}
            </div>
          ))}
          {visible.map((i) => {
            const item = items[i];
            const b = placement.boxes[i];
            return (
              // With tag grouping an image can appear in several sections.
              <div key={`${item.id}:${i}`} className="absolute" style={{ left: b.x, top: b.y }}>
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
                  similar={
                    item.group === undefined
                      ? undefined
                      : {
                          keep: keepIds.has(item.id),
                          best: i === 0 || items[i - 1].group !== item.group,
                          match: Math.round((1 - (item.distance ?? 0) / 64) * 100),
                        }
                  }
                  flags={viewKind !== "similar" && viewKind !== "trash"}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Band above a rating / tag / folder section; clicking it selects the section. */
function SectionHeader({ items, section }: { items: Item[]; section: Section }) {
  const { start, end, title, color, rating } = section;
  const hex = colorHex(color);
  return (
    <div
      className={`flex cursor-default items-center gap-2 text-xs ${start > 0 ? "border-t border-line" : ""}`}
      style={{ height: HEADER - 8, marginLeft: PAD, marginRight: PAD, marginBottom: 8 }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => useStore.getState().setSelection(items.slice(start, end).map((i) => i.id))}
      title="クリックでこの区切りをすべて選択"
    >
      {rating !== undefined && rating > 0 ? <Stars n={rating} size={12} /> : null}
      {hex && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex }} />}
      <span className={`truncate font-semibold ${rating === 0 ? "text-dim" : ""}`}>
        {rating !== undefined && rating > 0 ? "" : title}
      </span>
      <span className="shrink-0 text-dim tabular-nums">
        {end - start} {items.slice(start, end).every((i) => i.kind === "image") ? "枚" : "件"}
      </span>
    </div>
  );
}

/** Similar view: names the group and offers to tidy it up. */
function GroupHeader({ items, section, keepPick }: { items: Item[]; section: Section; keepPick: Set<string> }) {
  const { start, end } = section;
  const group = items.slice(start, end);
  const keep = keeperOf(group, keepPick);
  const freed = group.filter((i) => i !== keep).reduce((n, i) => n + i.size, 0);
  return (
    <div
      className={`flex items-center gap-3 text-xs ${start > 0 ? "border-t border-line" : ""}`}
      style={{ height: HEADER - 8, marginLeft: PAD, marginRight: PAD, marginBottom: 8 }}
    >
      <span className="font-semibold">{section.title}</span>
      <span className="text-dim">
        {group.length} 枚 · 整理すると {formatBytes(freed)} 減ります
      </span>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => dismissDuplicates(group.map((i) => i.id))}
        title="このグループの画像は別物として扱い、今後は候補に出しません"
        className="ml-auto rounded-md border border-line px-2 py-0.5 hover:bg-white/5"
      >
        重複ではない
      </button>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => reviewDuplicates(keepPlan([group], keepPick))}
        title="残す1枚を確認してから、他をゴミ箱へ移動します"
        className="rounded-md border border-line px-2 py-0.5 hover:bg-white/5"
      >
        このグループを整理…
      </button>
    </div>
  );
}

function Empty({ kind, mode, filtering, analyzing }: { kind: string; mode: Mode; filtering: boolean; analyzing: boolean }) {
  const noun = kindLabel(mode);
  if (kind === "trash") return <p className="mt-24 text-center text-dim">ゴミ箱は空です</p>;
  if (kind === "similar")
    return (
      <p className="mt-24 text-center text-dim">
        {analyzing ? "画像を解析しています…" : "似ている画像は見つかりませんでした"}
      </p>
    );
  if (filtering)
    return (
      <div className="mt-24 flex flex-col items-center gap-3 text-dim">
        <p>条件に一致する{noun}はありません</p>
        <button
          onClick={() => useStore.getState().clearConditions()}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:brightness-110"
        >
          絞り込みを解除
        </button>
      </div>
    );
  if (kind === "unfiled" || kind === "untagged")
    return <p className="mt-24 text-center text-dim">該当する{noun}はありません</p>;
  if (kind === "favorites")
    return (
      <p className="mt-24 text-center text-dim">
        お気に入りはまだありません。{noun}を選んで F キー、またはサムネイルのハートで追加できます
      </p>
    );
  if (kind === "pinned")
    return (
      <p className="mt-24 text-center text-dim">
        ピン留めした{noun}はありません。{noun}を選んで P キーでピン留めすると、どの一覧でも先頭に表示されます
      </p>
    );
  if (kind === "tray")
    return (
      <div className="mt-24 flex flex-col items-center gap-2 text-dim">
        <Layers size={40} strokeWidth={1.25} />
        <p>作業台は空です</p>
        <p className="max-w-md text-center text-xs leading-relaxed">
          画像を選んで B キー、またはサイドバーの「作業台」へドラッグすると、ここに集まります。
          集めた画像は「まとめて出力」で1枚の画像や HTML にしたり、まとめて書き出したりできます
        </p>
      </div>
    );
  if (kind === "folder")
    return (
      <div className="mt-24 flex flex-col items-center gap-2 text-dim">
        <ImagePlus size={40} strokeWidth={1.25} />
        <p>このフォルダは空です</p>
        <p className="text-xs">{noun}をサイドバーのフォルダへドラッグするか、ここにファイルをドロップして追加</p>
      </div>
    );
  return (
    <div className="mt-24 flex flex-col items-center gap-3 text-dim">
      <ImagePlus size={40} strokeWidth={1.25} />
      <p>
        {mode === "font"
          ? "フォントファイルやフォルダをここにドラッグ&ドロップ"
          : mode === "file"
            ? "PDF・オフィス文書やフォルダをここにドラッグ&ドロップ"
            : "画像やフォルダをここにドラッグ&ドロップ、またはクリップボードから貼り付け"}
      </p>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={importFilesDialog}
        className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:brightness-110"
      >
        {noun}を選択して追加
      </button>
    </div>
  );
}
