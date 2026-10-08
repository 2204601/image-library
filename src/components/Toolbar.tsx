import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  CopyCheck,
  Filter as FilterIcon,
  FolderInput,
  FolderSearch,
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
import { useEffect, useMemo, useState } from "react";
import {
  clearDismissedDuplicates,
  emptyTrash,
  importFilesDialog,
  importFolderDialog,
  keepPlan,
  reviewDuplicates,
  similarGroups,
} from "../lib/actions";
import { fontCategoryLabel, fontScriptLabel, kindLabel, type Folder, type SimilarLevel, type SmartFolder, type SortKey, type View } from "../lib/api";
import { colorHex } from "../lib/colors";
import { describeDate, describeDims, describeRule, describeSize, SHAPE_LABEL } from "../lib/rule";
import { activeConditions, useStore } from "../store";
import { FilterBar } from "./FilterBar";
import { DisplayMenu, GroupMenu, LayoutSwitch, SpecimenControls } from "./ViewMenu";

/** Thin line between groups of controls. */
const Divider = () => <div className="mx-0.5 h-5 w-px shrink-0 bg-line" />;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "importedAt", label: "追加日" },
  { key: "name", label: "名前" },
  { key: "size", label: "ファイルサイズ" },
  { key: "dimensions", label: "画像サイズ" },
  { key: "rating", label: "評価" },
  { key: "manual", label: "手動（ドラッグで並べ替え）" },
];

const SEARCH_HELP = [
  "名前・メモ・タグ・フォント名を検索",
  "  空白区切り … すべてを含む",
  "  -語 … 除外",
  "  A OR B / A || B … どちらか",
  "  ( ) … グループ化、\"語句\" … 完全一致",
].join("\n");

function viewTitle(view: View, folders: Folder[], smart: SmartFolder[]): string {
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
    case "favorites":
      return "お気に入り";
    case "pinned":
      return "ピン留め";
    case "folder":
      return folders.find((f) => f.id === view.id)?.name ?? "";
    case "smart":
      return smart.find((f) => f.id === view.id)?.name ?? "";
  }
}

export function Toolbar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const sort = useStore((s) => s.sort);
  const desc = useStore((s) => s.desc);
  const setSort = useStore((s) => s.setSort);
  const thumbSize = useStore((s) => s.thumbSize);
  const layout = useStore((s) => s.layout);
  const setThumbSize = useStore((s) => s.setThumbSize);
  const tags = useStore((s) => s.tags);
  const items = useStore((s) => s.items);
  // Number of images (with tag grouping an image can be listed more than once).
  const count = useStore((s) => s.rawItems.length);
  const selectedCount = useStore((s) => s.selected.size);
  const view = useStore((s) => s.view);
  const folders = useStore((s) => s.folders);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const showSubfolders = useStore((s) => s.showSubfolders);
  const setShowSubfolders = useStore((s) => s.setShowSubfolders);
  const minRating = useStore((s) => s.minRating);
  const setMinRating = useStore((s) => s.setMinRating);
  const smartFolders = useStore((s) => s.smartFolders);
  const filterOpen = useStore((s) => s.filterOpen);
  const toggleFilterOpen = useStore((s) => s.toggleFilterOpen);
  const editingSmart = useStore((s) => s.editingSmart);
  const startEditSmart = useStore((s) => s.startEditSmart);
  const conditions = useStore(activeConditions);
  const smart = view.kind === "smart" ? smartFolders.find((f) => f.id === view.id) : undefined;
  const isTrash = view.kind === "trash";
  const isFolder = view.kind === "folder";
  const isSimilar = view.kind === "similar";
  const manual = sort === "manual";
  const groups = useMemo(() => (isSimilar ? similarGroups(items) : []), [isSimilar, items]);
  const keepPick = useStore((s) => s.keepPick);
  const dismissedGroups = useStore((s) => s.dismissedGroups);
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
            {smart && <FolderSearch size={15} className="shrink-0 self-center text-accent" />}
            <span className="truncate">{viewTitle(view, folders, smartFolders)}</span>
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
          <button
            title="絞り込み（⌘⇧F）"
            onClick={toggleFilterOpen}
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border hover:bg-white/5 ${
              filterOpen || editingSmart ? "border-accent/60 text-accent" : "border-line"
            }`}
          >
            <FilterIcon size={15} />
            {conditions > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 animate-pop items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                {conditions}
              </span>
            )}
          </button>
          <Divider />
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
              title="残す1枚を確認してから、残りをゴミ箱へ移動"
              disabled={groups.length === 0}
              onClick={() => reviewDuplicates(keepPlan(groups, keepPick))}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 whitespace-nowrap enabled:hover:bg-white/5 disabled:opacity-40 @max-3xl:px-2"
            >
              <CopyCheck size={15} /> <span className="@max-3xl:hidden">まとめて整理…</span>
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
      {layout === "specimen" && <SpecimenControls />}
      <div className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {smart && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-dim">条件:</span>
            <span className="truncate">{describeRule(smart.rule, tags).join(" / ") || "なし（すべて）"}</span>
            <button
              onClick={() => startEditSmart(smart)}
              className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-accent/15"
            >
              条件を編集
            </button>
          </div>
        )}
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
        {isSimilar && <SimilarLevelControl />}
        {isSimilar && groups.length > 0 && (
          <span className="text-dim">
            {groups.length} グループ・重複 {count - groups.length} 枚。画像の「残す」で残す1枚を選べます（初期値は解像度が最も高い画像）
          </span>
        )}
        {isSimilar && dismissedGroups > 0 && (
          <>
            <span className="text-dim">無視した候補: {dismissedGroups} グループ</span>
            <button
              onClick={clearDismissedDuplicates}
              title="「重複ではない」にした候補をすべて元に戻します"
              className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-accent/15"
            >
              すべて解除
            </button>
          </>
        )}
        {manual && isFolder && !showSubfolders && (
          <span className="text-dim">画像をドラッグして並べ替えできます</span>
        )}
        {/* How the list looks, at the right end of the second row. */}
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {/* Native select for the menu, laid over a label sized to the current
              choice so long names aren't clipped and the arrow matches the UI. */}
          <label
            title="並び順"
            className="relative flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-bg pr-2 pl-2.5 whitespace-nowrap hover:bg-white/5 focus-within:border-accent"
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
            className="flex h-7 w-8 shrink-0 items-center justify-center rounded-md border border-line enabled:hover:bg-white/5 disabled:opacity-40"
          >
            {desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
          </button>
          <GroupMenu />
          <Divider />
          <LayoutSwitch />
          <DisplayMenu />
          <input
            type="range"
            min={80}
            max={360}
            step={10}
            value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            title="サムネイルサイズ（⌘+ / ⌘-）"
            className={`w-20 shrink-0 accent-accent @max-2xl:hidden ${layout === "specimen" || layout === "list" ? "hidden" : ""}`}
          />
        </div>
      </div>
      {(filterOpen || editingSmart) && <FilterBar />}
      {conditions > 0 && !editingSmart && <ActiveFilters count={count} />}
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

const LEVELS: { key: SimilarLevel; label: string; hint: string }[] = [
  { key: "strict", label: "ほぼ同じ", hint: "リサイズや再保存だけ違う、ほぼ同一の画像" },
  { key: "standard", label: "似ている", hint: "構図と色が同じ画像（標準）" },
  { key: "loose", label: "やや似ている", hint: "なんとなく似ている画像まで。無関係なものも混ざります" },
];

/** Similar view: how alike two images must be to be grouped. */
function SimilarLevelControl() {
  const level = useStore((s) => s.similarLevel);
  const setLevel = useStore((s) => s.setSimilarLevel);
  return (
    <div className="flex items-center gap-2">
      <span className="text-dim">似ている度合い</span>
      <div className="flex h-6 items-stretch overflow-hidden rounded-md border border-line">
        {LEVELS.map((l, i) => (
          <button
            key={l.key}
            title={l.hint}
            onClick={() => setLevel(l.key)}
            className={`px-2.5 whitespace-nowrap ${i > 0 ? "border-l border-line" : ""} ${
              level === l.key ? "bg-accent/20 font-medium text-accent" : "text-dim hover:bg-white/5 hover:text-fg"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Everything currently narrowing the list, each removable, plus one "clear all". */
function ActiveFilters({ count }: { count: number }) {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const tags = useStore((s) => s.tags);
  const tagFilter = useStore((s) => s.tagFilter);
  const tagMatchAll = useStore((s) => s.tagMatchAll);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const minRating = useStore((s) => s.minRating);
  const setMinRating = useStore((s) => s.setMinRating);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const clearConditions = useStore((s) => s.clearConditions);

  const chips: { key: string; label: string; color?: string; clear: () => void }[] = [];
  if (search.trim()) chips.push({ key: "search", label: `検索「${search.trim()}」`, clear: () => setSearch("") });
  tagFilter.forEach((id, i) => {
    const t = tags.find((x) => x.id === id);
    chips.push({
      key: `tag${id}`,
      label: `${i > 0 ? (tagMatchAll ? "かつ " : "または ") : "タグ: "}${t?.name ?? ""}`,
      color: colorHex(t?.color),
      clear: () => toggleTagFilter(id),
    });
  });
  if (minRating) chips.push({ key: "rating", label: `★${minRating} 以上`, clear: () => setMinRating(0) });
  if (filter.kinds.length)
    chips.push({
      key: "kinds",
      label: `種類: ${filter.kinds.map(kindLabel).join("・")}`,
      clear: () => setFilter({ kinds: [] }),
    });
  if (filter.fontScripts.length)
    chips.push({
      key: "fontScripts",
      label: `言語: ${filter.fontScripts.map(fontScriptLabel).join("・")}`,
      clear: () => setFilter({ fontScripts: [] }),
    });
  if (filter.fontCategories.length)
    chips.push({
      key: "fontCategories",
      label: `書体: ${filter.fontCategories.map(fontCategoryLabel).join("・")}`,
      clear: () => setFilter({ fontCategories: [] }),
    });
  if (filter.exts.length)
    chips.push({ key: "exts", label: `形式: ${filter.exts.join(", ")}`, clear: () => setFilter({ exts: [] }) });
  if (filter.shapes.length)
    chips.push({
      key: "shapes",
      label: filter.shapes.map((x) => SHAPE_LABEL[x]).join("・"),
      clear: () => setFilter({ shapes: [] }),
    });
  const dims = describeDims(filter);
  if (dims)
    chips.push({
      key: "dims",
      label: `サイズ: ${dims}`,
      clear: () => setFilter({ minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }),
    });
  const date = describeDate(filter);
  if (date)
    chips.push({
      key: "date",
      label: `追加日: ${date}`,
      clear: () => setFilter({ importedAfter: null, importedBefore: null }),
    });
  const size = describeSize(filter);
  if (filter.minSize != null || filter.maxSize != null)
    chips.push({ key: "size", label: `容量: ${size}`, clear: () => setFilter({ minSize: null, maxSize: null }) });

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs">
      <FilterIcon size={13} className="shrink-0 text-accent" />
      <span className="mr-1 font-medium text-accent">絞り込み中 · {count} 件</span>
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={c.clear}
          title="この条件を外す"
          className="flex items-center gap-1 rounded-full bg-bg/60 py-0.5 pr-1.5 pl-2 hover:bg-bg"
        >
          {c.color && <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
          {c.label}
          <X size={12} className="text-dim" />
        </button>
      ))}
      <button
        onClick={clearConditions}
        className="ml-auto flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 font-medium text-white hover:brightness-110"
      >
        <X size={12} /> すべて解除
      </button>
    </div>
  );
}
