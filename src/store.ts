import { create } from "zustand";
import {
  api,
  EMPTY_FILTER,
  KINDS,
  kindLabel,
  type AppSettings,
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
import { listIs, modeKind, modesFor, queryKinds, ruleKinds, usedKinds, type KindState, type Mode } from "./lib/modes";
import {
  DEFAULT_LIBRARY_SETTINGS,
  openingMode,
  parseLibrarySettings,
  parseSidebarHidden,
  SIDEBAR_ENTRIES,
  type LibrarySettings,
  type SidebarHidden,
} from "./lib/librarySettings";
import { groupItems, similarSections, type GroupBy, type Section } from "./lib/grouping";
import { warn } from "./lib/log";
import { notifyIfAway } from "./lib/osNotify";

/**
 * What the app shows: every kind ("all") or the fonts. Everything (the list,
 * counts, folders, tags, smart folders) is of the current mode; each mode
 * remembers its own layout and grouping. Inside "すべて", the kind filter
 * (`filter.kinds`) narrows the list to some kinds (see `listKinds`).
 */
export { MODES, type Mode } from "./lib/modes";
// The kinds a list holds (lib/modes.ts), used across the components.
export { listIs, listKinds, listNoun, queryKinds, shownKinds } from "./lib/modes";

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
  // Images keep their shape; fonts and files take a fixed one (layouts.ts `aspect`).
  all: ["justified", "waterfall", "grid", "list"],
  font: ["specimen", "list", "grid"],
};

/** Groupings of each mode. */
export const MODE_GROUPS: Record<Mode, GroupBy[]> = {
  all: ["none", "kind", "rating", "tag", "folder"],
  font: ["none", "rating", "tag", "folder", "familyOne", "family"],
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
  /** Rewrite this toast in place (a result following its "…しています"), if it is still showing. */
  replace?: number;
}

export interface Toast extends Required<Pick<ToastOptions, "title" | "kind" | "duration">> {
  id: number;
  /** Bumped when the toast is rewritten in place; restarts its countdown. */
  rev: number;
  detail?: string;
  action?: ToastAction;
  leaving?: boolean;
}

export type TransferRequest =
  /** Selected items (`noun` names them: "画像 3 件"). */
  | { ids: string[]; noun: string; count: number }
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

/**
 * The settings screen's pages: the app's (一般 … Claude), then the open
 * library's (概要, サイドバー). See docs/SETTINGS.md.
 */
export type SettingsTab =
  | "general"
  | "sidebar"
  | "extension"
  | "claude"
  | "library"
  | "librarySidebar"
  | "libraryShare";

/** Where sidebar entries are hidden: the app's settings or the open library's. */
export type SidebarScope = "app" | "library";

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
  /** The app's settings (settings.json); null until read at launch. */
  appSettings: AppSettings | null;

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
  /** Fonts lacking most of `specimenText` show their own sample instead (an English font with Japanese text). */
  specimenFallback: boolean;
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
  /** Viewer: the image alone, with the bar, arrows, details and strip hidden (H). */
  viewerBare: boolean;
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
  /** The settings screen (⌘,) is open, on this page. */
  settingsTab: SettingsTab | null;
  /** A browser extension asks to connect; `code` is also shown in the extension. */
  /** `extension`: the asking extension's id (chrome://extensions shows it). */
  pairRequest: { id: string; code: string; extension: string } | null;
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
  /** The folder the share dialog is open for (share.rs). */
  sharing: string | null;
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
  /** Switches mode; starts in "all" with no conditions, on the mode's own layout and grouping. */
  setMode: (mode: Mode) => void;
  /** Narrows "すべて" to these kinds (none = every kind the library is used for). */
  setKinds: (kinds: ItemKind[]) => void;
  /** Kinds the library is used for / switches to drop or bring back a kind. */
  setUsedModes: (modes: ItemKind[]) => void;
  /** Hides (or shows again) sidebar entries of a mode, in `scope` (default: the one in effect). */
  setSidebarHidden: (mode: Mode, ids: string[], scope?: SidebarScope) => void;
  /** The library gets its own sidebar entries, or follows the app's again. */
  setSidebarOwn: (own: boolean) => void;
  loadAppSettings: () => Promise<void>;
  /** Changes and saves the app's settings (once read). */
  saveAppSettings: (patch: Partial<AppSettings>) => void;
  setView: (view: View) => void;
  setSearch: (s: string) => void;
  toggleTagFilter: (id: number) => void;
  clearTagFilter: () => void;
  setTagMatchAll: (on: boolean) => void;
  setSort: (sort: SortKey, desc: boolean) => void;
  setThumbSize: (n: number) => void;
  setSpecimenText: (text: string) => void;
  setSpecimenSize: (px: number) => void;
  setSpecimenFallback: (on: boolean) => void;
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
  toggleViewerBare: () => void;
  setTagClipboard: (names: string[]) => void;
  rememberFolders: (ids: string[]) => void;
  rememberTags: (names: string[]) => void;
  setRenamingFolder: (id: string | null) => void;
  requestItemRename: () => void;
  setPicker: (p: State["picker"]) => void;
  openSettings: (tab: SettingsTab | null) => void;
  setPairRequest: (r: State["pairRequest"]) => void;
  setSimilarLevel: (l: SimilarLevel) => void;
  /** Marks `id` as the copy to keep in its group. */
  pickKeeper: (id: string) => void;
  setReview: (r: DuplicateReview | null) => void;
  setSheet: (items: Item[] | null) => void;
  setTransfer: (t: TransferRequest | null) => void;
  setSharing: (folderId: string | null) => void;
  setExporting: (r: ExportRequest | null) => void;
  refresh: () => Promise<void>;

  /**
   * `at`: the item's display index. With tag grouping an item can appear
   * more than once, and a range runs between the places clicked.
   */
  select: (id: string, mode: "only" | "toggle" | "range", at?: number) => void;
  setSelection: (ids: string[]) => void;
  openViewer: (index: number | null) => void;

  setDrag: (d: Drag | null) => void;
  setDropTarget: (t: string | null) => void;
  setFileDrag: (on: boolean) => void;
  flashTarget: (target: string) => void;
  setImporting: (p: State["importing"]) => void;
  setUpdating: (p: State["updating"]) => void;
  toast: (message: string, error?: boolean, action?: ToastAction) => void;
  /** A toast with a title, detail line and kind (results worth noticing). Returns its id. */
  notify: (t: ToastOptions) => number;
  dismissToast: (id: number) => void;
  /**
   * Runs a mutation, reports errors, then refreshes. Resolves to whether it
   * worked: a result message must not follow the error toast.
   */
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  /** Reports an import; `since` (when it started) also tells the OS if it was long. */
  importDone: (s: ImportSummary, since?: number) => void;
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

/**
 * The mode's saved layout, else its default. "すべて" falls back to what the
 * image mode of earlier versions had (and the "layout" key from before modes).
 */
const loadLayout = (mode: Mode): Layout => {
  const keys = mode === "all" ? ["layout:all", "layout:image", "layout"] : [`layout:${mode}`];
  const saved = keys.map(load).find((v) => v !== null);
  return MODE_LAYOUTS[mode].find((l) => l === saved) ?? MODE_LAYOUTS[mode][0];
};
const loadGroupBy = (mode: Mode): GroupBy => {
  const keys = mode === "all" ? ["groupBy:all", "groupBy:image", "groupBy"] : [`groupBy:${mode}`];
  const saved = keys.map(load).find((v) => v !== null);
  return MODE_GROUPS[mode].find((g) => g === saved) ?? "none";
};

/** Smart folders of a mode: any in "すべて"; in a kind's mode, those that can hold the kind. */
export const smartFolderInMode = (sf: SmartFolder, mode: Mode) =>
  mode === "all" || !sf.rule.filter.kinds?.length || sf.rule.filter.kinds.includes(mode);

/** Conditions only images have (shape, pixel size), cleared when the list isn't of images alone. */
const IMAGE_ONLY: Partial<Filter> = { shapes: [], minWidth: null, maxWidth: null, minHeight: null, maxHeight: null };

/**
 * Drops what no longer applies once the list holds other kinds: image-only
 * conditions and the pixel size sort.
 */
function fitToKinds(s: KindState & { sort: SortKey }): Partial<State> {
  if (listIs(s, "image")) return {};
  return { filter: { ...s.filter, ...IMAGE_ONLY }, ...(s.sort === "dimensions" ? { sort: "importedAt" as SortKey } : {}) };
}

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
    // The kind filter shows on the toolbar itself, not as a condition.
    (f.fontScripts.length ? 1 : 0) +
    (f.fontCategories.length ? 1 : 0) +
    (f.fontWeights.length ? 1 : 0) +
    (f.fontFeatures.length ? 1 : 0) +
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
/** Display index of `anchor` when known (see `select`). */
let anchorAt: number | null = null;

/** Display index of item `id`: `at` when it is there, else its first place. */
function indexOf(items: Item[], id: string, at: number | null | undefined): number {
  return at != null && items[at]?.id === id ? at : items.findIndex((i) => i.id === id);
}

/** `ids` plus, for each family row among `items` (family view), all its fonts. */
function withFamilies(ids: Iterable<string>, items: Item[]): Set<string> {
  const out = new Set(ids);
  if (!items.some((i) => i.familyIds)) return out;
  for (const i of items) if (i.familyIds && out.has(i.id)) i.familyIds.forEach((m) => out.add(m));
  return out;
}

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
const initialMode: Mode = "all";

let librarySeq = 0;

/**
 * After the sidebar entries in effect changed: hiding what is open moves to
 * "すべて"; hiding the tags (or the fonts' filters) drops their conditions.
 */
function leaveHidden() {
  const s = useStore.getState();
  const ids = sidebarHidden(s)[s.mode] ?? [];
  const entry = entryOfView(s.view);
  if (entry && ids.includes(entry)) s.setView({ kind: "all" });
  if (ids.includes("section:tags") && s.tagFilter.length) s.clearTagFilter();
  const f = s.filter;
  if (
    ids.includes("section:fontFilters") &&
    (f.fontScripts.length || f.fontCategories.length || f.fontWeights.length || f.fontFeatures.length)
  ) {
    s.setFilter({ fontScripts: [], fontCategories: [], fontWeights: [], fontFeatures: [] });
  }
}

/** The sidebar entry's name ("作業台"), for messages. */
export const sidebarEntryLabel = (id: string) => SIDEBAR_ENTRIES.find((e) => e.id === id)?.label ?? id;

/** Saves one setting of the open library, reporting failures. */
function saveLibrarySetting(key: string, value: unknown) {
  api.setLibrarySetting(key, value).catch((e) => useStore.getState().toast(String(e), true));
}

/** Kinds the open library is used for, in `KINDS` order. */
export const usedModes = usedKinds;

/** Modes the switch offers: "すべて", and the fonts when used with another kind (see `modesFor`). */
export const shownModes = (s: { librarySettings: LibrarySettings }): Mode[] => modesFor(usedModes(s));

type SidebarState = Pick<State, "library" | "librarySettings" | "appSettings">;

/** Whose sidebar entries are in effect: the library's own, or the app's. */
export const sidebarScope = (s: SidebarState): SidebarScope =>
  s.library && s.librarySettings.sidebarOwn ? "library" : "app";

const NOTHING_HIDDEN: SidebarHidden = {};

/** Sidebar entries hidden in `scope` (default: the one in effect), per mode. */
export const sidebarHidden = (s: SidebarState, scope = sidebarScope(s)): SidebarHidden =>
  scope === "library" ? s.librarySettings.hidden : (s.appSettings?.sidebarHidden ?? NOTHING_HIDDEN);

/** Whether a sidebar entry (SIDEBAR_ENTRIES id) is hidden in the current mode. */
export const isHidden = (s: SidebarState & { mode: Mode }, id: string) =>
  sidebarHidden(s)[s.mode]?.includes(id) ?? false;

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
  appSettings: null,

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
  specimenFallback: load("specimenFallback") !== "false",
  showInfo: { name: true, dims: true, rating: true, meta: false, ...loadJson("showInfo") },
  groupBy: loadGroupBy(initialMode),
  viewerInfo: load("viewerInfo") === "true",
  viewerStrip: load("viewerStrip") !== "false",
  viewerBare: load("viewerBare") === "true",
  tagClipboard: [],
  recentFolders: [],
  recentTags: [],
  renamingFolder: null,
  renameItemSeq: 0,
  picker: null,
  settingsTab: null,
  pairRequest: null,
  similarLevel: (["strict", "standard", "loose"] as const).find((l) => l === load("similarLevel")) ?? "standard",
  keepPick: new Set(),
  dismissedGroups: 0,
  review: null,
  sheet: null,
  transfer: null,
  sharing: null,
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
    fontWeights: {},
    fontFeatures: {},
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
    // Left in the image or file mode of an earlier version: "すべて" of that kind,
    // remembered as "すべて" from now on.
    const filter = { ...EMPTY_FILTER, kinds: mode === "all" ? librarySettings.lastKinds : [] };
    if (library && librarySettings.lastKinds.length) {
      librarySettings = { ...librarySettings, lastKinds: [] };
      saveLibrarySetting("lastMode", mode);
    }
    const sortNow = { ...get(), ...traySort(get().view, { kind: "all" }, get()) };
    const next = { mode, view: { kind: "all" } as View, filter, smartFolders: [], librarySettings };
    set({
      library,
      librarySettings,
      mode,
      layout: loadLayout(mode),
      groupBy: loadGroupBy(mode),
      sort: sortNow.sort,
      desc: sortNow.desc,
      items: [],
      rawItems: [],
      sections: [],
      view: { kind: "all" },
      search: "",
      tagFilter: [],
      minRating: 0,
      filter,
      ...fitToKinds({ ...next, sort: sortNow.sort }),
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
    const next = { ...get(), mode, view: { kind: "all" } as View, filter: EMPTY_FILTER };
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
      sort: sortNow.sort,
      desc: sortNow.desc,
      // Only images have a pixel size.
      ...fitToKinds({ ...next, sort: sortNow.sort }),
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
  setKinds: (kinds) => {
    const s = get();
    const used = usedModes(s);
    const picked = used.filter((k) => kinds.includes(k));
    // Every kind in use is the same list as none picked.
    const filter = { ...s.filter, kinds: picked.length === used.length ? [] : picked };
    set({ filter, ...fitToKinds({ ...s, filter }) });
    get().refresh();
  },
  setUsedModes: (modes) => {
    const used = KINDS.map((k) => k.kind).filter((k) => modes.includes(k));
    if (!used.length) return;
    set({ librarySettings: { ...get().librarySettings, modes: used } });
    // Every kind = nothing to remember (a kind added later is used too).
    saveLibrarySetting("modes", used.length === KINDS.length ? null : used);
    if (!modesFor(used).includes(get().mode)) get().setMode(modesFor(used)[0]);
    else {
      // A kind dropped from the kind filter; what applied to it alone goes too.
      const s = get();
      const filter = { ...s.filter, kinds: s.filter.kinds.filter((k) => used.includes(k)) };
      set({ filter, ...fitToKinds({ ...s, filter }) });
      get().refresh();
    }
  },
  setSidebarHidden: (mode, ids, scope = sidebarScope(get())) => {
    if (scope === "app") {
      const app = get().appSettings;
      if (!app) return;
      const sidebarHidden = { ...app.sidebarHidden, [mode]: ids };
      if (!ids.length) delete sidebarHidden[mode];
      get().saveAppSettings({ sidebarHidden });
    } else {
      const hidden = { ...get().librarySettings.hidden, [mode]: ids };
      if (!ids.length) delete hidden[mode];
      set({ librarySettings: { ...get().librarySettings, hidden } });
      saveLibrarySetting(`hidden:${mode}`, ids.length ? ids : null);
    }
    leaveHidden();
  },
  setSidebarOwn: (own) => {
    const ls = get().librarySettings;
    if (!get().library || own === ls.sidebarOwn) return;
    let hidden = ls.hidden;
    // Starts from the app's entries, unless the library had its own before.
    if (own && !Object.keys(hidden).length) {
      hidden = { ...(get().appSettings?.sidebarHidden ?? {}) };
      for (const [m, ids] of Object.entries(hidden)) saveLibrarySetting(`hidden:${m}`, ids);
    }
    set({ librarySettings: { ...ls, hidden, sidebarOwn: own } });
    saveLibrarySetting("sidebar", own ? "own" : "app");
    leaveHidden();
  },
  loadAppSettings: async () => {
    try {
      const app = await api.getAppSettings();
      set({ appSettings: { ...app, sidebarHidden: parseSidebarHidden(app.sidebarHidden) } });
      leaveHidden();
    } catch (e) {
      get().toast(String(e), true);
    }
  },
  saveAppSettings: (patch) => {
    const app = get().appSettings;
    if (!app) return;
    const next = { ...app, ...patch };
    set({ appSettings: next });
    api.setAppSettings(next).catch((e) => get().toast(String(e), true));
  },
  setView: (view) => {
    // The similar view may take a moment to prepare; don't leave the old list up.
    const clear =
      view.kind === "similar" && get().view.kind !== "similar" ? { items: [], rawItems: [], sections: [] } : {};
    // Conditions belong to the view they were set in: moving to another one
    // starts clean (re-selecting the open view keeps them).
    // The kind filter stays: it is what the user browses, like a mode.
    const moved = JSON.stringify(view) !== JSON.stringify(get().view);
    const reset = moved
      ? {
          search: "",
          tagFilter: [],
          minRating: 0,
          filter: { ...EMPTY_FILTER, kinds: get().filter.kinds },
          editingSmart: null,
        }
      : {};
    const next = { ...get(), ...reset, view, ...traySort(get().view, view, get()) };
    set({
      view,
      selected: new Set(),
      anchor: null,
      focus: null,
      ...clear,
      ...reset,
      ...traySort(get().view, view, get()),
      ...fitToKinds(next),
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
  setSpecimenFallback: (specimenFallback) => {
    set({ specimenFallback });
    persist("specimenFallback", String(specimenFallback));
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
    // The kind filter has its own "すべて" on the toolbar.
    set({ search: "", tagFilter: [], minRating: 0, filter: { ...EMPTY_FILTER, kinds: get().filter.kinds } });
    get().refresh();
  },
  toggleFilterOpen: () => {
    const filterOpen = !get().filterOpen;
    set({ filterOpen });
    persist("filterOpen", String(filterOpen));
  },
  currentRule: () => {
    const s = get();
    const { search, tagFilter, tagMatchAll, minRating, filter } = s;
    // The kinds picked are a condition like the others; a rule made in the font
    // mode keeps to fonts (see `smartFolderInMode`).
    const kinds: ItemKind[] = s.mode === "font" ? ["font"] : filter.kinds;
    return { search, tagIds: tagFilter, tagMatchAll, minRating, filter: { ...filter, kinds } };
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
      // The kinds go to the kind filter (in the font mode, they are its own). Shape and
      // pixel size only match images, so a rule with them shows as of images.
      filter: { ...EMPTY_FILTER, ...sf.rule.filter, kinds: get().mode === "all" ? ruleKinds(sf.rule.filter) : [] },
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
  toggleViewerBare: () => {
    const viewerBare = !get().viewerBare;
    set({ viewerBare });
    persist("viewerBare", String(viewerBare));
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
  openSettings: (settingsTab) => set({ settingsTab }),
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
  setSharing: (sharing) => set({ sharing }),
  setExporting: (exporting) => set({ exporting }),

  refresh: async () => {
    if (!get().library) return;
    const seq = ++refreshSeq;
    const { mode, view, search, tagFilter, tagMatchAll, sort, desc, showSubfolders, minRating, filter, similarLevel } =
      get();
    const kinds = queryKinds(get());
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
          // The mode's kinds, narrowed by the kind filter.
          filter: { ...filter, kinds },
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
      const present = new Set(items.flatMap((i) => i.familyIds ?? [i.id]));
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

  select: (id, mode, at) => {
    const { selected, anchor, items } = get();
    const b = indexOf(items, id, at);
    // No anchor in the list any more (trashed, filtered out): a range from
    // nowhere would run from the top, so it starts here instead.
    const a = mode === "range" && anchor !== null ? indexOf(items, anchor, anchorAt) : -1;
    if (mode === "range" && a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      set({ selected: withFamilies(items.slice(lo, hi + 1).map((i) => i.id), items), focus: id });
      return;
    }
    anchorAt = b >= 0 ? b : null;
    if (mode === "toggle") {
      const next = new Set(selected);
      const own = withFamilies([id], items);
      if (next.has(id)) own.forEach((m) => next.delete(m));
      else own.forEach((m) => next.add(m));
      set({ selected: next, anchor: id, focus: id });
    } else {
      set({ selected: withFamilies([id], items), anchor: id, focus: id });
    }
  },
  setSelection: (ids) => {
    const last = ids.at(-1) ?? null;
    anchorAt = null;
    set({ selected: withFamilies(ids, get().items), anchor: last, focus: last });
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
  notify: ({ title, detail, kind = "info", action, duration, replace }) => {
    const rev = ++toastSeq;
    const fields = { title, detail, kind, action, rev, duration: duration ?? (kind === "error" || action ? 8000 : 5000) };
    if (replace !== undefined && get().toasts.some((x) => x.id === replace && !x.leaving)) {
      set({ toasts: get().toasts.map((x) => (x.id === replace ? { ...fields, id: replace } : x)) });
      return replace;
    }
    const t: Toast = { ...fields, id: rev };
    // At most a handful on screen; the oldest give way.
    const live = get().toasts.filter((x) => !x.leaving);
    for (const old of live.slice(0, Math.max(0, live.length - 3))) get().dismissToast(old.id);
    set({ toasts: [...get().toasts, t] });
    return t.id;
  },
  dismissToast: (id) => {
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
    // Mark first so the exit animation can play, then remove.
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 200);
  },
  run: async (fn) => {
    let ok = true;
    try {
      await fn();
    } catch (e) {
      ok = false;
      get().toast(String(e), true);
    }
    await get().refresh();
    return ok;
  },
  importDone: (s, since) => {
    const parts = [];
    if (s.duplicates) parts.push(`${s.duplicates} 件はすでにあるためスキップ`);
    if (s.failed.length) parts.push(`${s.failed.length} 件は読み込めませんでした`);
    // Dropped files can be of either kind, so no "画像" / "フォント" here.
    const title = s.imported ? `${s.imported} 件を追加しました` : "追加されたものはありません";
    const detail = parts.join(" / ") || undefined;
    get().notify({
      title,
      detail,
      kind: s.failed.length && !s.imported ? "error" : s.imported ? "success" : "info",
    });
    if (since !== undefined) notifyIfAway(since, title, detail);
    if (s.failed.length) warn("import failures", s.failed);
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
