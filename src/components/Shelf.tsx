// The shelf: a tray under the list where things are gathered for a while
// (the `tray` table), one per mode. Fonts are put there to be compared, at
// most FONT_SHELF_MAX; images and files to be exported or put on one sheet.
// Folded, it is one line; it opens and closes only when the user says so
// (docs/FONT_UI.md, docs/UI.md).
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowRight, ChevronDown, Layers, X } from "lucide-react";
import {
  clearTray,
  exportTray,
  removeFromShelf,
  sheetFromTray,
  transferList,
} from "../lib/actions";
import type { Item } from "../lib/api";
import { FontShelfLabel } from "../features/fonts/ShelfChip";
import { FONT_SHELF_MAX, useStore } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";

const button =
  "flex h-6 shrink-0 items-center gap-1 rounded-md border border-line px-2 whitespace-nowrap enabled:hover:bg-white/5 disabled:opacity-40";

export function Shelf() {
  const shelf = useStore((s) => s.shelf);
  const open = useStore((s) => s.shelfOpen);
  const toggle = useStore((s) => s.toggleShelf);
  const fonts = useStore((s) => s.mode === "font");
  const comparing = useStore((s) => s.comparing);
  const setComparing = useStore((s) => s.setComparing);
  const over = useStore((s) => s.drag?.kind === "items" && s.drag.from !== "shelf" && s.dropTarget === "tray");
  const flash = useStore((s) => (s.flash?.target === "tray" ? s.flash.n : null));
  const empty = shelf.length === 0;

  const menu = (e: React.MouseEvent) =>
    useMenu.getState().show(e, [
      ...(fonts
        ? [{ label: "比較する", disabled: empty || comparing, onClick: () => setComparing(true) }]
        : [
            { label: "書き出し…", disabled: empty, onClick: exportTray },
            { label: "まとめて出力…", disabled: empty, onClick: sheetFromTray },
          ]),
      { label: "別のライブラリへ…", disabled: empty, onClick: () => transferList({ kind: "tray" }) },
      { separator: true },
      { label: "シェルフを空にする", disabled: empty, onClick: clearTray },
    ]);

  return (
    <section
      data-drop="tray"
      aria-label="シェルフ"
      className={`relative shrink-0 border-t bg-panel text-xs transition-colors ${
        over ? "border-accent bg-accent/10" : "border-line"
      }`}
    >
      {flash !== null && (
        <span key={flash} className="pointer-events-none absolute inset-0 animate-drop-pulse bg-accent/20" />
      )}
      <div className="flex h-9 items-center gap-2 px-3" onContextMenu={menu}>
        <button
          onClick={toggle}
          aria-expanded={open}
          title={open ? "シェルフを畳む" : "シェルフを開く"}
          className="-ml-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1 font-medium hover:bg-white/5"
        >
          <ChevronDown size={14} className={`text-dim transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
          <Layers size={14} className="text-emerald-400" />
          シェルフ
        </button>
        <span className="shrink-0 text-dim tabular-nums">
          {fonts ? `${shelf.length} / ${FONT_SHELF_MAX}` : `${shelf.length} 件`}
        </span>
        <span className="min-w-0 flex-1 truncate text-dim/80 @container">
          {fonts
            ? `B キー・ドラッグで追加。比べたいフォントを最大 ${FONT_SHELF_MAX} 件まで置いておけます`
            : "B キー・ドラッグで追加。書き出しやまとめて出力の前に集めておけます"}
        </span>
        <button disabled={empty} onClick={clearTray} title="シェルフから外す（中身はそのまま残ります）" className={button}>
          空にする
        </button>
        {fonts ? (
          <button
            disabled={empty || comparing}
            onClick={() => setComparing(true)}
            title={comparing ? "比較中" : "シェルフのフォントを並べて比べる"}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 font-medium whitespace-nowrap text-white enabled:hover:brightness-110 disabled:opacity-40"
          >
            比較する <ArrowRight size={13} />
          </button>
        ) : (
          <>
            <button disabled={empty} onClick={exportTray} title="元のファイルのままフォルダへ書き出す" className={button}>
              書き出し…
            </button>
            <button disabled={empty} onClick={sheetFromTray} title="1 枚の画像・HTML にまとめる" className={button}>
              まとめて出力…
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="flex h-12 items-center gap-1.5 overflow-x-auto px-3 pb-2">
          {shelf.map((item) => (
            <Chip key={item.id} item={item} />
          ))}
          {fonts &&
            Array.from({ length: Math.max(0, FONT_SHELF_MAX - shelf.length) }, (_, i) => (
              <span
                key={`free${i}`}
                className="flex h-9 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-line text-dim/60"
              >
                空き
              </span>
            ))}
          {!fonts && empty && (
            <span className="text-dim/70">空です。一覧で選んで B キー、またはここへドラッグしてください</span>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One thing on the shelf. Dragged beside another it reorders, onto a folder it
 * moves; a click selects it in the list (when it is there).
 */
function Chip({ item }: { item: Item }) {
  const insert = useStore((s) =>
    s.drag?.kind === "items" && s.dropTarget?.startsWith(`shelf:${item.id}:`) ? s.dropTarget.split(":")[2] : null,
  );
  const dragged = useStore((s) => s.drag?.kind === "items" && s.drag.from === "shelf" && s.drag.ids.includes(item.id));
  const select = () => {
    const s = useStore.getState();
    const at = s.items.findIndex((i) => i.id === item.id || i.familyIds?.includes(item.id));
    if (at >= 0) s.select(s.items[at].id, "only", at);
  };
  return (
    <div
      data-drop={`shelf:${item.id}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        startPointerDrag(e, () => ({ kind: "items", ids: [item.id], from: "shelf" }), select);
      }}
      onContextMenu={(e) =>
        useMenu.getState().show(e, [
          { label: "一覧で選択", onClick: select },
          { label: "シェルフから外す", onClick: () => removeFromShelf([item.id]) },
        ])
      }
      className={`group relative flex h-9 max-w-52 shrink-0 cursor-default items-center gap-1.5 rounded-md border border-line bg-raised pr-1 pl-1.5 transition-opacity hover:border-white/20 ${
        dragged ? "opacity-40" : ""
      }`}
    >
      {item.kind === "font" ? (
        <FontShelfLabel item={item} />
      ) : (
        <>
          <img
            src={convertFileSrc(item.thumbPath)}
            alt=""
            draggable={false}
            className="h-7 w-7 shrink-0 rounded bg-bg object-cover"
          />
          <span className="min-w-0 truncate" title={item.name}>
            {item.name}
          </span>
        </>
      )}
      <button
        title="シェルフから外す"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => removeFromShelf([item.id])}
        className="shrink-0 rounded p-0.5 text-dim hover:bg-white/10 hover:text-fg"
      >
        <X size={12} />
      </button>
      {insert && (
        <span
          className={`pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-accent shadow-[0_0_6px] shadow-accent ${
            insert === "before" ? "-left-1" : "-right-1"
          }`}
        />
      )}
    </div>
  );
}
