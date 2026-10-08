// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

export interface LibraryInfo {
  root: string;
  name: string;
}

export interface Item {
  id: string;
  /** Fonts have no pixel size (0 × 0) and a rendered sample as the thumbnail. */
  kind: "image" | "font";
  name: string;
  fileName: string;
  ext: string;
  width: number;
  height: number;
  size: number;
  thumb: string;
  note: string;
  rating: number;
  importedAt: number;
  deletedAt: number | null;
  /** JPEG display copy for HEIC / TIFF. */
  preview: string | null;
  favorite: boolean;
  /** When the item was pinned to the top of lists; null = not pinned. */
  pinnedAt: number | null;
  /** Clockwise quarter turns (0-3), applied after `flipped`. width / height are already the turned size. */
  rotation: number;
  /** Mirrored horizontally (before rotating). */
  flipped: boolean;
  /** The folder the item is in, if any (one at most). */
  folderId: string | null;
  tagIds: number[];
  /** The web page the item was saved from with the browser extension. */
  sourceUrl: string | null;
  filePath: string;
  thumbPath: string;
  /** What the viewer shows: the display copy if any, else the original. */
  displayPath: string;
  /** Similar view only: items with the same number look alike. Best copy first. */
  group?: number;
  /** Similar view only: differing hash bits (of 64) from the group's best copy. */
  distance?: number;
}

export interface FontFaceInfo {
  family: string;
  style: string;
  fullName: string;
  weight: number;
  italic: boolean;
  glyphs: number;
}

export interface FontInfo {
  /** Every font in the file (several for TTC / OTC). */
  faces: FontFaceInfo[];
  /** Characters of the requested font (code points), the first few thousand. */
  chars: number[];
  charCount: number;
}

/** "1200 × 800", or the kind for files without a pixel size. */
export function sizeLabel(item: Pick<Item, "kind" | "width" | "height">): string {
  return item.kind === "font" ? "フォント" : `${item.width} × ${item.height}`;
}

/** Rotate / flip, applied on top of the current orientation (the file is never changed). */
export type OrientOp = "rotateCw" | "rotateCcw" | "flipH" | "flipV" | "reset";

/**
 * CSS transform that shows the original file with the item's orientation.
 * Flip first, then rotate — the same order as src-tauri/src/orient.rs.
 */
export function orientTransform(item: Pick<Item, "rotation" | "flipped">): string {
  const parts = [];
  if (item.rotation) parts.push(`rotate(${item.rotation * 90}deg)`);
  if (item.flipped) parts.push("scaleX(-1)");
  return parts.join(" ");
}

export type View =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "untagged" }
  | { kind: "trash" }
  | { kind: "similar" }
  | { kind: "favorites" }
  | { kind: "pinned" }
  | { kind: "folder"; id: string }
  | { kind: "smart"; id: string };

export type Shape = "landscape" | "portrait" | "square";

/** Attribute filters (the filter bar). Empty / null = no restriction. */
export interface Filter {
  exts: string[];
  shapes: Shape[];
  minWidth: number | null;
  maxWidth: number | null;
  minHeight: number | null;
  maxHeight: number | null;
  /** ms; after inclusive, before exclusive. */
  importedAfter: number | null;
  importedBefore: number | null;
  /** bytes */
  minSize: number | null;
  maxSize: number | null;
}

export const EMPTY_FILTER: Filter = {
  exts: [],
  shapes: [],
  minWidth: null,
  maxWidth: null,
  minHeight: null,
  maxHeight: null,
  importedAfter: null,
  importedBefore: null,
  minSize: null,
  maxSize: null,
};

/** Saved conditions of a smart folder (same shape as the ad-hoc ones). */
export interface Rule {
  search: string;
  tagIds: number[];
  tagMatchAll: boolean;
  minRating: number;
  filter: Filter;
}

export interface SmartFolder {
  id: string;
  name: string;
  rule: Rule;
  count: number;
  color: string | null;
}

/** How alike images must be to count as duplicates: strict, standard, loose. */
export type SimilarLevel = "strict" | "standard" | "loose";

export type SortKey = "importedAt" | "name" | "size" | "dimensions" | "rating" | "manual";

export interface ItemQuery {
  view: View;
  search: string;
  tagIds: number[];
  /** true: items must carry every tag in `tagIds`; false: any one of them. */
  tagMatchAll: boolean;
  includeSubfolders: boolean;
  minRating: number;
  filter: Filter;
  similarLevel: SimilarLevel;
  sort: SortKey;
  desc: boolean;
}

export interface Counts {
  all: number;
  unfiled: number;
  untagged: number;
  trash: number;
  favorites: number;
  pinned: number;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  count: number;
  /** Colour name (see lib/colors.ts), if set. */
  color: string | null;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
  color: string | null;
}

export interface SelectionInfo {
  tags: Tag[];
  folders: { id: string; count: number }[];
}

/** What tidying one duplicate group carries over to the copy kept. */
export interface DuplicateEffect {
  keep: string;
  remove: string[];
  addedTags: string[];
  /** The kept copy's new rating, if it goes up. */
  rating: number | null;
  /** Folder the kept copy moves into (only if it had none). */
  folderId: string | null;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  failed: string[];
}

/** Saving from the browser extension (src-tauri/src/webimport.rs). */
export interface WebImportStatus {
  enabled: boolean;
  /** The local server is listening. */
  running: boolean;
  port: number;
  /** Why it isn't running although enabled (e.g. the port is taken). */
  error: string | null;
  /** Where the extension was put for Chrome, once set up. */
  extensionDir: string | null;
}

export const api = {
  openLastLibrary: () => invoke<LibraryInfo | null>("open_last_library"),
  createLibrary: (path: string) => invoke<LibraryInfo>("create_library", { path }),
  openLibrary: (path: string) => invoke<LibraryInfo>("open_library", { path }),

  queryItems: (query: ItemQuery) => invoke<Item[]>("query_items", { query }),
  getCounts: () => invoke<Counts>("get_counts"),
  selectionInfo: (ids: string[]) => invoke<SelectionInfo>("selection_info", { ids }),
  setNote: (id: string, note: string) => invoke<void>("set_note", { id, note }),
  renameItem: (id: string, name: string) => invoke<void>("rename_item", { id, name }),
  trashItems: (ids: string[]) => invoke<void>("trash_items", { ids }),
  restoreItems: (ids: string[]) => invoke<void>("restore_items", { ids }),
  deleteItems: (ids: string[]) => invoke<void>("delete_items", { ids }),
  emptyTrash: () => invoke<void>("empty_trash"),
  revealItem: (id: string) => invoke<void>("reveal_item", { id }),
  openItems: (ids: string[]) => invoke<void>("open_items", { ids }),
  setRating: (ids: string[], rating: number) => invoke<void>("set_rating", { ids, rating }),
  setFavorite: (ids: string[], on: boolean) => invoke<void>("set_favorite", { ids, on }),
  /** Pinned items come first in every list. */
  setPinned: (ids: string[], on: boolean) => invoke<void>("set_pinned", { ids, on }),
  fontInfo: (id: string, face: number) => invoke<FontInfo>("font_info", { id, face }),
  /** One font of the file as plain OpenType data, for `new FontFace()`. */
  fontData: (id: string, face: number) => invoke<ArrayBuffer>("font_data", { id, face }),
  orientItems: (ids: string[], op: OrientOp) => invoke<number>("orient_items", { ids, op }),
  copyItems: (ids: string[]) => invoke<number>("copy_items", { ids }),
  exportItems: (ids: string[], dest: string) => invoke<number>("export_items", { ids, dest }),

  importPaths: (paths: string[], folderId: string | null) =>
    invoke<ImportSummary>("import_paths", { paths, folderId }),
  importBytes: (name: string, data: Uint8Array, folderId: string | null) =>
    invoke<ImportSummary>("import_bytes", data, {
      headers: { "x-name": encodeURIComponent(name), "x-folder": folderId ?? "" },
    }),
  supportedExts: () => invoke<string[]>("supported_exts"),
  webImportStatus: () => invoke<WebImportStatus>("web_import_status"),
  setWebImport: (enabled: boolean) => invoke<WebImportStatus>("set_web_import", { enabled }),
  /** A new connection key: extensions set up elsewhere stop working until set up again. */
  resetWebImportToken: () => invoke<WebImportStatus>("reset_web_import_token"),
  /** Copies the extension to a folder Chrome can load and shows it; returns the folder. */
  installExtension: () => invoke<string>("install_extension"),
  /** Answers an extension's request to connect (the "web-pair" event). */
  answerWebPair: (id: string, allow: boolean) => invoke<void>("answer_web_pair", { id, allow }),
  indexSimilar: () => invoke<number>("index_similar"),
  /** Treats these images as "not duplicates" so they aren't proposed together again. */
  dismissDuplicates: (ids: string[]) => invoke<void>("dismiss_duplicates", { ids }),
  undismissDuplicates: (ids: string[]) => invoke<void>("undismiss_duplicates", { ids }),
  clearDismissedDuplicates: () => invoke<void>("clear_dismissed_duplicates"),
  /** Number of dismissed groups still in effect. */
  countDismissedDuplicates: () => invoke<number>("count_dismissed_duplicates"),
  /** What `resolveDuplicates` would carry over, without changing anything. */
  previewDuplicates: (groups: { keep: string; remove: string[] }[]) =>
    invoke<DuplicateEffect[]>("preview_duplicates", { groups }),
  /** Trashes `remove`, first copying their tags and rating (and folder, if `keep` has none) onto `keep`. */
  resolveDuplicates: (groups: { keep: string; remove: string[] }[]) =>
    invoke<DuplicateEffect[]>("resolve_duplicates", { groups }),

  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (name: string, parentId: string | null) =>
    invoke<string>("create_folder", { name, parentId }),
  renameFolder: (id: string, name: string) => invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  moveFolder: (id: string, parentId: string | null) =>
    invoke<boolean>("move_folder", { id, parentId }),
  /** An item is in one folder at most: this takes it out of the one it was in. */
  moveToFolder: (ids: string[], folderId: string) => invoke<void>("move_to_folder", { ids, folderId }),
  reorderInFolder: (folderId: string, ids: string[], before: string | null) =>
    invoke<void>("reorder_in_folder", { folderId, ids, before }),
  placeFolder: (id: string, parentId: string | null, before: string | null) =>
    invoke<boolean>("place_folder", { id, parentId, before }),
  /** -1 / +1 = up / down one; very large values move to the top / bottom. */
  shiftFolder: (id: string, by: number) => invoke<void>("shift_folder", { id, by }),
  sortFoldersByName: (parentId: string | null) => invoke<void>("sort_folders_by_name", { parentId }),
  listSmartFolders: () => invoke<SmartFolder[]>("list_smart_folders"),
  createSmartFolder: (name: string, rule: Rule) => invoke<string>("create_smart_folder", { name, rule }),
  updateSmartFolder: (id: string, patch: { name?: string; rule?: Rule }) =>
    invoke<void>("update_smart_folder", { id, name: patch.name ?? null, rule: patch.rule ?? null }),
  deleteSmartFolder: (id: string) => invoke<void>("delete_smart_folder", { id }),
  listExts: () => invoke<[string, number][]>("list_exts"),
  removeFromFolder: (ids: string[], folderId: string) =>
    invoke<void>("remove_from_folder", { ids, folderId }),

  listTags: () => invoke<Tag[]>("list_tags"),
  addTags: (ids: string[], names: string[]) => invoke<void>("add_tags", { ids, names }),
  removeTag: (ids: string[], tagId: number) => invoke<void>("remove_tag", { ids, tagId }),
  renameTag: (id: number, name: string) => invoke<void>("rename_tag", { id, name }),
  deleteTag: (id: number) => invoke<void>("delete_tag", { id }),
  /** `color` null clears it. */
  setFolderColor: (id: string, color: string | null) => invoke<void>("set_folder_color", { id, color }),
  setSmartFolderColor: (id: string, color: string | null) =>
    invoke<void>("set_smart_folder_color", { id, color }),
  setTagColor: (id: number, color: string | null) => invoke<void>("set_tag_color", { id, color }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
