// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

export interface LibraryInfo {
  root: string;
  name: string;
}

export interface Item {
  id: string;
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
  filePath: string;
  thumbPath: string;
  /** Similar view only: items with the same number look alike. Best copy first. */
  group?: number;
}

export type View =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "untagged" }
  | { kind: "trash" }
  | { kind: "similar" }
  | { kind: "folder"; id: string };

export type SortKey = "importedAt" | "name" | "size" | "dimensions" | "rating" | "manual";

export interface ItemQuery {
  view: View;
  search: string;
  tagIds: number[];
  /** true: items must carry every tag in `tagIds`; false: any one of them. */
  tagMatchAll: boolean;
  includeSubfolders: boolean;
  minRating: number;
  sort: SortKey;
  desc: boolean;
}

export interface Counts {
  all: number;
  unfiled: number;
  untagged: number;
  trash: number;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  count: number;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface SelectionInfo {
  tags: Tag[];
  folders: { id: string; count: number }[];
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  failed: string[];
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
  copyItems: (ids: string[]) => invoke<number>("copy_items", { ids }),
  exportItems: (ids: string[], dest: string) => invoke<number>("export_items", { ids, dest }),

  importPaths: (paths: string[], folderId: string | null) =>
    invoke<ImportSummary>("import_paths", { paths, folderId }),
  importBytes: (name: string, data: Uint8Array, folderId: string | null) =>
    invoke<ImportSummary>("import_bytes", data, {
      headers: { "x-name": encodeURIComponent(name), "x-folder": folderId ?? "" },
    }),
  supportedExts: () => invoke<string[]>("supported_exts"),
  indexSimilar: () => invoke<number>("index_similar"),
  /** Trashes `remove`, first copying their tags, folders and rating onto `keep`. */
  resolveDuplicates: (groups: { keep: string; remove: string[] }[]) =>
    invoke<void>("resolve_duplicates", { groups }),

  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (name: string, parentId: string | null) =>
    invoke<string>("create_folder", { name, parentId }),
  renameFolder: (id: string, name: string) => invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  moveFolder: (id: string, parentId: string | null) =>
    invoke<boolean>("move_folder", { id, parentId }),
  addToFolder: (ids: string[], folderId: string) => invoke<void>("add_to_folder", { ids, folderId }),
  reorderInFolder: (folderId: string, ids: string[], before: string | null) =>
    invoke<void>("reorder_in_folder", { folderId, ids, before }),
  removeFromFolder: (ids: string[], folderId: string) =>
    invoke<void>("remove_from_folder", { ids, folderId }),

  listTags: () => invoke<Tag[]>("list_tags"),
  addTags: (ids: string[], names: string[]) => invoke<void>("add_tags", { ids, names }),
  removeTag: (ids: string[], tagId: number) => invoke<void>("remove_tag", { ids, tagId }),
  renameTag: (id: number, name: string) => invoke<void>("rename_tag", { id, name }),
  deleteTag: (id: number) => invoke<void>("delete_tag", { id }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
