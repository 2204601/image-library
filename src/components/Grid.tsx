import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { deleteSelection, importFilesDialog } from "../lib/actions";
import { api, type Item } from "../lib/api";
import { useStore } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";

const PAD = 16;
const GAP = 12;
const LABEL = 34;

const Cell = memo(function Cell({
  item,
  index,
  selected,
  size,
}: {
  item: Item;
  index: number;
  selected: boolean;
  size: number;
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
      (x, y) => ({ kind: "items", ids: [...useStore.getState().selected], x, y }),
      // Plain click on an already-selected item narrows the selection to it.
      () => !e.shiftKey && !mod && useStore.getState().select(item.id, "only"),
    );
  };

  return (
    <div
      className="flex flex-col items-center"
      style={{ width: size }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().openViewer(index)}
      onContextMenu={(e) => {
        const s = useStore.getState();
        if (!s.selected.has(item.id)) s.select(item.id, "only");
        const ids = [...useStore.getState().selected];
        const trash = s.view.kind === "trash";
        useMenu.getState().show(e, [
          { label: "開く", onClick: () => s.openViewer(index) },
          { label: "Finder / エクスプローラで表示", onClick: () => s.run(() => api.revealItem(item.id)) },
          ...(trash
            ? [
                { label: "復元", onClick: () => s.run(() => api.restoreItems(ids)) },
                { label: "完全に削除", danger: true, onClick: () => deleteSelection(ids) },
              ]
            : [{ label: "ゴミ箱へ移動", danger: true, onClick: () => deleteSelection(ids) }]),
        ]);
      }}
    >
      <div
        className={`flex items-center justify-center overflow-hidden rounded-lg bg-raised ${
          selected ? "ring-3 ring-accent" : "hover:ring-1 hover:ring-line"
        }`}
        style={{ width: size, height: size }}
      >
        <img
          src={convertFileSrc(item.thumbPath)}
          loading="lazy"
          decoding="async"
          draggable={false}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="mt-1.5 w-full text-center">
        <div className={`truncate text-xs ${selected ? "text-white" : ""}`}>{item.name}</div>
        <div className="text-[11px] text-dim tabular-nums">
          {item.width} × {item.height}
        </div>
      </div>
    </div>
  );
});

export function Grid() {
  const items = useStore((s) => s.items);
  const selected = useStore((s) => s.selected);
  const thumbSize = useStore((s) => s.thumbSize);
  const isTrash = useStore((s) => s.view.kind === "trash");
  const filtering = useStore((s) => s.search !== "" || s.tagFilter.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

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

  // Keyboard: arrows move selection, Space/Enter opens, Delete trashes, Cmd/Ctrl+A selects all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      const s = useStore.getState();
      if (s.viewer !== null || s.drag) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.setSelection(s.items.map((i) => i.id));
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.getElementById("search")?.focus();
        return;
      }
      const cur = s.items.findIndex((i) => i.id === s.focus);
      const delta: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -cols,
        ArrowDown: cols,
      };
      if (e.key in delta) {
        e.preventDefault();
        if (!s.items.length) return;
        const next = cur < 0 ? 0 : Math.min(s.items.length - 1, Math.max(0, cur + delta[e.key]));
        const id = s.items[next].id;
        s.select(id, e.shiftKey ? "range" : "only");
        virt.scrollToIndex(Math.floor(next / cols));
      } else if ((e.key === " " || e.key === "Enter") && cur >= 0) {
        e.preventDefault();
        s.openViewer(cur);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection([...s.selected]);
      } else if (e.key === "Escape") {
        s.setSelection([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cols, virt]);

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-y-auto"
      onPointerDown={(e) => e.button === 0 && useStore.getState().setSelection([])}
    >
      {items.length === 0 ? (
        <Empty trash={isTrash} filtering={filtering} />
      ) : (
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
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
                  size={size}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ trash, filtering }: { trash: boolean; filtering: boolean }) {
  if (trash) return <p className="mt-24 text-center text-dim">ゴミ箱は空です</p>;
  if (filtering) return <p className="mt-24 text-center text-dim">条件に一致する画像はありません</p>;
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
