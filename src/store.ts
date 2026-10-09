import { create } from "zustand";
import {
  api,
  EMPTY_FILTER,
  KINDS,
  kindLabel,
  type Counts,
  type DuplicateEffect,
  type Filter,
  type Folder,
  type Rule,
  type SmartFolder,
  type ImportSummary,
  type Item,
  type ItemKind,
  type LibraryInfo,
  type SimilarLevel,
  type SortKey,
  type Tag,
  type View,
} from "./lib/api";
import { fontApi } from "./features/fonts/api";
import { filesApi, onFileThumbs } from "./features/files/api";
import { modeKind, modeKinds, modesFor, type Mode } from "./lib/modes";
import {
  DEFAULT_LIBRARY_SETTINGS,
  openingMode,
  parseLibrarySettings,
  type LibrarySettings,
} from "./lib/librarySettings";
import { groupItems, similarSections, type GroupBy, type Section } from "./lib/grouping";

/**
 * What the app shows: every kind ("all") or one kind. Everything (the list,
 * counts, folders, tags, smart folders) is of the current mode; each mode
 * remembers its own layout and grouping.
 */
export { MODES, type Mode } from "./lib/modes";

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

export type Layout = "justified" | "grid" | "waterfall" | "list" | "specimen";

/** Layouts of each mode, the first being its default. */
export const MODE_LAYOUTS: Record<Mode, Layout[]> = {
  // Mixed kinds: every item as a thumbnail of the same box.
  all: ["grid", "justified", "list"],
  image: ["justified", "waterfall", "grid", "list"],
  font: ["specimen", "list", "grid"],
  file: ["grid", "list"],
};

/** Groupings of each mode. */
export const MODE_GROUPS: Record<Mode, GroupBy[]> = {
  all: ["none", "kind", "rating", "tag", "folder"],
  image: ["none", "rating", "tag", "folder"],
  font: ["none", "rating", "tag", "folder", "family"],
  file: ["none", "rating", "tag", "folder"],
};

/** What the grid shows under each thumbnail. */
export interface ShowInfo {
  name: boolean;
  dims: boolean;
  rating: boolean;
  /** File type and size. */
  meta: boolean;
}

export type ToastKind = "success" | "info" | "error";

export interface ToastOptions {
  title: string;
  /** A second, quieter line (counts, reasons). */
  detail?: string;
  kind?: ToastKind;
  action?: ToastAction;
  /** ms before it goes away; paused while hovered or while the window is in the background. */
  duration?: number;
}

export interface Toast extends Required<Pick<ToastOptions, "title" | "kind" | "duration">> {
  id: number;
  detail?: string;
  action?: ToastAction;
  leaving?: boolean;
}

export type TransferRequest =
  /** Selected items (`mode` names them: "画像 3 件"). */
  | { ids: string[]; mode: Mode; count: number }
  /** Every item of `kind` not in the trash. */
  | { ids: null; kind: ItemKind; count: number };

/**
 * What a "the contents of this list" action works on: given items, the list
 * on screen, or a folder / smart folder / tag / the tray from the sidebar.
 */
export type ListSource =
  | { kind: "ids"; ids: string[] }
  | { kind: "shown" }
  | { kind: "folder"; id: string }
  | { kind: "smart"; id: string }
  | { kind: "tag"; id: number }
  | { kind: "tray" };

/** The export dialog: what to write and its title ("「旅行」を書き出し"). */
export interface ExportRequest {
  source: ListSource;
  title: string;
}

/** The settings screen and where in it to open. */
export type SettingsTab = "general" | "library" | "integration";

/** A long task shown with a progress bar (bottom right). */
export interface Progress {
  label: string;
  done: number;
  total: number;
}

interface State {
  library: LibraryInfo | null;
  /** The open library's own settings (docs/SETTINGS.md). */
  librarySettings: LibrarySettings;

  mode: Mode;
  view: View;
  search: string;
  tagFilter: number[];
  /** Sidebar tag filter requires all selected tags (AND) instead of any (OR). */
  tagMatchAll: boolean;
  sort: SortKey;
  desc: boolean;
  thumbSize: number;
  /** Font specimen layout: the text every font shows ("" = each font's own sample) and its size in px. */
  specimenText: string;
  specimenSize: number;
  inspectorOpen: boolean;
  sidebarOpen: boolean;
  /** Widths of the sidebar and the details panel (px), dragged at their edge. */
  sidebarWidth: number;
  inspectorWidth: number;
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
  /** The settings screen (⌘,) is open, on this tab. */
  settingsTab: SettingsTab | null;
  /** Part of the tab to scroll to (element id), once. */
  settingsAnchor: string | null;
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
  /** Items the contact sheet dialog (まとめて出力) is open for, in order. */
  sheet: Item[] | null;
  /** The "別のライブラリへ" dialog: selected items, or every item of a kind. */
  transfer: TransferRequest | null;
  /** The export dialog (書き出し…). */
  exporting: ExportRequest | null;

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
  importing: Progress | null;
  /** Update download in progress (bytes; total is null when the server did not say). */
  updating: { done: number; total: number | null; installing?: boolean } | null;
  /** Hashing older images before the similar view can be shown. */
  analyzing: boolean;
  toasts: Toast[];

  /** Opens a library in the mode it was left in (see `openingMode`). */
  setLibrary: (lib: LibraryInfo | null) => Promise<void>;
  /** Switches kind; starts in "all" with no conditions, on the mode's own layout and grouping. */
  setMode: (mode: Mode) => void;
  /** Kinds the library is used for / switches to drop or bring back a kind. */
  setUsedModes: (modes: ItemKind[]) => void;
  /** Hides (or shows again) sidebar entries of a mode. */
  setSidebarHidden: (mode: Mode, ids: string[]) => void;
  setView: (view: View) => void;
  setSearch: (s: string) => void;
  toggleTagFilter: (id: number) => void;
  clearTagFilter: () => void;
  setTagMatchAll: (on: boolean) => void;
  setSort: (sort: SortKey, desc: boolean) => void;
  setThumbSize: (n: number) => void;
  setSpecimenText: (text: string) => void;
  setSpecimenSize: (px: number) => void;
  toggleInspector: () => void;
  toggleSidebar: () => void;
  /** Sets a panel's width (kept within its limits, see PANEL_WIDTH). */
  setPanelWidth: (panel: "sidebar" | "inspector", px: number) => void;
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
  openSettings: (tab: SettingsTab | null, anchor?: string) => void;
  setPairRequest: (r: State["pairRequest"]) => void;
  setSimilarLevel: (l: SimilarLevel) => void;
  /** Marks `id` as the copy to keep in its group. */
  pickKeeper: (id: string) => void;
  setReview: (r: DuplicateReview | null) => void;
  setSheet: (items: Item[] | null) => void;
  setTransfer: (t: TransferRequest | null) => void;
  setExporting: (r: ExportRequest | null) => void;
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
  /** A toast with a title, detail line and kind (results worth noticing). */
  notify: (t: ToastOptions) => void;
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

/** Default, smallest and largest width of the side panels. */
export const PANEL_WIDTH = {
  sidebar: { initial: 240, min: 190, max: 420 },
  inspector: { initial: 288, min: 240, max: 560 },
} as const;

const clampWidth = (panel: keyof typeof PANEL_WIDTH, px: number) =>
  Math.round(Math.min(PANEL_WIDTH[panel].max, Math.max(PANEL_WIDTH[panel].min, px)));

const loadJson = (key: string): object => {
  try {
    const v = JSON.parse(load(key) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

/** The mode's saved layout (the pre-mode "layout" key counts for images), else its default. */
const loadLayout = (mode: Mode): Layout => {
  const saved = load(`layout:${mode}`) ?? (mode === "image" ? load("layout") : null);
  return MODE_LAYOUTS[mode].find((l) => l === saved) ?? MODE_LAYOUTS[mode][0];
};
const loadGroupBy = (mode: Mode): GroupBy => {
  const saved = load(`groupBy:${mode}`) ?? (mode === "image" ? load("groupBy") : null);
  return MODE_GROUPS[mode].find((g) => g === saved) ?? "none";
};

/** Smart folders of a mode: saved in it, or before there were modes. */
export const smartFolderInMode = (sf: SmartFolder, mode: Mode) =>
  mode === "all" || !sf.rule.filter.kinds?.length || sf.rule.filter.kinds.includes(mode);

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
    (f.fontScripts.length ? 1 : 0) +
    (f.fontCategories.length ? 1 : 0) +
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

/**
 * The tray opens in its own order (the order things were put on it); the
 * sort used elsewhere is kept here and comes back on leaving the tray.
 */
let sortOutsideTray: { sort: SortKey; desc: boolean } | null = null;
function traySort(from: View, to: View, cur: { sort: SortKey; desc: boolean }): Partial<State> {
  if (to.kind === "tray" && from.kind !== "tray") {
    sortOutsideTray = { sort: cur.sort, desc: cur.desc };
    return { sort: "manual", desc: false };
  }
  if (to.kind !== "tray" && from.kind === "tray" && sortOutsideTray) {
    const back = sortOutsideTray;
    sortOutsideTray = null;
    return back;
  }
  return {};
}

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

// The mode comes from the library being opened (setLibrary).
const initialMode: Mode = "image";

let librarySeq = 0;

/** Saves one setting of the open library, reporting failures. */
function saveLibrarySetting(key: string, value: unknown) {
  api.setLibrarySetting(key, value).catch((e) => useStore.getState().toast(String(e), true));
}

/** Kinds the open library is used for, in `KINDS` order. */
export const usedModes = (s: { librarySettings: LibrarySettings }): ItemKind[] =>
  KINDS.map((k) => k.kind).filter((k) => s.librarySettings.modes.includes(k));

/** Modes the switch offers: "すべて" and the kinds in use (see `modesFor`). */
export const shownModes = (s: { librarySettings: LibrarySettings }): Mode[] => modesFor(usedModes(s));

/** Whether a sidebar entry (SIDEBAR_ENTRIES id) is hidden in the current mode. */
export const isHidden = (s: { librarySettings: LibrarySettings; mode: Mode }, id: string) =>
  s.librarySettings.hidden[s.mode]?.includes(id) ?? false;

/** Sidebar entry a view is listed under, if it can be hidden. */
export function entryOfView(v: View): string | null {
  switch (v.kind) {
    case "folder":
      return "section:folders";
    case "smart":
      return "section:smart";
    case "all":
    case "trash":
      return null;
    default:
      return v.kind;
  }
}

export const useStore = create<State>((set, get) => ({
  library: null,
  librarySettings: DEFAULT_LIBRARY_SETTINGS,

  mode: initialMode,
  view: { kind: "all" },
  search: "",
  tagFilter: [],
  tagMatchAll: load("tagMatchAll") === "true",
  sort: "importedAt",
  desc: true,
  thumbSize: loadNumber("thumbSize", 180),
  inspectorOpen: load("inspectorOpen") !== "false",
  sidebarOpen: load("sidebarOpen") !== "false",
  sidebarWidth: clampWidth("sidebar", loadNumber("sidebarWidth", PANEL_WIDTH.sidebar.initial)),
  inspectorWidth: clampWidth("inspector", loadNumber("inspectorWidth", PANEL_WIDTH.inspector.initial)),
  showSubfolders: load("showSubfolders") === "true",
  minRating: 0,
  filter: EMPTY_FILTER,
  filterOpen: load("filterOpen") === "true",
  editingSmart: null,
  layout: loadLayout(initialMode),
  specimenText: load("specimenText") ?? "",
  specimenSize: loadNumber("specimenSize", 40),
  showInfo: { name: true, dims: true, rating: true, meta: false, ...loadJson("showInfo") },
  groupBy: loadGroupBy(initialMode),
  viewerInfo: load("viewerInfo") === "true",
  viewerStrip: load("viewerStrip") !== "false",
  tagClipboard: [],
  recentFolders: [],
  recentTags: [],
  renamingFolder: null,
  renameItemSeq: 0,
  picker: null,
  settingsTab: null,
  settingsAnchor: null,
  pairRequest: null,
  similarLevel: (["strict", "standard", "loose"] as const).find((l) => l === load("similarLevel")) ?? "standard",
  keepPick: new Set(),
  dismissedGroups: 0,
  review: null,
  sheet: null,
  transfer: null,
  exporting: null,

  items: [],
  rawItems: [],
  sections: [],
  folders: [],
  smartFolders: [],
  exts: [],
  tags: [],
  counts: {
    all: 0,
    unfiled: 0,
    untagged: 0,
    trash: 0,
    favorites: 0,
    pinned: 0,
    tray: 0,
    kinds: {},
    fontScripts: {},
    fontCategories: {},
  },
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

  setLibrary: async (library) => {
    const seq = ++librarySeq;
    let librarySettings = DEFAULT_LIBRARY_SETTINGS;
    let mode = get().mode;
    if (library) {
      try {
        const [raw, counts] = await Promise.all([api.getLibrarySettings(), api.getCounts()]);
        librarySettings = parseLibrarySettings(raw);
        mode = openingMode(librarySettings, counts.kinds);
      } catch (e) {
        get().toast(String(e), true);
      }
      if (seq !== librarySeq) return; // another library was opened meanwhile
    }
    const sortNow = { ...get(), ...traySort(get().view, { kind: "all" }, get()) };
    set({
      library,
      librarySettings,
      mode,
      layout: loadLayout(mode),
      groupBy: loadGroupBy(mode),
      sort: sortNow.sort === "dimensions" && mode !== "image" ? "importedAt" : sortNow.sort,
      desc: sortNow.desc,
      items: [],
      rawItems: [],
      sections: [],
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
      fontApi
        .index()
        .then((n) => {
          if (n > 0) get().refresh();
        })
        .catch(() => {});
      // Windows: office documents' thumbnails made by Office (when installed).
      watchFileThumbs();
      filesApi.prepareThumbs().catch(() => {});
    }
  },
  setMode: (mode) => {
    if (mode === get().mode) return;
    // Remembered per library: it opens in this mode next time.
    if (get().library) {
      set({ librarySettings: { ...get().librarySettings, lastMode: mode } });
      saveLibrarySetting("lastMode", mode);
    }
    // Leaving the tray (if there) restores the sort it replaced.
    const sortNow = { ...get(), ...traySort(get().view, { kind: "all" }, get()) };
    set({
      mode,
      view: { kind: "all" },
      search: "",
      tagFilter: [],
      minRating: 0,
      filter: EMPTY_FILTER,
      editingSmart: null,
      layout: loadLayout(mode),
      groupBy: loadGroupBy(mode),
      // Only images have a pixel size.
      sort: sortNow.sort === "dimensions" && mode !== "image" ? "importedAt" : sortNow.sort,
      desc: sortNow.desc,
      items: [],
      rawItems: [],
      sections: [],
      selected: new Set(),
      anchor: null,
      focus: null,
      viewer: null,
    });
    get().refresh();
  },
  setUsedModes: (modes) => {
    const used = KINDS.map((k) => k.kind).filter((k) => modes.includes(k));
    if (!used.length) return;
    set({ librarySettings: { ...get().librarySettings, modes: used } });
    // Every kind = nothing to remember (a kind added later is used too).
    saveLibrarySetting("modes", used.length === KINDS.length ? null : used);
    if (!modesFor(used).includes(get().mode)) get().setMode(used[0]);
  },
  setSidebarHidden: (mode, ids) => {
    const hidden = { ...get().librarySettings.hidden, [mode]: ids };
    set({ librarySettings: { ...get().librarySettings, hidden } });
    saveLibrarySetting(`hidden:${mode}`, ids.length ? ids : null);
    if (mode !== get().mode) return;
    // Hiding what is open moves to "すべて"; hiding the tags drops their filter.
    const entry = entryOfView(get().view);
    if (entry && ids.includes(entry)) get().setView({ kind: "all" });
    if (ids.includes("section:tags") && get().tagFilter.length) get().clearTagFilter();
    if (ids.includes("section:fontFilters") && (get().filter.fontScripts.length || get().filter.fontCategories.length)) {
      get().setFilter({ fontScripts: [], fontCategories: [] });
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
    set({
      view,
      selected: new Set(),
      anchor: null,
      focus: null,
      ...clear,
      ...reset,
      ...traySort(get().view, view, get()),
    });
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
  setSpecimenText: (specimenText) => {
    set({ specimenText });
    persist("specimenText", specimenText);
  },
  setSpecimenSize: (px) => {
    const specimenSize = Math.min(160, Math.max(12, Math.round(px)));
    set({ specimenSize });
    persist("specimenSize", String(specimenSize));
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
  setPanelWidth: (panel, px) => {
    const w = clampWidth(panel, px);
    set(panel === "sidebar" ? { sidebarWidth: w } : { inspectorWidth: w });
    persist(`${panel}Width`, String(w));
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
    const { search, tagFilter, tagMatchAll, minRating, filter, mode } = get();
    // The rule remembers the mode it was made in (see `smartFolderInMode`).
    return { search, tagIds: tagFilter, tagMatchAll, minRating, filter: { ...filter, kinds: modeKinds(mode) } };
  },
  startEditSmart: (sf) => {
    // Edit in the "all" view so the user sees exactly what the rule matches.
    set({
      editingSmart: { id: sf.id, name: sf.name },
      ...traySort(get().view, { kind: "all" }, get()),
      view: { kind: "all" },
      search: sf.rule.search,
      tagFilter: sf.rule.tagIds,
      tagMatchAll: sf.rule.tagMatchAll,
      minRating: sf.rule.minRating,
      // The kind is the mode's, not an editable condition.
      filter: { ...EMPTY_FILTER, ...sf.rule.filter, kinds: [] },
      filterOpen: true,
      selected: new Set(),
    });
    get().refresh();
  },
  stopEditSmart: () => set({ editingSmart: null }),
  setLayout: (layout) => {
    set({ layout });
    persist(`layout:${get().mode}`, layout);
  },
  setShowInfo: (patch) => {
    const showInfo = { ...get().showInfo, ...patch };
    set({ showInfo });
    persist("showInfo", JSON.stringify(showInfo));
  },
  setGroupBy: (groupBy) => {
    persist(`groupBy:${get().mode}`, groupBy);
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
  openSettings: (settingsTab, anchor) => set({ settingsTab, settingsAnchor: anchor ?? null }),
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
  setSheet: (sheet) => set({ sheet }),
  setTransfer: (transfer) => set({ transfer }),
  setExporting: (exporting) => set({ exporting }),

  refresh: async () => {
    if (!get().library) return;
    const seq = ++refreshSeq;
    const { mode, view, search, tagFilter, tagMatchAll, sort, desc, showSubfolders, minRating, filter, similarLevel } =
      get();
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
      const [rawItems, folders, tags, counts, allSmart, exts] = await Promise.all([
        api.queryItems({
          view,
          search,
          tagIds: tagFilter,
          tagMatchAll,
          includeSubfolders: showSubfolders,
          minRating,
          // The list is of the mode's kind only.
          filter: { ...filter, kinds: modeKinds(mode) },
          similarLevel,
          sort,
          desc,
        }),
        api.listFolders(modeKind(mode)),
        api.listTags(modeKind(mode)),
        api.getCounts(modeKind(mode)),
        api.listSmartFolders(modeKind(mode)),
        api.listExts(modeKind(mode)),
      ]);
      if (seq !== refreshSeq) return; // a newer refresh superseded this one
      const smartFolders = allSmart.filter((sf) => smartFolderInMode(sf, mode));
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
  toast: (message, error, action) => get().notify({ title: message, kind: error ? "error" : "info", action }),
  notify: ({ title, detail, kind = "info", action, duration }) => {
    const id = ++toastSeq;
    const t: Toast = { id, title, detail, kind, action, duration: duration ?? (kind === "error" || action ? 8000 : 5000) };
    // At most a handful on screen; the oldest give way.
    const live = get().toasts.filter((x) => !x.leaving);
    for (const old of live.slice(0, Math.max(0, live.length - 3))) get().dismissToast(old.id);
    set({ toasts: [...get().toasts, t] });
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
    const parts = [];
    if (s.duplicates) parts.push(`${s.duplicates} 件はすでにあるためスキップ`);
    if (s.failed.length) parts.push(`${s.failed.length} 件は読み込めませんでした`);
    get().notify({
      // Dropped files can be of either kind, so no "画像" / "フォント" here.
      title: s.imported ? `${s.imported} 件を追加しました` : "追加されたものはありません",
      detail: parts.join(" / ") || undefined,
      kind: s.failed.length && !s.imported ? "error" : s.imported ? "success" : "info",
    });
    if (s.failed.length) console.warn("import failures", s.failed);
    notifyUnusedKinds(s.kinds ?? {});
    if (s.kinds?.file) filesApi.prepareThumbs().catch(() => {});
  },
}));

let watchingFileThumbs = false;
/** Shows office documents' thumbnails as they are replaced in the background. */
function watchFileThumbs() {
  if (watchingFileThumbs) return;
  watchingFileThumbs = true;
  onFileThumbs(() => useStore.getState().refresh()).catch(() => {
    watchingFileThumbs = false;
  });
}

/**
 * After an import: tells about items of kinds the library isn't used for
 * (they are imported all the same; the kind comes from the file), with a
 * button to start using the kind.
 */
export function notifyUnusedKinds(kinds: Partial<Record<ItemKind, number>>) {
  const s = useStore.getState();
  const used = usedModes(s);
  for (const { kind: m } of KINDS) {
    const n = kinds[m] ?? 0;
    if (!n || used.includes(m)) continue;
    s.notify({
      title: `${kindLabel(m)} ${n} 件を取り込みました`,
      detail: "このライブラリでは使っていない種類です",
      action: { label: `${kindLabel(m)}も使う`, onClick: () => useStore.getState().setUsedModes([...usedModes(useStore.getState()), m]) },
      duration: 12000,
    });
  }
}

export function currentFolderId(): string | null {
  const v = useStore.getState().view;
  return v.kind === "folder" ? v.id : null;
}
