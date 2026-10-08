import { create } from "zustand";
import {
  api,
  EMPTY_FILTER,
  type Counts,
  type DuplicateEffect,
  type Filter,
  type Folder,
  type Rule,
  type SmartFolder,
  type ImportSummary,
  type Item,
  type LibraryInfo,
  type SimilarLevel,
  type SortKey,
  type Tag,
  type View,
} from "./lib/api";
import { GROUP_BYS, groupItems, similarSections, type GroupBy, type Section } from "./lib/grouping";

/** x/y = current pointer, sx/sy = where the drag started (for snap-back). */
type DragPos = { x: number; y: number; sx: number; sy: number };
export type Drag =
  | ({ kind: "items"; ids: string[] } & DragPos)
  | ({ kind: "folder"; id: string } & DragPos);

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** A duplicate tidy-up awaiting confirmation; `effects` fills in once previewed. */
export interface DuplicateReview {
  groups: { keep: Item; remove: Item[] }[];
  effects: DuplicateEffect[] | null;
}

export type Layout = "justified" | "grid" | "waterfall" | "list";

/** What the grid shows under each thumbnail. */
export interface ShowInfo {
  name: boolean;
  dims: boolean;
  rating: boolean;
  /** File type and size. */
  meta: boolean;
}

interface Toast {
  id: number;
  message: string;
  error?: boolean;
  action?: ToastAction;
  leaving?: boolean;
}

interface State {
  library: LibraryInfo | null;

  view: View;
  search: string;
  tagFilter: number[];
  /** Sidebar tag filter requires all selected tags (AND) instead of any (OR). */
  tagMatchAll: boolean;
  sort: SortKey;
  desc: boolean;
  thumbSize: number;
  inspectorOpen: boolean;
  sidebarOpen: boolean;
  /** Folder views include items from subfolders. */
  showSubfolders: boolean;
  minRating: number;
  /** Attribute filters from the filter bar. */
  filter: Filter;
  filterOpen: boolean;
  /** Smart folder whose rule is loaded into the filters for editing. */
  editingSmart: { id: string; name: string } | null;
  layout: Layout;
  showInfo: ShowInfo;
  /** How the list is split into sections (ignored in the similar view). */
  groupBy: GroupBy;
  /** Viewer: details panel and the strip of thumbnails. */
  viewerInfo: boolean;
  viewerStrip: boolean;
  /** Tag names copied with ⌘⇧C. */
  tagClipboard: string[];
  /** Most recently used target folders (for Shift+D and the picker). */
  recentFolders: string[];
  /** Most recently assigned tags, newest first (suggested in the tag input). */
  recentTags: number[];
  /** Folder whose name is being edited inline in the sidebar. */
  renamingFolder: string | null;
  /** Bumped to ask the inspector to focus the item name field. */
  renameItemSeq: number;
  picker: "move" | "goto" | null;
  /** The "ブラウザ拡張と連携" dialog is open. */
  webImportOpen: boolean;
  /** A browser extension asks to connect; `code` is also shown in the extension. */
  pairRequest: { id: string; code: string } | null;
  /** Similar view: how alike images must be. */
  similarLevel: SimilarLevel;
  /** Similar view: copies the user chose to keep (at most one per group). */
  keepPick: Set<string>;
  /** Similar view: how many groups the user dismissed as "not duplicates" (not persisted). */
  dismissedGroups: number;
  /** Duplicate tidy-up waiting for confirmation. */
  review: DuplicateReview | null;

  /** What the grid shows: the query result, regrouped by `groupBy`. */
  items: Item[];
  /** The query result as returned (one entry per image). */
  rawItems: Item[];
  /** Bands of `items`: similar-view groups, or the `groupBy` sections. */
  sections: Section[];
  folders: Folder[];
  smartFolders: SmartFolder[];
  /** File types in the library with counts (filter bar options). */
  exts: [string, number][];
  tags: Tag[];
  counts: Counts;
  /** Bumped after every refresh so dependents (inspector) can re-fetch. */
  rev: number;

  selected: Set<string>;
  /** Start of a shift-range. */
  anchor: string | null;
  /** Last item clicked / moved to with the keyboard. */
  focus: string | null;
  viewer: number | null;

  drag: Drag | null;
  /** Files from Finder / Explorer are being dragged over the window. */
  fileDrag: boolean;
  dropTarget: string | null; // "folder:<id>" or "root"
  /** Sidebar row that just received a drop; `n` restarts the animation. */
  flash: { target: string; n: number } | null;
  importing: { done: number; total: number } | null;
  /** Update download in progress (bytes; total is null when the server did not say). */
  updating: { done: number; total: number | null } | null;
  /** Hashing older images before the similar view can be shown. */
  analyzing: boolean;
  toasts: Toast[];

  setLibrary: (lib: LibraryInfo | null) => void;
  setView: (view: View) => void;
  setSearch: (s: string) => void;
  toggleTagFilter: (id: number) => void;
  clearTagFilter: () => void;
  setTagMatchAll: (on: boolean) => void;
  setSort: (sort: SortKey, desc: boolean) => void;
  setThumbSize: (n: number) => void;
  toggleInspector: () => void;
  toggleSidebar: () => void;
  setShowSubfolders: (on: boolean) => void;
  setMinRating: (n: number) => void;
  setFilter: (patch: Partial<Filter>) => void;
  /** Resets search, tag, rating and attribute filters. */
  clearConditions: () => void;
  toggleFilterOpen: () => void;
  /** The ad-hoc conditions as a smart folder rule. */
  currentRule: () => Rule;
  /** Loads a smart folder's rule into the filters so it can be edited. */
  startEditSmart: (sf: SmartFolder) => void;
  stopEditSmart: () => void;
  setLayout: (l: Layout) => void;
  setShowInfo: (patch: Partial<ShowInfo>) => void;
  setGroupBy: (g: GroupBy) => void;
  toggleViewerInfo: () => void;
  toggleViewerStrip: () => void;
  setTagClipboard: (names: string[]) => void;
  rememberFolders: (ids: string[]) => void;
  rememberTags: (names: string[]) => void;
  setRenamingFolder: (id: string | null) => void;
  requestItemRename: () => void;
  setPicker: (p: State["picker"]) => void;
  setWebImportOpen: (open: boolean) => void;
  setPairRequest: (r: State["pairRequest"]) => void;
  setSimilarLevel: (l: SimilarLevel) => void;
  /** Marks `id` as the copy to keep in its group. */
  pickKeeper: (id: string) => void;
  setReview: (r: DuplicateReview | null) => void;
  refresh: () => Promise<void>;

  select: (id: string, mode: "only" | "toggle" | "range") => void;
  setSelection: (ids: string[]) => void;
  openViewer: (index: number | null) => void;

  setDrag: (d: Drag | null) => void;
  setDropTarget: (t: string | null) => void;
  setFileDrag: (on: boolean) => void;
  flashTarget: (target: string) => void;
  setImporting: (p: State["importing"]) => void;
  setUpdating: (p: State["updating"]) => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  /** Runs a mutation, reports errors, then refreshes. */
  run: (fn: () => Promise<unknown>) => Promise<void>;
  importDone: (s: ImportSummary) => void;
}

// localStorage can throw (private mode etc.); treat it as best-effort.
const load = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const persist = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};
const loadNumber = (key: string, fallback: number) => {
  const v = Number(load(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const loadJson = (key: string): object => {
  try {
    const v = JSON.parse(load(key) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

/** Number of active ad-hoc conditions (for badges / "clear" buttons). */
export function activeConditions(s: {
  search: string;
  tagFilter: number[];
  minRating: number;
  filter: Filter;
}): number {
  const f = s.filter;
  return (
    (s.search.trim() ? 1 : 0) +
    (s.tagFilter.length ? 1 : 0) +
    (s.minRating ? 1 : 0) +
    (f.kinds.length ? 1 : 0) +
    (f.exts.length ? 1 : 0) +
    (f.shapes.length ? 1 : 0) +
    (f.minWidth != null || f.maxWidth != null || f.minHeight != null || f.maxHeight != null ? 1 : 0) +
    (f.importedAfter != null || f.importedBefore != null ? 1 : 0) +
    (f.minSize != null || f.maxSize != null ? 1 : 0)
  );
}

const recentTagsKey = (root: string) => `recentTags:${root}`;
const loadRecentTags = (root: string): number[] => {
  try {
    const v = JSON.parse(load(recentTagsKey(root)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
};
let pendingRecentTags: string[] = [];

let refreshSeq = 0;
let toastSeq = 0;
let flashSeq = 0;

/** The display list and its sections for the current view / grouping. */
function arrange(s: {
  view: View;
  groupBy: GroupBy;
  rawItems: Item[];
  tags: Tag[];
  folders: Folder[];
}): { items: Item[]; sections: Section[] } {
  if (s.view.kind === "similar") return { items: s.rawItems, sections: similarSections(s.rawItems) };
  return groupItems(s.rawItems, s.groupBy, s.tags, s.folders);
}

export const useStore = create<State>((set, get) => ({
  library: null,

  view: { kind: "all" },
  search: "",
  tagFilter: [],
  tagMatchAll: load("tagMatchAll") === "true",
  sort: "importedAt",
  desc: true,
  thumbSize: loadNumber("thumbSize", 180),
  inspectorOpen: load("inspectorOpen") !== "false",
  sidebarOpen: load("sidebarOpen") !== "false",
  showSubfolders: load("showSubfolders") === "true",
  minRating: 0,
  filter: EMPTY_FILTER,
  filterOpen: load("filterOpen") === "true",
  editingSmart: null,
  layout: (["justified", "grid", "waterfall", "list"] as const).find((l) => l === load("layout")) ?? "justified",
  showInfo: { name: true, dims: true, rating: true, meta: false, ...loadJson("showInfo") },
  groupBy: GROUP_BYS.find((g) => g === load("groupBy")) ?? "none",
  viewerInfo: load("viewerInfo") === "true",
  viewerStrip: load("viewerStrip") !== "false",
  tagClipboard: [],
  recentFolders: [],
  recentTags: [],
  renamingFolder: null,
  renameItemSeq: 0,
  picker: null,
  webImportOpen: false,
  pairRequest: null,
  similarLevel: (["strict", "standard", "loose"] as const).find((l) => l === load("similarLevel")) ?? "standard",
  keepPick: new Set(),
  dismissedGroups: 0,
  review: null,

  items: [],
  rawItems: [],
  sections: [],
  folders: [],
  smartFolders: [],
  exts: [],
  tags: [],
  counts: { all: 0, unfiled: 0, untagged: 0, trash: 0, favorites: 0, pinned: 0, kinds: {} },
  rev: 0,

  selected: new Set(),
  anchor: null,
  focus: null,
  viewer: null,

  drag: null,
  fileDrag: false,
  dropTarget: null,
  flash: null,
  importing: null,
  updating: null,
  analyzing: false,
  toasts: [],

  setLibrary: (library) => {
    set({
      library,
      view: { kind: "all" },
      search: "",
      tagFilter: [],
      minRating: 0,
      filter: EMPTY_FILTER,
      editingSmart: null,
      recentTags: library ? loadRecentTags(library.root) : [],
      selected: new Set(),
      anchor: null,
      focus: null,
      viewer: null,
    });
    if (library) {
      get().refresh();
      // Fonts imported by older versions have no family yet (grouping, search).
      api
        .indexFonts()
        .then((n) => {
          if (n > 0) get().refresh();
        })
        .catch(() => {});
    }
  },
  setView: (view) => {
    // The similar view may take a moment to prepare; don't leave the old list up.
    const clear =
      view.kind === "similar" && get().view.kind !== "similar" ? { items: [], rawItems: [], sections: [] } : {};
    // Conditions belong to the view they were set in: moving to another one
    // starts clean (re-selecting the open view keeps them).
    const moved = JSON.stringify(view) !== JSON.stringify(get().view);
    const reset = moved
      ? { search: "", tagFilter: [], minRating: 0, filter: EMPTY_FILTER, editingSmart: null }
      : {};
    set({ view, selected: new Set(), anchor: null, focus: null, ...clear, ...reset });
    get().refresh();
  },
  setSearch: (search) => {
    set({ search });
    get().refresh();
  },
  toggleTagFilter: (id) => {
    const cur = get().tagFilter;
    set({ tagFilter: cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id] });
    get().refresh();
  },
  clearTagFilter: () => {
    set({ tagFilter: [] });
    get().refresh();
  },
  setTagMatchAll: (tagMatchAll) => {
    set({ tagMatchAll });
    persist("tagMatchAll", String(tagMatchAll));
    if (get().tagFilter.length > 1) get().refresh();
  },
  setSort: (sort, desc) => {
    set({ sort, desc });
    get().refresh();
  },
  setThumbSize: (thumbSize) => {
    set({ thumbSize });
    persist("thumbSize", String(thumbSize));
  },
  toggleInspector: () => {
    const inspectorOpen = !get().inspectorOpen;
    set({ inspectorOpen });
    persist("inspectorOpen", String(inspectorOpen));
  },
  toggleSidebar: () => {
    const sidebarOpen = !get().sidebarOpen;
    set({ sidebarOpen });
    persist("sidebarOpen", String(sidebarOpen));
  },
  setShowSubfolders: (showSubfolders) => {
    set({ showSubfolders });
    persist("showSubfolders", String(showSubfolders));
    get().refresh();
  },
  setMinRating: (minRating) => {
    set({ minRating });
    get().refresh();
  },
  setFilter: (patch) => {
    set({ filter: { ...get().filter, ...patch } });
    get().refresh();
  },
  clearConditions: () => {
    set({ search: "", tagFilter: [], minRating: 0, filter: EMPTY_FILTER });
    get().refresh();
  },
  toggleFilterOpen: () => {
    const filterOpen = !get().filterOpen;
    set({ filterOpen });
    persist("filterOpen", String(filterOpen));
  },
  currentRule: () => {
    const { search, tagFilter, tagMatchAll, minRating, filter } = get();
    return { search, tagIds: tagFilter, tagMatchAll, minRating, filter };
  },
  startEditSmart: (sf) => {
    // Edit in the "all" view so the user sees exactly what the rule matches.
    set({
      editingSmart: { id: sf.id, name: sf.name },
      view: { kind: "all" },
      search: sf.rule.search,
      tagFilter: sf.rule.tagIds,
      tagMatchAll: sf.rule.tagMatchAll,
      minRating: sf.rule.minRating,
      filter: { ...EMPTY_FILTER, ...sf.rule.filter },
      filterOpen: true,
      selected: new Set(),
    });
    get().refresh();
  },
  stopEditSmart: () => set({ editingSmart: null }),
  setLayout: (layout) => {
    set({ layout });
    persist("layout", layout);
  },
  setShowInfo: (patch) => {
    const showInfo = { ...get().showInfo, ...patch };
    set({ showInfo });
    persist("showInfo", JSON.stringify(showInfo));
  },
  setGroupBy: (groupBy) => {
    persist("groupBy", groupBy);
    const s = get();
    const { items, sections } = arrange({ ...s, groupBy });
    // The viewer follows the image it was showing to its new place.
    const shown = s.viewer !== null ? s.items[s.viewer]?.id : undefined;
    const viewer = shown ? Math.max(0, items.findIndex((i) => i.id === shown)) : s.viewer;
    set({ groupBy, items, sections, viewer });
  },
  toggleViewerInfo: () => {
    const viewerInfo = !get().viewerInfo;
    set({ viewerInfo });
    persist("viewerInfo", String(viewerInfo));
  },
  toggleViewerStrip: () => {
    const viewerStrip = !get().viewerStrip;
    set({ viewerStrip });
    persist("viewerStrip", String(viewerStrip));
  },
  setTagClipboard: (tagClipboard) => set({ tagClipboard }),
  rememberFolders: (ids) => {
    const rest = get().recentFolders.filter((f) => !ids.includes(f));
    set({ recentFolders: [...ids, ...rest].slice(0, 8) });
  },
  // Takes names because new tags only get an id once the backend creates them;
  // they are resolved against the tag list after the next refresh.
  rememberTags: (names) => {
    pendingRecentTags = [...names, ...pendingRecentTags.filter((n) => !names.includes(n))];
  },
  setRenamingFolder: (renamingFolder) => set({ renamingFolder }),
  requestItemRename: () => set({ renameItemSeq: get().renameItemSeq + 1, inspectorOpen: true }),
  setPicker: (picker) => set({ picker }),
  setWebImportOpen: (webImportOpen) => set({ webImportOpen }),
  setPairRequest: (pairRequest) => set({ pairRequest }),
  setSimilarLevel: (similarLevel) => {
    set({ similarLevel, keepPick: new Set(), selected: new Set(), anchor: null, focus: null });
    persist("similarLevel", similarLevel);
    get().refresh();
  },
  pickKeeper: (id) => {
    const items = get().items;
    const group = items.find((i) => i.id === id)?.group;
    const rivals = new Set(items.filter((i) => i.group === group).map((i) => i.id));
    set({ keepPick: new Set([...get().keepPick].filter((x) => !rivals.has(x)).concat(id)) });
  },
  setReview: (review) => set({ review }),

  refresh: async () => {
    if (!get().library) return;
    const seq = ++refreshSeq;
    const { view, search, tagFilter, tagMatchAll, sort, desc, showSubfolders, minRating, filter, similarLevel } = get();
    try {
      let dismissedGroups: number | null = null;
      if (view.kind === "similar") {
        set({ analyzing: true });
        try {
          await api.indexSimilar();
        } finally {
          set({ analyzing: false });
        }
        dismissedGroups = await api.countDismissedDuplicates();
      }
      const [rawItems, folders, tags, counts, smartFolders, exts] = await Promise.all([
        api.queryItems({
          view,
          search,
          tagIds: tagFilter,
          tagMatchAll,
          includeSubfolders: showSubfolders,
          minRating,
          filter,
          similarLevel,
          sort,
          desc,
        }),
        api.listFolders(),
        api.listTags(),
        api.getCounts(),
        api.listSmartFolders(),
        api.listExts(),
      ]);
      if (seq !== refreshSeq) return; // a newer refresh superseded this one
      const { items, sections } = arrange({ view, groupBy: get().groupBy, rawItems, tags, folders });
      const present = new Set(items.map((i) => i.id));
      const selected = new Set([...get().selected].filter((id) => present.has(id)));
      // Drop filters / views pointing at things that no longer exist.
      const tagIds = new Set(tags.map((t) => t.id));
      const tagFilterNow = get().tagFilter.filter((t) => tagIds.has(t));
      const viewNow = get().view;
      const viewGone =
        (viewNow.kind === "folder" && !folders.some((f) => f.id === viewNow.id)) ||
        (viewNow.kind === "smart" && !smartFolders.some((f) => f.id === viewNow.id));
      const folderIds = new Set(folders.map((f) => f.id));
      const byName = new Map(tags.map((t) => [t.name, t.id]));
      const fresh = pendingRecentTags.flatMap((n) => byName.get(n) ?? []);
      // Keep names not created yet (a refresh that began before add_tags finished).
      pendingRecentTags = pendingRecentTags.filter((n) => !byName.has(n)).slice(0, 12);
      const recentTags = [...fresh, ...get().recentTags.filter((t) => !fresh.includes(t))]
        .filter((t) => tagIds.has(t))
        .slice(0, 12);
      if (fresh.length) persist(recentTagsKey(get().library!.root), JSON.stringify(recentTags));
      // Keep the viewer on the image it was showing even if the list moved.
      const prev = get();
      const shownId = prev.viewer !== null ? prev.items[prev.viewer]?.id : undefined;
      const viewerNow =
        prev.viewer === null || items.length === 0
          ? null
          : shownId && present.has(shownId)
            ? items.findIndex((i) => i.id === shownId)
            : Math.min(prev.viewer, items.length - 1);
      set({
        items,
        rawItems,
        sections,
        folders,
        smartFolders,
        exts,
        tags,
        counts,
        selected,
        rev: get().rev + 1,
        ...(dismissedGroups !== null ? { dismissedGroups } : {}),
        recentFolders: get().recentFolders.filter((f) => folderIds.has(f)),
        recentTags,
        viewer: viewerNow,
      });
      if (viewGone || tagFilterNow.length !== get().tagFilter.length) {
        set({ tagFilter: tagFilterNow, ...(viewGone ? { view: { kind: "all" } } : {}) });
        get().refresh();
      }
    } catch (e) {
      get().toast(String(e), true);
    }
  },

  select: (id, mode) => {
    const { selected, anchor, items } = get();
    if (mode === "only") {
      set({ selected: new Set([id]), anchor: id, focus: id });
    } else if (mode === "toggle") {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ selected: next, anchor: id, focus: id });
    } else {
      const a = items.findIndex((i) => i.id === (anchor ?? id));
      const b = items.findIndex((i) => i.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      set({
        selected: new Set(items.slice(Math.max(lo, 0), hi + 1).map((i) => i.id)),
        focus: id,
      });
    }
  },
  setSelection: (ids) => {
    const last = ids.at(-1) ?? null;
    set({ selected: new Set(ids), anchor: last, focus: last });
  },
  openViewer: (viewer) => set({ viewer }),

  setDrag: (drag) => set({ drag, dropTarget: drag ? get().dropTarget : null }),
  setDropTarget: (dropTarget) => {
    if (get().dropTarget !== dropTarget) set({ dropTarget });
  },
  setFileDrag: (fileDrag) => {
    if (get().fileDrag !== fileDrag) set({ fileDrag, ...(fileDrag ? {} : { dropTarget: null }) });
  },
  flashTarget: (target) => {
    const n = ++flashSeq;
    set({ flash: { target, n } });
    setTimeout(() => get().flash?.n === n && set({ flash: null }), 900);
  },
  setImporting: (importing) => set({ importing }),
  setUpdating: (updating) => set({ updating }),
  toast: (message, error, action) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, error, action }] });
    setTimeout(() => get().dismissToast(id), error || action ? 6000 : 3500);
  },
  dismissToast: (id) => {
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
    // Mark first so the exit animation can play, then remove.
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 200);
  },
  run: async (fn) => {
    try {
      await fn();
    } catch (e) {
      get().toast(String(e), true);
    }
    await get().refresh();
  },
  importDone: (s) => {
    const parts = [`${s.imported} 件を追加`];
    if (s.duplicates) parts.push(`${s.duplicates} 件は重複のためスキップ`);
    if (s.failed.length) parts.push(`${s.failed.length} 件は読み込めませんでした`);
    get().toast(parts.join(" / "), s.failed.length > 0 && s.imported === 0);
    if (s.failed.length) console.warn("import failures", s.failed);
  },
}));

export function currentFolderId(): string | null {
  const v = useStore.getState().view;
  return v.kind === "folder" ? v.id : null;
}
