import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";

const MIN = 0.05;
const MAX = 16;
const STEP = 1.25;

export function Viewer() {
  const index = useStore((s) => s.viewer);
  const items = useStore((s) => s.items);
  const openViewer = useStore((s) => s.openViewer);
  const item = index !== null ? items[index] : undefined;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // "fit" follows the window size; a number is a fixed zoom level.
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const suppressClick = useRef(false);

  const open = item !== undefined;
  useEffect(() => setZoom("fit"), [item?.id]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [open]);

  const pad = 32;
  const fitScale = item
    ? Math.min(1, (box.w - pad) / item.width, (box.h - pad) / item.height)
    : 1;
  const scale = zoom === "fit" ? fitScale : zoom;

  /** Zooms keeping the point under (cx, cy) — or the centre — in place. */
  const zoomTo = useCallback(
    (next: number, cx?: number, cy?: number) => {
      const el = boxRef.current;
      if (!el || !item) return;
      const target = Math.min(MAX, Math.max(MIN, next));
      const rect = el.getBoundingClientRect();
      const px = (cx ?? rect.left + rect.width / 2) - rect.left;
      const py = (cy ?? rect.top + rect.height / 2) - rect.top;
      // Content coordinates of the anchor before zooming (image is centred when smaller).
      const imgW = item.width * scale;
      const imgH = item.height * scale;
      const offX = Math.max(0, (el.clientWidth - imgW) / 2);
      const offY = Math.max(0, (el.clientHeight - imgH) / 2);
      const rx = (el.scrollLeft + px - offX) / imgW;
      const ry = (el.scrollTop + py - offY) / imgH;
      setZoom(target);
      requestAnimationFrame(() => {
        const nW = item.width * target;
        const nH = item.height * target;
        const nOffX = Math.max(0, (el.clientWidth - nW) / 2);
        const nOffY = Math.max(0, (el.clientHeight - nH) / 2);
        el.scrollLeft = rx * nW + nOffX - px;
        el.scrollTop = ry * nH + nOffY - py;
      });
    },
    [item, scale],
  );

  useEffect(() => {
    if (index === null) return;
    const go = (d: number) => {
      const next = Math.min(items.length - 1, Math.max(0, index + d));
      openViewer(next);
      useStore.getState().select(items[next].id, "only");
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "=" || e.key === "+" || e.key === ";")) {
        e.preventDefault();
        zoomTo(scale * STEP);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomTo(scale / STEP);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        zoomTo(1);
      } else if (mod && e.key === "9") {
        e.preventDefault();
        setZoom("fit");
      } else if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        openViewer(null);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || (!mod && e.code === "KeyA")) {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || (!mod && e.code === "KeyD")) {
        e.preventDefault();
        go(1);
      } else if (!mod && e.code === "KeyZ") {
        setZoom((z) => (z === "fit" ? 1 : "fit"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items, openViewer, scale, zoomTo]);

  // Option/Ctrl + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey && !e.ctrlKey) return;
      e.preventDefault();
      zoomTo(scale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, zoomTo]);

  // Drag to pan when the image is larger than the window.
  const onPointerDown = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el || e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const sl = el.scrollLeft;
    const st = el.scrollTop;
    suppressClick.current = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) suppressClick.current = true;
      el.scrollLeft = sl - (ev.clientX - sx);
      el.scrollTop = st - (ev.clientY - sy);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!item || index === null) return null;
  const nav =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/70 hover:text-white disabled:invisible";
  const tool = "rounded p-1 text-white/70 hover:bg-white/10 hover:text-white";
  const larger = item.width * scale > box.w || item.height * scale > box.h;

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in flex-col bg-black/95">
      <div className="flex items-center gap-3 px-4 py-2 text-sm text-white/80">
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <span className="text-xs text-white/40 tabular-nums">
          {item.width} × {item.height}
        </span>
        <div className="flex items-center gap-1">
          <button className={tool} title="縮小（⌘-）" onClick={() => zoomTo(scale / STEP)}>
            <Minus size={16} />
          </button>
          <button
            className="w-14 rounded px-1 text-center text-xs tabular-nums hover:bg-white/10"
            title="実寸（⌘0）"
            onClick={() => zoomTo(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button className={tool} title="拡大（⌘+）" onClick={() => zoomTo(scale * STEP)}>
            <Plus size={16} />
          </button>
          <button
            className={`${tool} ${zoom === "fit" ? "text-accent" : ""}`}
            title="全体を表示（⌘9）"
            onClick={() => setZoom("fit")}
          >
            <Maximize size={15} />
          </button>
        </div>
        <span className="tabular-nums text-white/50">
          {index + 1} / {items.length}
        </span>
        <button className="rounded p-1 hover:bg-white/10" onClick={() => openViewer(null)}>
          <X size={18} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={boxRef}
          className={`absolute inset-0 flex overflow-auto ${larger ? "cursor-grab active:cursor-grabbing" : ""}`}
          onPointerDown={larger ? onPointerDown : undefined}
          onClick={(e) => {
            // Clicking the empty backdrop closes, like before.
            if (e.target === e.currentTarget && !suppressClick.current) openViewer(null);
          }}
        >
          <img
            key={item.id}
            src={convertFileSrc(item.filePath)}
            alt={item.name}
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              if (suppressClick.current) return;
              // Click toggles fit ↔ 100% around the clicked point.
              if (zoom === "fit" && fitScale < 1) zoomTo(1, e.clientX, e.clientY);
              else setZoom("fit");
            }}
            style={{ width: item.width * scale, height: item.height * scale }}
            className={`m-auto max-w-none shrink-0 animate-zoom-in ${
              larger ? "" : zoom === "fit" && fitScale < 1 ? "cursor-zoom-in" : "cursor-zoom-out"
            }`}
          />
        </div>
        <button
          className={`${nav} left-4`}
          disabled={index === 0}
          onClick={() => openViewer(index - 1)}
        >
          <ChevronLeft size={24} />
        </button>
        <button
          className={`${nav} right-4`}
          disabled={index === items.length - 1}
          onClick={() => openViewer(index + 1)}
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
}
