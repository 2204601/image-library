import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  CopyCheck,
  FolderInput,
  ImagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  emptyTrash,
  importFilesDialog,
  importFolderDialog,
  resolveDuplicates,
  similarGroups,
} from "../lib/actions";
import type { Folder, SortKey, View } from "../lib/api";
import { useStore } from "../store";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "importedAt", label: "追加日" },
  { key: "name", label: "名前" },
  { key: "size", label: "ファイルサイズ" },
  { key: "dimensions", label: "画像サイズ" },
  { key: "rating", label: "評価" },
  { key: "manual", label: "手動（ドラッグで並べ替え）" },
];

const SEARCH_HELP = [
  "名前・メモ・タグを検索",
  "  空白区切り … すべてを含む",
  "  -語 … 除外",
  "  A OR B / A || B … どちらか",
  "  ( ) … グループ化、\"語句\" … 完全一致",
].join("\n");

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
    case "similar":
      return "重複の候補";
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
  const tagMatchAll = useStore((s) => s.tagMatchAll);
  const items = useStore((s) => s.items);
  const count = items.length;
  const selectedCount = useStore((s) => s.selected.size);
  const view = useStore((s) => s.view);
  const folders = useStore((s) => s.folders);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const showSubfolders = useStore((s) => s.showSubfolders);
  const setShowSubfolders = useStore((s) => s.setShowSubfolders);
  const minRating = useStore((s) => s.minRating);
  const setMinRating = useStore((s) => s.setMinRating);
  const isTrash = view.kind === "trash";
  const isFolder = view.kind === "folder";
  const isSimilar = view.kind === "similar";
  const manual = sort === "manual";
  const groups = useMemo(() => (isSimilar ? similarGroups(items) : []), [isSimilar, items]);
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? "";

  // Debounce typing so each keystroke doesn't hit the DB.
  const [text, setText] = useState(search);
  useEffect(() => setText(search), [search]);
  useEffect(() => {
    if (text === search) return;
    const t = setTimeout(() => setSearch(text), 200);
    return () => clearTimeout(t);
  }, [text, search, setSearch]);

  return (
    <header className="@container flex flex-col gap-2 border-b border-line bg-panel px-4 py-2">
      {/* Collapses progressively by toolbar width (container queries) so nothing
          overflows into the inspector: label → slider → two rows. */}
      <div className="flex items-center gap-x-3 gap-y-2 @max-xl:flex-col @max-xl:items-stretch">
        <div className="flex min-w-40 flex-1 items-center gap-2">
          <button
            title={`サイドバーを${sidebarOpen ? "隠す" : "表示"}（Tab / ⌘⌥1）`}
            onClick={toggleSidebar}
            className={`-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-white/5 ${
              sidebarOpen ? "text-dim" : "text-accent"
            }`}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <h1 className="flex min-w-0 flex-1 items-baseline gap-2 text-base font-semibold">
            <span className="truncate">{viewTitle(view, folders)}</span>
            <span className="shrink-0 text-xs font-normal text-dim tabular-nums">
              {selectedCount > 0 ? (
                <span className="text-fg">
                  {selectedCount} / {count} 件選択
                </span>
              ) : (
                `${count} 件`
              )}
            </span>
          </h1>
          <InspectorToggle className="hidden @max-xl:flex" />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label
            title={SEARCH_HELP}
            className="flex h-8 w-60 min-w-28 shrink items-center gap-2 rounded-md border border-line bg-bg px-2 focus-within:border-accent @max-xl:w-auto @max-xl:min-w-0 @max-xl:flex-1"
          >
            <Search size={14} className="shrink-0 text-dim" />
            <input
              id="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setText(""), e.currentTarget.blur())}
              placeholder="検索（-除外 / OR）"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
            />
            {text && (
              <button onClick={() => setText("")} className="text-dim hover:text-fg">
                <X size={14} />
              </button>
            )}
          </label>
          {/* Native select for the menu, laid over a label sized to the current
              choice so long names aren't clipped and the arrow matches the UI. */}
          <label
            title="並び順"
            className="relative flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-bg pr-2 pl-2.5 whitespace-nowrap hover:bg-white/5 focus-within:border-accent"
          >
            {manual ? "手動" : sortLabel}
            <ChevronDown size={14} className="text-dim" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey, desc)}
              className="absolute inset-0 cursor-default opacity-0"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key} disabled={s.key === "manual" && !isFolder}>
                  {s.key === "manual" && !isFolder ? "手動（フォルダ表示時のみ）" : s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            title={manual ? "手動の並びは昇順のみ" : desc ? "降順" : "昇順"}
            disabled={manual}
            onClick={() => setSort(sort, !desc)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line enabled:hover:bg-white/5 disabled:opacity-40"
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
            title="サムネイルサイズ（⌘+ / ⌘-）"
            className="w-20 shrink-0 accent-accent @max-2xl:hidden"
          />
          {isTrash ? (
            <button
              title="ゴミ箱を空にする"
              onClick={emptyTrash}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-danger/60 px-3 whitespace-nowrap text-danger hover:bg-danger/10 @max-3xl:px-2"
            >
              <Trash2 size={15} className="hidden @max-3xl:block" />
              <span className="@max-3xl:hidden">ゴミ箱を空にする</span>
            </button>
          ) : isSimilar ? (
            <button
              title="各グループで解像度が最も高い1枚を残し、残りをゴミ箱へ移動"
              disabled={groups.length === 0}
              onClick={() => resolveDuplicates(groups, true)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 whitespace-nowrap enabled:hover:bg-white/5 disabled:opacity-40 @max-3xl:px-2"
            >
              <CopyCheck size={15} /> <span className="@max-3xl:hidden">まとめて整理</span>
            </button>
          ) : (
            // One bordered group, like the other controls.
            <div className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-md border border-line">
              <button
                title="画像を追加"
                onClick={importFilesDialog}
                className="flex items-center gap-1.5 px-2.5 whitespace-nowrap hover:bg-white/5"
              >
                <ImagePlus size={15} /> <span className="@max-3xl:hidden">追加</span>
              </button>
              <button
                title="フォルダから追加"
                onClick={importFolderDialog}
                className="flex w-8 items-center justify-center border-l border-line hover:bg-white/5"
              >
                <FolderInput size={15} />
              </button>
            </div>
          )}
          <InspectorToggle className="flex @max-xl:hidden" />
        </div>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {isFolder && (
          <label className="flex items-center gap-1.5 text-dim hover:text-fg">
            <input
              type="checkbox"
              checked={showSubfolders}
              onChange={(e) => setShowSubfolders(e.target.checked)}
              className="accent-accent"
            />
            サブフォルダの内容も表示
          </label>
        )}
        <div className="flex items-center gap-1" title="評価で絞り込み（この評価以上）">
          <span className="mr-0.5 text-dim">評価</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setMinRating(minRating === n ? 0 : n)}
              className="p-0.5"
              title={`★${n} 以上`}
            >
              <Star
                size={13}
                strokeWidth={1.5}
                className={n <= minRating ? "text-amber-400" : "text-dim/60 hover:text-dim"}
                fill={n <= minRating ? "currentColor" : "none"}
              />
            </button>
          ))}
          {minRating > 0 && (
            <button onClick={() => setMinRating(0)} className="ml-0.5 text-dim hover:text-fg" title="解除">
              <X size={12} />
            </button>
          )}
        </div>
        {isSimilar && groups.length > 0 && (
          <span className="text-dim">
            {groups.length} グループ・重複 {count - groups.length} 件。各グループの先頭（解像度が最も高い画像）が残す候補です
          </span>
        )}
        {manual && isFolder && !showSubfolders && (
          <span className="text-dim">画像をドラッグして並べ替えできます</span>
        )}
        {tagFilter.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-dim">タグ:</span>
          {tagFilter.map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <span className="text-[11px] text-dim">{tagMatchAll ? "かつ" : "または"}</span>}
              <button
                onClick={() => toggleTagFilter(id)}
                className="flex items-center gap-1 rounded-full bg-accent/25 px-2 py-0.5 text-xs hover:bg-accent/40"
              >
                {tags.find((t) => t.id === id)?.name}
                <X size={12} />
              </button>
            </Fragment>
          ))}
        </div>
        )}
      </div>
    </header>
  );
}

/** Rendered twice (end of the row, or top-right when the toolbar is stacked). */
function InspectorToggle({ className }: { className: string }) {
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const toggleInspector = useStore((s) => s.toggleInspector);
  return (
    <button
      title={`詳細パネルを${inspectorOpen ? "閉じる" : "開く"}（⌘/Ctrl+I）`}
      onClick={toggleInspector}
      className={`h-8 w-8 shrink-0 items-center justify-center rounded-md border hover:bg-white/5 ${className} ${
        inspectorOpen ? "border-line" : "border-accent/60 text-accent"
      }`}
    >
      {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
    </button>
  );
}
