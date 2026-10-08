// The filter bar (⌘⇧F): attribute conditions on top of search / tags / rating,
// and saving the whole set as a smart folder.
import { Check, ChevronDown, FolderSearch, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cancelSmartEdit, createSmartFolder, saveEditedSmartFolder } from "../lib/actions";
import { type Filter, type Shape } from "../lib/api";
import {
  DATE_PRESETS,
  describeDate,
  describeDims,
  describeSize,
  SHAPE_LABEL,
  SIZE_PRESETS,
  startOfToday,
} from "../lib/rule";
import { activeConditions, useStore } from "../store";
import { RangeCalendar } from "./RangeCalendar";


/** A chip that opens a small panel underneath it. */
function Popover({
  label,
  value,
  onClear,
  children,
}: {
  label: string;
  value: string;
  onClear: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const active = value !== "";
  return (
    <div ref={ref} className="relative">
      <div
        className={`flex h-7 items-center overflow-hidden rounded-md border text-xs ${
          active ? "border-accent/60 bg-accent/15" : "border-line"
        }`}
      >
        <button onClick={() => setOpen((o) => !o)} className="flex h-full items-center gap-1 px-2 hover:bg-white/5">
          <span className={active ? "text-dim" : ""}>{label}</span>
          {active && <span className="max-w-48 truncate text-fg">{value}</span>}
          <ChevronDown size={12} className="text-dim" />
        </button>
        {active && (
          <button onClick={onClear} title="解除" className="flex h-full items-center px-1.5 text-dim hover:bg-white/5 hover:text-fg">
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 min-w-52 animate-slide-down rounded-lg border border-line bg-raised p-2 text-xs shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Number input that commits on blur / Enter; empty = no limit. */
function NumField({
  value,
  onChange,
  placeholder,
  scale = 1,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  /** Displayed value = stored / scale (e.g. MB). */
  scale?: number;
}) {
  const shown = value == null ? "" : String(Math.round((value / scale) * 100) / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text);
    onChange(text.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * scale));
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      inputMode="decimal"
      placeholder={placeholder}
      className="h-7 w-20 rounded border border-line bg-bg px-1.5 tabular-nums outline-none focus:border-accent"
    />
  );
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/8 ${on ? "text-fg" : "text-dim"}`}
    >
      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${on ? "border-accent bg-accent text-white" : "border-line"}`}>
        {on && <Check size={10} strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}

const previousDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
};
const nextDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

export function FilterBar() {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const exts = useStore((s) => s.exts);
  const editing = useStore((s) => s.editingSmart);
  const active = useStore(activeConditions);
  const clearConditions = useStore((s) => s.clearConditions);

  const toggle = <K extends "exts" | "shapes">(key: K, v: Filter[K][number]) => {
    const cur = filter[key] as string[];
    setFilter({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<Filter>);
  };

  return (
    <div className="flex flex-col gap-2">
      {editing && (
        <div className="flex animate-slide-down items-center gap-2 rounded-md bg-accent/20 px-3 py-1.5 text-xs">
          <FolderSearch size={14} className="text-accent" />
          <span className="flex-1">
            スマートフォルダ「<b>{editing.name}</b>」の条件を編集中 — 条件を変えると一覧に反映されます
          </span>
          <button
            onClick={cancelSmartEdit}
            className="rounded px-2 py-0.5 text-dim hover:bg-white/10 hover:text-fg"
          >
            キャンセル
          </button>
          <button
            onClick={() => saveEditedSmartFolder()}
            className="rounded bg-accent px-2.5 py-0.5 font-medium text-white hover:brightness-110"
          >
            保存
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Popover label="形式" value={filter.exts.join(", ")} onClear={() => setFilter({ exts: [] })}>
          {() =>
            exts.length === 0 ? (
              <p className="px-2 py-1 text-dim">ファイルがありません</p>
            ) : (
              exts.map(([ext, n]) => (
                <Option key={ext} on={filter.exts.includes(ext)} onClick={() => toggle("exts", ext)}>
                  <span className="flex-1 uppercase">{ext}</span>
                  <span className="text-dim tabular-nums">{n}</span>
                </Option>
              ))
            )
          }
        </Popover>

        <div className="flex h-7 overflow-hidden rounded-md border border-line text-xs">
          {(Object.keys(SHAPE_LABEL) as Shape[]).map((sh, i) => (
            <button
              key={sh}
              onClick={() => toggle("shapes", sh)}
              className={`px-2 ${i > 0 ? "border-l border-line" : ""} ${
                filter.shapes.includes(sh) ? "bg-accent/25 text-fg" : "text-dim hover:bg-white/5"
              }`}
            >
              {SHAPE_LABEL[sh]}
            </button>
          ))}
        </div>

        <Popover
          label="画像サイズ"
          value={describeDims(filter)}
          onClear={() => setFilter({ minWidth: null, maxWidth: null, minHeight: null, maxHeight: null })}
        >
          {() => (
            <div className="grid grid-cols-[auto_auto_auto_auto] items-center gap-1.5 p-1">
              <span className="text-dim">幅</span>
              <NumField value={filter.minWidth} onChange={(v) => setFilter({ minWidth: v })} placeholder="最小" />
              <span className="text-dim">〜</span>
              <NumField value={filter.maxWidth} onChange={(v) => setFilter({ maxWidth: v })} placeholder="最大" />
              <span className="text-dim">高さ</span>
              <NumField value={filter.minHeight} onChange={(v) => setFilter({ minHeight: v })} placeholder="最小" />
              <span className="text-dim">〜</span>
              <NumField value={filter.maxHeight} onChange={(v) => setFilter({ maxHeight: v })} placeholder="最大" />
              <span className="col-span-4 pt-1 text-[11px] text-dim">px。空欄は制限なし</span>
            </div>
          )}
        </Popover>

        <Popover
          label="追加日"
          value={describeDate(filter)}
          onClear={() => setFilter({ importedAfter: null, importedBefore: null })}
        >
          {(close) => (
            <div className="flex flex-col gap-0.5">
              {DATE_PRESETS.map((p) => (
                <Option
                  key={p.label}
                  on={filter.importedBefore == null && filter.importedAfter === p.after()}
                  onClick={() => {
                    setFilter({ importedAfter: p.after(), importedBefore: null });
                    close();
                  }}
                >
                  {p.label}
                </Option>
              ))}
              <div className="mt-1 border-t border-line pt-2">
                <RangeCalendar
                  from={filter.importedAfter}
                  to={
                    filter.importedBefore != null
                      ? previousDay(filter.importedBefore)
                      : filter.importedAfter != null
                        ? startOfToday()
                        : null
                  }
                  onChange={(from, to) => setFilter({ importedAfter: from, importedBefore: nextDay(to) })}
                />
              </div>
            </div>
          )}
        </Popover>

        <Popover label="容量" value={describeSize(filter)} onClear={() => setFilter({ minSize: null, maxSize: null })}>
          {(close) => (
            <div className="flex flex-col gap-0.5">
              {SIZE_PRESETS.map((p) => (
                <Option
                  key={p.label}
                  on={filter.minSize === p.min && filter.maxSize === p.max}
                  onClick={() => {
                    setFilter({ minSize: p.min, maxSize: p.max });
                    close();
                  }}
                >
                  {p.label}
                </Option>
              ))}
              <div className="mt-1 flex items-center gap-1.5 border-t border-line px-1 pt-2">
                <NumField value={filter.minSize} onChange={(v) => setFilter({ minSize: v })} placeholder="最小" scale={1024 * 1024} />
                <span className="text-dim">〜</span>
                <NumField value={filter.maxSize} onChange={(v) => setFilter({ maxSize: v })} placeholder="最大" scale={1024 * 1024} />
                <span className="text-dim">MB</span>
              </div>
            </div>
          )}
        </Popover>

        <div className="flex-1" />
        {active > 0 && (
          <button onClick={clearConditions} className="h-7 rounded-md px-2 text-xs text-dim hover:bg-white/5 hover:text-fg">
            条件をすべて解除
          </button>
        )}
        {!editing && (
          <button
            disabled={active === 0}
            onClick={() => createSmartFolder()}
            title="今の検索・タグ・評価・絞り込みの条件を保存（⌘⇧⌥N）"
            className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs enabled:hover:bg-white/5 disabled:opacity-40"
          >
            <FolderSearch size={13} /> スマートフォルダとして保存
          </button>
        )}
      </div>
    </div>
  );
}
