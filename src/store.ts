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

export type Drag =
  | { kind: "items"; ids: string[]; x: number; y: number }
  | { kind: "folder"; id: string; x: number; y: number };

interface Toast {
  id: number;
  message: string;
  error?: boolean;
}

interface State {
  library: LibraryInfo | null;

  view: View;
  search: string;
  tagFilter: number[];
  sort: SortKey;
  desc: boolean;
  thumbSize: number;

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
  dropTarget: string | null; // folder id, or "root"
  importing: { done: number; total: number } | null;
  toasts: Toast[];

  setLibrary: (lib: LibraryInfo | null) => void;
  setView: (view: View) => void;
  setSearch: (s: string) => void;
  toggleTagFilter: (id: number) => void;
  setSort: (sort: SortKey, desc: boolean) => void;
  setThumbSize: (n: number) => void;
  refresh: () => Promise<void>;

  select: (id: string, mode: "only" | "toggle" | "range") => void;
  setSelection: (ids: string[]) => void;
  openViewer: (index: number | null) => void;

  setDrag: (d: Drag | null) => void;
  setDropTarget: (t: string | null) => void;
  setImporting: (p: State["importing"]) => void;
  toast: (message: string, error?: boolean) => void;
  /** Runs a mutation, reports errors, then refreshes. */
  run: (fn: () => Promise<unknown>) => Promise<void>;
  importDone: (s: ImportSummary) => void;
}

const loadNumber = (key: string, fallback: number) => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
};

let refreshSeq = 0;
let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  library: null,

  view: { kind: "all" },
  search: "",
  tagFilter: [],
  sort: "importedAt",
  desc: true,
  thumbSize: loadNumber("thumbSize", 180),

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
  dropTarget: null,
  importing: null,
  toasts: [],

  setLibrary: (library) => {
    set({
      library,
      view: { kind: "all" },
      search: "",
      tagFilter: [],
      selected: new Set(),
      anchor: null,
      focus: null,
      viewer: null,
    });
    if (library) get().refresh();
  },
  setView: (view) => {
    set({ view, selected: new Set(), anchor: null, focus: null });
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
  setSort: (sort, desc) => {
    set({ sort, desc });
    get().refresh();
  },
  setThumbSize: (thumbSize) => {
    set({ thumbSize });
    try {
      localStorage.setItem("thumbSize", String(thumbSize));
    } catch {
      /* ignore */
    }
  },

  refresh: async () => {
    if (!get().library) return;
    const seq = ++refreshSeq;
    const { view, search, tagFilter, sort, desc } = get();
    try {
      const [items, folders, tags, counts] = await Promise.all([
        api.queryItems({ view, search, tagIds: tagFilter, sort, desc }),
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
      set({
        items,
        folders,
        tags,
        counts,
        selected,
        rev: get().rev + 1,
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
  setImporting: (importing) => set({ importing }),
  toast: (message, error) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, error }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), error ? 6000 : 3500);
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
