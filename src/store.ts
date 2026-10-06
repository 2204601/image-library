import { create } from "zustand";
import {
  api,
  type Counts,
  type Folder,
  type ImportSummary,
  type Item,
  type LibraryInfo,
  type SortKey,
  type Tag,
  type View,
} from "./lib/api";

/** x/y = current pointer, sx/sy = where the drag started (for snap-back). */
type DragPos = { x: number; y: number; sx: number; sy: number };
export type Drag =
  | ({ kind: "items"; ids: string[] } & DragPos)
  | ({ kind: "folder"; id: string } & DragPos);

export interface ToastAction {
  label: string;
  onClick: () => void;
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
  /** Most recently used target folders (for Shift+D and the picker). */
  recentFolders: string[];
  /** Most recently assigned tags, newest first (suggested in the tag input). */
  recentTags: number[];
  /** Folder whose name is being edited inline in the sidebar. */
  renamingFolder: string | null;
  /** Bumped to ask the inspector to focus the item name field. */
  renameItemSeq: number;
  picker: "add" | "goto" | null;

  items: Item[];
  folders: Folder[];
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
  rememberFolders: (ids: string[]) => void;
  rememberTags: (names: string[]) => void;
  setRenamingFolder: (id: string | null) => void;
  requestItemRename: () => void;
  setPicker: (p: State["picker"]) => void;
  refresh: () => Promise<void>;

  select: (id: string, mode: "only" | "toggle" | "range") => void;
  setSelection: (ids: string[]) => void;
  openViewer: (index: number | null) => void;

  setDrag: (d: Drag | null) => void;
  setDropTarget: (t: string | null) => void;
  setFileDrag: (on: boolean) => void;
  flashTarget: (target: string) => void;
  setImporting: (p: State["importing"]) => void;
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
  recentFolders: [],
  recentTags: [],
  renamingFolder: null,
  renameItemSeq: 0,
  picker: null,

  items: [],
  folders: [],
  tags: [],
  counts: { all: 0, unfiled: 0, untagged: 0, trash: 0 },
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
  analyzing: false,
  toasts: [],

  setLibrary: (library) => {
    set({
      library,
      view: { kind: "all" },
      search: "",
      tagFilter: [],
      recentTags: library ? loadRecentTags(library.root) : [],
      selected: new Set(),
      anchor: null,
      focus: null,
      viewer: null,
    });
    if (library) get().refresh();
  },
  setView: (view) => {
    // The similar view may take a moment to prepare; don't leave the old list up.
    const clear = view.kind === "similar" && get().view.kind !== "similar" ? { items: [] } : {};
    set({ view, selected: new Set(), anchor: null, focus: null, ...clear });
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

  refresh: async () => {
    if (!get().library) return;
    const seq = ++refreshSeq;
    const { view, search, tagFilter, tagMatchAll, sort, desc, showSubfolders, minRating } = get();
    try {
      if (view.kind === "similar") {
        set({ analyzing: true });
        try {
          await api.indexSimilar();
        } finally {
          set({ analyzing: false });
        }
      }
      const [items, folders, tags, counts] = await Promise.all([
        api.queryItems({
          view,
          search,
          tagIds: tagFilter,
          tagMatchAll,
          includeSubfolders: showSubfolders,
          minRating,
          sort,
          desc,
        }),
        api.listFolders(),
        api.listTags(),
        api.getCounts(),
      ]);
      if (seq !== refreshSeq) return; // a newer refresh superseded this one
      const present = new Set(items.map((i) => i.id));
      const selected = new Set([...get().selected].filter((id) => present.has(id)));
      // Drop filters / views pointing at things that no longer exist.
      const tagIds = new Set(tags.map((t) => t.id));
      const tagFilterNow = get().tagFilter.filter((t) => tagIds.has(t));
      const viewNow = get().view;
      const viewGone = viewNow.kind === "folder" && !folders.some((f) => f.id === viewNow.id);
      const folderIds = new Set(folders.map((f) => f.id));
      const byName = new Map(tags.map((t) => [t.name, t.id]));
      const fresh = pendingRecentTags.flatMap((n) => byName.get(n) ?? []);
      // Keep names not created yet (a refresh that began before add_tags finished).
      pendingRecentTags = pendingRecentTags.filter((n) => !byName.has(n)).slice(0, 12);
      const recentTags = [...fresh, ...get().recentTags.filter((t) => !fresh.includes(t))]
        .filter((t) => tagIds.has(t))
        .slice(0, 12);
      if (fresh.length) persist(recentTagsKey(get().library!.root), JSON.stringify(recentTags));
      set({
        items,
        folders,
        tags,
        counts,
        selected,
        rev: get().rev + 1,
        recentFolders: get().recentFolders.filter((f) => folderIds.has(f)),
        recentTags,
        viewer: get().viewer !== null && items.length === 0 ? null : get().viewer,
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
