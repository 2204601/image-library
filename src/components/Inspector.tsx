import { convertFileSrc } from "@tauri-apps/api/core";
import { Folder as FolderIcon, Plus, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  copySelection,
  deleteSelection,
  exportSelection,
  openSelection,
  setRating,
} from "../lib/actions";
import { api, formatBytes, type Folder, type SelectionInfo } from "../lib/api";
import { useStore } from "../store";

function folderPath(folders: Folder[], id: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  for (let f = byId.get(id); f; f = f.parentId ? byId.get(f.parentId) : undefined) {
    parts.unshift(f.name);
  }
  return parts.join(" / ");
}

function TagInput({ onAdd, exclude }: { onAdd: (names: string[]) => void; exclude: Set<number> }) {
  const tags = useStore((s) => s.tags);
  const [text, setText] = useState("");
  const [hi, setHi] = useState(0);
  const q = text.trim().toLowerCase();
  const suggestions = useMemo(
    () =>
      q
        ? tags.filter((t) => !exclude.has(t.id) && t.name.toLowerCase().includes(q)).slice(0, 8)
        : [],
    [q, tags, exclude],
  );

  const commit = (name: string) => {
    // Comma-separated input adds several tags at once.
    const names = name.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
    if (names.length) onAdd(names);
    setText("");
    setHi(0);
  };

  return (
    <div className="relative">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // IME conversion in progress
          if (e.key === "Enter") {
            e.preventDefault();
            commit(suggestions[hi] && !text.includes(",") ? suggestions[hi].name : text);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Escape") {
            setText("");
            e.currentTarget.blur();
          }
        }}
        placeholder="タグを追加（Enter）"
        className="h-8 w-full rounded-md border border-line bg-bg px-2 outline-none focus:border-accent"
      />
      {suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-line bg-raised py-1 shadow-xl">
          {suggestions.map((t, i) => (
            <button
              key={t.id}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(t.name);
              }}
              className={`flex w-full justify-between px-2 py-1 text-left ${i === hi ? "bg-accent text-white" : ""}`}
            >
              <span className="truncate">{t.name}</span>
              <span className="text-xs opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const btn = "h-8 rounded-md border border-line hover:bg-white/5";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-xs font-semibold text-dim">{label}</div>
      {children}
    </div>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="flex max-w-full items-center gap-1 rounded-full bg-raised py-0.5 pr-1 pl-2.5 text-xs">
      <span className="truncate">{children}</span>
      <button onClick={onRemove} className="rounded-full p-0.5 text-dim hover:bg-white/10 hover:text-fg">
        <X size={12} />
      </button>
    </span>
  );
}

/** Text field that saves on blur, and resets when the selected item changes. */
function SavedText({
  id,
  value,
  onSave,
  multiline,
  className,
  placeholder,
}: {
  id?: string;
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  const latest = useRef({ v, value, onSave });
  latest.current = { v, value, onSave };
  useEffect(() => setV(value), [value]);
  // Save pending edits if the component goes away (e.g. selection changed).
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.v !== l.value) l.onSave(l.v);
    },
    [],
  );
  const props = {
    id,
    value: v,
    placeholder,
    className,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => v !== value && onSave(v),
  };
  return multiline ? (
    <textarea {...props} rows={4} />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
      }}
    />
  );
}

/** Click a star to rate; clicking the current rating clears it. */
function RatingStars({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          title={`★${n}（キー ${n}）`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n === value ? 0 : n)}
          className="p-0.5 transition-transform hover:scale-125"
        >
          <Star
            size={16}
            strokeWidth={1.5}
            className={n <= shown ? "text-amber-400" : "text-dim/50"}
            fill={n <= shown ? "currentColor" : "none"}
          />
        </button>
      ))}
      {value === null && <span className="ml-1 text-[11px] text-dim">（混在）</span>}
    </div>
  );
}

export function Inspector() {
  const selected = useStore((s) => s.selected);
  const items = useStore((s) => s.items);
  const folders = useStore((s) => s.folders);
  const rev = useStore((s) => s.rev);
  const run = useStore((s) => s.run);
  const isTrash = useStore((s) => s.view.kind === "trash");
  const [info, setInfo] = useState<SelectionInfo>({ tags: [], folders: [] });
  const [adding, setAdding] = useState(false);

  const ids = useMemo(() => [...selected], [selected]);
  const single = ids.length === 1 ? items.find((i) => i.id === ids[0]) : undefined;
  const renameSeq = useStore((s) => s.renameItemSeq);
  // Common rating of the selection, or null when mixed.
  const rating = useMemo(() => {
    const rs = new Set(items.filter((i) => selected.has(i.id)).map((i) => i.rating));
    return rs.size === 1 ? [...rs][0] : null;
  }, [items, selected]);

  // F2 / ⌘R: focus the name field (after the panel has opened).
  useEffect(() => {
    if (!renameSeq) return;
    const t = setTimeout(() => {
      const el = document.getElementById("inspector-name") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 220);
    return () => clearTimeout(t);
  }, [renameSeq]);

  useEffect(() => {
    let live = true;
    setAdding(false);
    if (!ids.length) return setInfo({ tags: [], folders: [] });
    api.selectionInfo(ids).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [ids, rev]);

  const tagIds = useMemo(() => new Set(info.tags.map((t) => t.id)), [info.tags]);

  if (!ids.length) {
    return (
      <aside className="flex w-72 shrink-0 items-center justify-center border-l border-line bg-panel text-dim">
        画像を選択してください
      </aside>
    );
  }

  const n = ids.length;
  const countSuffix = (c: number) => (n > 1 && c < n ? ` (${c}/${n})` : "");
  const unusedFolders = folders.filter((f) => !info.folders.some((x) => x.id === f.id && x.count === n));

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel p-4">
      {single ? (
        <>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-raised">
            <img
              src={convertFileSrc(single.thumbPath)}
              className="max-h-full max-w-full object-contain"
              draggable={false}
              alt=""
              onDoubleClick={() =>
                useStore.getState().openViewer(items.findIndex((i) => i.id === single.id))
              }
            />
          </div>
          <SavedText
            key={single.id + ":name"}
            id="inspector-name"
            value={single.name}
            onSave={(v) => run(() => api.renameItem(single.id, v))}
            className="mt-3 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:border-line focus:border-accent"
          />
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-1 text-xs">
            <dt className="text-dim">サイズ</dt>
            <dd className="tabular-nums">
              {single.width} × {single.height}
            </dd>
            <dt className="text-dim">形式</dt>
            <dd>
              {single.ext.toUpperCase()} · {formatBytes(single.size)}
            </dd>
            <dt className="text-dim">追加日</dt>
            <dd>{new Date(single.importedAt).toLocaleString("ja-JP")}</dd>
          </dl>
        </>
      ) : (
        <div className="rounded-lg bg-raised p-4 text-center">
          <div className="text-2xl font-semibold tabular-nums">{n}</div>
          <div className="text-dim">件を選択中</div>
        </div>
      )}

      {!isTrash && (
        <Field label="評価">
          <RatingStars value={rating} onChange={(n) => setRating(ids, n)} />
        </Field>
      )}

      <Field label="タグ">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {info.tags.map((t) => (
            <Chip key={t.id} onRemove={() => run(() => api.removeTag(ids, t.id))}>
              {t.name}
              {countSuffix(t.count)}
            </Chip>
          ))}
        </div>
        <TagInput exclude={tagIds} onAdd={(names) => run(() => api.addTags(ids, names))} />
      </Field>

      <Field label="フォルダ">
        <div className="flex flex-col gap-1.5">
          {info.folders.map((f) => (
            <Chip key={f.id} onRemove={() => run(() => api.removeFromFolder(ids, f.id))}>
              <FolderIcon size={12} className="mr-1 inline text-dim" />
              {folderPath(folders, f.id)}
              {countSuffix(f.count)}
            </Chip>
          ))}
        </div>
        {adding ? (
          <select
            autoFocus
            defaultValue=""
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              setAdding(false);
              if (e.target.value) run(() => api.addToFolder(ids, e.target.value));
            }}
            className="mt-2 h-8 w-full rounded-md border border-line bg-bg px-2 outline-none"
          >
            <option value="">フォルダを選択…</option>
            {unusedFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(folders, f.id)}
              </option>
            ))}
          </select>
        ) : (
          folders.length > 0 && (
            <button
              onClick={() => setAdding(true)}
              className="mt-2 flex items-center gap-1 text-xs text-dim hover:text-fg"
            >
              <Plus size={13} /> フォルダに追加
            </button>
          )
        )}
      </Field>

      {single && (
        <Field label="メモ">
          <SavedText
            key={single.id + ":note"}
            multiline
            value={single.note}
            placeholder="メモを入力"
            onSave={(v) => run(() => api.setNote(single.id, v))}
            className="w-full resize-y rounded-md border border-line bg-bg p-2 outline-none focus:border-accent"
          />
        </Field>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-6">
        {!isTrash && (
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => openSelection(ids)} className={btn} title="既定のアプリで開く">
              開く
            </button>
            <button onClick={() => copySelection(ids)} className={btn} title="⌘C / Ctrl+C">
              コピー
            </button>
            <button onClick={() => exportSelection(ids)} className={btn} title="フォルダに書き出し">
              書き出し
            </button>
          </div>
        )}
        {single && (
          <button onClick={() => run(() => api.revealItem(single.id))} className={btn}>
            Finder / エクスプローラで表示
          </button>
        )}
        {isTrash && (
          <button
            onClick={() => run(() => api.restoreItems(ids))}
            className="h-8 rounded-md border border-line hover:bg-white/5"
          >
            復元
          </button>
        )}
        <button
          onClick={() => deleteSelection(ids)}
          className="h-8 rounded-md border border-danger/50 text-danger hover:bg-danger/10"
        >
          {isTrash ? "完全に削除" : "ゴミ箱へ移動"}
        </button>
      </div>
    </aside>
  );
}
