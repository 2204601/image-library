import { ArrowDownWideNarrow, ArrowUpNarrowWide, FolderInput, ImagePlus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { emptyTrash, importFilesDialog, importFolderDialog } from "../lib/actions";
import type { Folder, SortKey, View } from "../lib/api";
import { useStore } from "../store";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "importedAt", label: "追加日" },
  { key: "name", label: "名前" },
  { key: "size", label: "ファイルサイズ" },
];

function viewTitle(view: View, folders: Folder[]): string {
  switch (view.kind) {
    case "all":
      return "すべて";
    case "unfiled":
      return "未分類";
    case "untagged":
      return "タグなし";
    case "trash":
      return "ゴミ箱";
    case "folder":
      return folders.find((f) => f.id === view.id)?.name ?? "";
  }
}

export function Toolbar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const sort = useStore((s) => s.sort);
  const desc = useStore((s) => s.desc);
  const setSort = useStore((s) => s.setSort);
  const thumbSize = useStore((s) => s.thumbSize);
  const setThumbSize = useStore((s) => s.setThumbSize);
  const tags = useStore((s) => s.tags);
  const tagFilter = useStore((s) => s.tagFilter);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const count = useStore((s) => s.items.length);
  const view = useStore((s) => s.view);
  const folders = useStore((s) => s.folders);
  const isTrash = view.kind === "trash";

  // Debounce typing so each keystroke doesn't hit the DB.
  const [text, setText] = useState(search);
  useEffect(() => setText(search), [search]);
  useEffect(() => {
    if (text === search) return;
    const t = setTimeout(() => setSearch(text), 200);
    return () => clearTimeout(t);
  }, [text, search, setSearch]);

  return (
    <header className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-2">
      <div className="flex items-center gap-3">
        <h1 className="flex min-w-28 flex-1 items-baseline gap-2 text-base font-semibold">
          <span className="truncate">{viewTitle(view, folders)}</span>
          <span className="shrink-0 text-xs font-normal text-dim">{count} 件</span>
        </h1>
        <label className="flex h-8 w-60 min-w-28 shrink items-center gap-2 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
          <Search size={14} className="text-dim" />
          <input
            id="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setText(""), e.currentTarget.blur())}
            placeholder="名前・メモ・タグで検索"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
          />
          {text && (
            <button onClick={() => setText("")} className="text-dim hover:text-fg">
              <X size={14} />
            </button>
          )}
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey, desc)}
          className="h-8 shrink-0 rounded-md border border-line bg-bg px-2 outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          title={desc ? "降順" : "昇順"}
          onClick={() => setSort(sort, !desc)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line hover:bg-white/5"
        >
          {desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
        </button>
        <input
          type="range"
          min={80}
          max={360}
          step={10}
          value={thumbSize}
          onChange={(e) => setThumbSize(Number(e.target.value))}
          title="サムネイルサイズ"
          className="w-24 shrink-0 accent-accent"
        />
        {isTrash ? (
          <button
            onClick={emptyTrash}
            className="h-8 shrink-0 rounded-md border border-danger/60 px-3 whitespace-nowrap text-danger hover:bg-danger/10"
          >
            ゴミ箱を空にする
          </button>
        ) : (
          <>
            <button
              title="フォルダから追加"
              onClick={importFolderDialog}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line hover:bg-white/5"
            >
              <FolderInput size={15} />
            </button>
            <button
              onClick={importFilesDialog}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 whitespace-nowrap font-medium text-white hover:brightness-110"
            >
              <ImagePlus size={15} /> 追加
            </button>
          </>
        )}
      </div>
      {tagFilter.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-dim">タグで絞り込み:</span>
          {tagFilter.map((id) => (
            <button
              key={id}
              onClick={() => toggleTagFilter(id)}
              className="flex items-center gap-1 rounded-full bg-accent/25 px-2 py-0.5 text-xs hover:bg-accent/40"
            >
              {tags.find((t) => t.id === id)?.name}
              <X size={12} />
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
