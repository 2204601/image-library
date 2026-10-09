/**
 * Every operation of the app, defined once (docs/MENUS.md §1). The menu bar,
 * the right-click menus, the list's keyboard handling and the shortcut list
 * (?) are all made from this table, so a name and its key read the same
 * everywhere.
 *
 * Keys are written like "Mod+Shift+R": Mod is ⌘ on macOS and Ctrl elsewhere.
 * The first key is the one menus show.
 */
import {
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  FolderInput,
  Heart,
  Layers,
  Pin,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import {
  copySelection,
  copyTags,
  createFolder,
  createFolderHere,
  createLibraryDialog,
  createSmartFolder,
  deleteSelection,
  exportList,
  moveToLastFolder,
  openLibraryDialog,
  openSelection,
  orient,
  pasteTags,
  selectionOrShown,
  setRating,
  sheetList,
  shiftFolder,
  toggleFavorite,
  togglePinned,
  toggleTray,
  transferAllOfMode,
  transferList,
  trayList,
} from "./actions";
import { api, kindLabel, KINDS, type Item, type ItemKind } from "./api";
import { checkForUpdate } from "./update";
import { currentFolderId, MODES, usedModes, useStore } from "../store";
import { useShortcutHelp } from "../components/ShortcutHelp";

type S = ReturnType<typeof useStore.getState>;

export interface Command {
  id: string;
  /** Name in the shortcut list and the default label. */
  title: string;
  /** The label for the current state ("お気に入りに追加" / "お気に入りから外す"). */
  label?: (s: S) => string;
  icon?: LucideIcon;
  keys?: string[];
  /** Modes it applies to (all when absent): rotating is for images only. */
  kinds?: ItemKind[];
  enabled?: (s: S) => boolean;
  checked?: (s: S) => boolean;
  run: (s: S) => void;
  /**
   * Who handles the key: "grid" (the list's key handler, the default),
   * "global" (its own handler, e.g. ⌘, and ?) or
   * "menu" (only the menu bar's accelerator).
   */
  keyBy?: "grid" | "global" | "menu";
}

const sel = (s: S) => [...s.selected];
const any = (s: S) => s.selected.size > 0;
const notTrash = (s: S) => s.view.kind !== "trash";
const live = (s: S) => any(s) && notTrash(s);
const selItems = (s: S): Item[] => {
  const byId = new Map(s.rawItems.map((i) => [i.id, i]));
  return sel(s).flatMap((id) => byId.get(id) ?? []);
};
const allHave = (s: S, f: (i: Item) => boolean) => {
  const xs = selItems(s);
  return xs.length > 0 && xs.every(f);
};
const lastFolder = (s: S) => s.folders.find((f) => f.id === s.recentFolders[0]);

export const COMMANDS: Command[] = [
  // ---------------------------------------------------------------- app
  {
    id: "app.settings",
    title: "設定…",
    keys: ["Mod+,"],
    keyBy: "global",
    run: (s) => s.openSettings("general"),
  },
  { id: "app.checkUpdate", title: "アップデートを確認…", run: () => checkForUpdate(true) },
  {
    id: "help.shortcuts",
    title: "キーボードショートカット",
    keys: ["?"],
    keyBy: "global",
    run: () => useShortcutHelp.getState().setOpen(true),
  },
  { id: "help.webImport", title: "ブラウザ拡張と連携…", run: (s) => s.openSettings("integration") },
  { id: "help.claude", title: "Claude と連携…", run: (s) => s.openSettings("integration", "settings-claude") },

  // ------------------------------------------------------------ library
  { id: "library.new", title: "新しいライブラリ…", run: () => void createLibraryDialog() },
  { id: "library.open", title: "ライブラリを開く…", run: () => void openLibraryDialog() },
  {
    id: "library.transferAll",
    title: "すべてを別のライブラリへ…",
    label: (s) => `${kindLabel(s.mode)}をすべて別のライブラリへ…`,
    enabled: (s) => (s.counts.kinds[s.mode] ?? 0) > 0,
    run: () => transferAllOfMode(),
  },

  // -------------------------------------------------------------- modes
  ...MODES.map(
    (m, i): Command => ({
      id: `mode.${m}`,
      title: KINDS.find((k) => k.kind === m)?.label ?? m,
      keys: [`Mod+${i + 1}`],
      // A kind the library isn't used for does nothing (the keys stay fixed).
      enabled: (s) => usedModes(s).includes(m),
      checked: (s) => s.mode === m,
      run: (s) => s.setMode(m),
    }),
  ),

  // --------------------------------------------------------------- view
  {
    id: "view.sidebar",
    title: "サイドバー",
    keys: ["Tab", "Mod+Alt+1"],
    checked: (s) => s.sidebarOpen,
    run: (s) => s.toggleSidebar(),
  },
  {
    id: "view.inspector",
    title: "詳細パネル",
    keys: ["Mod+I", "Mod+Alt+2"],
    checked: (s) => s.inspectorOpen,
    run: (s) => s.toggleInspector(),
  },
  {
    id: "view.zoomIn",
    title: "拡大",
    label: (s) => (s.layout === "specimen" ? "文字を大きく" : "拡大"),
    keys: ["Mod+="],
    run: (s) =>
      s.layout === "specimen" ? s.setSpecimenSize(s.specimenSize + 8) : s.setThumbSize(Math.min(360, s.thumbSize + 20)),
  },
  {
    id: "view.zoomOut",
    title: "縮小",
    label: (s) => (s.layout === "specimen" ? "文字を小さく" : "縮小"),
    keys: ["Mod+-"],
    run: (s) =>
      s.layout === "specimen" ? s.setSpecimenSize(s.specimenSize - 8) : s.setThumbSize(Math.max(80, s.thumbSize - 20)),
  },
  {
    id: "view.subfolders",
    title: "サブフォルダの内容を表示",
    checked: (s) => s.showSubfolders,
    run: (s) => s.setShowSubfolders(!s.showSubfolders),
  },
  { id: "go.folder", title: "フォルダへ…", keys: ["Mod+J"], run: (s) => s.setPicker("goto") },

  // --------------------------------------------------------------- edit
  {
    id: "edit.search",
    title: "検索",
    keys: ["Mod+F"],
    run: () => document.getElementById("search")?.focus(),
  },
  { id: "edit.filter", title: "絞り込み", keys: ["Mod+Shift+F"], checked: (s) => s.filterOpen, run: (s) => s.toggleFilterOpen() },
  {
    id: "edit.selectAll",
    title: "すべてを選択",
    keys: ["Mod+A"],
    run: (s) => s.setSelection(s.items.map((i) => i.id)),
  },
  { id: "edit.deselect", title: "選択を解除", keys: ["Esc"], enabled: any, run: (s) => s.setSelection([]) },
  {
    id: "item.copy",
    title: "コピー",
    icon: Copy,
    keys: ["Mod+C"],
    enabled: any,
    run: (s) => void copySelection(sel(s)),
  },
  {
    id: "item.copyTags",
    title: "タグをコピー",
    keys: ["Mod+Shift+C"],
    enabled: any,
    run: (s) => void copyTags(sel(s)),
  },
  {
    id: "item.pasteTags",
    title: "タグを貼り付け",
    keys: ["Mod+Shift+V"],
    enabled: live,
    run: (s) => void pasteTags(sel(s)),
  },
  {
    id: "item.rename",
    title: "名前を変更",
    keys: ["F2", "Mod+R"],
    // Nothing selected in a folder: the folder's own name.
    enabled: (s) => s.selected.size === 1 || (s.selected.size === 0 && s.view.kind === "folder"),
    run: (s) => {
      if (s.selected.size === 1) s.requestItemRename();
      else if (s.view.kind === "folder") s.setRenamingFolder(s.view.id);
    },
  },
  {
    id: "item.trash",
    title: "ゴミ箱へ移動",
    label: (s) => (s.view.kind === "trash" ? "完全に削除" : "ゴミ箱へ移動"),
    icon: Trash2,
    keys: ["Mod+Backspace", "Delete"],
    enabled: any,
    run: (s) => void deleteSelection(sel(s)),
  },

  // --------------------------------------------------------------- item
  {
    id: "item.show",
    title: "表示",
    keys: ["Space", "Enter"],
    // The list opens the focused item itself (Grid.tsx); this is for menus.
    keyBy: "menu",
    enabled: any,
    run: (s) => {
      const i = s.items.findIndex((x) => x.id === (s.focus && s.selected.has(s.focus) ? s.focus : sel(s)[0]));
      if (i >= 0) s.openViewer(i);
    },
  },
  { id: "item.open", title: "既定のアプリで開く", enabled: any, run: (s) => void openSelection(sel(s)) },
  {
    id: "item.reveal",
    title: "Finder / エクスプローラで表示",
    enabled: (s) => s.selected.size === 1,
    run: (s) => void s.run(() => api.revealItem(sel(s)[0])),
  },
  {
    id: "item.favorite",
    title: "お気に入り",
    label: (s) => (allHave(s, (i) => i.favorite) ? "お気に入りから外す" : "お気に入りに追加"),
    icon: Heart,
    keys: ["F"],
    enabled: live,
    checked: (s) => allHave(s, (i) => i.favorite),
    run: (s) => void toggleFavorite(sel(s)),
  },
  {
    id: "item.pin",
    title: "ピン留め",
    label: (s) => (allHave(s, (i) => i.pinnedAt !== null) ? "ピン留めを解除" : "ピン留め"),
    icon: Pin,
    keys: ["P"],
    enabled: live,
    checked: (s) => allHave(s, (i) => i.pinnedAt !== null),
    run: (s) => void togglePinned(sel(s)),
  },
  {
    id: "item.tray",
    title: "作業台",
    label: (s) => (allHave(s, (i) => i.inTray) ? "作業台から外す" : "作業台に追加"),
    icon: Layers,
    keys: ["B"],
    enabled: live,
    checked: (s) => allHave(s, (i) => i.inTray),
    run: (s) => void toggleTray(sel(s)),
  },
  ...[0, 1, 2, 3, 4, 5].map(
    (n): Command => ({
      id: `item.rate${n}`,
      title: n ? "★".repeat(n) : "評価なし",
      // The list handles the digits itself (Shift+digit also moves on).
      keys: [String(n)],
      keyBy: "menu",
      enabled: live,
      checked: (s) => allHave(s, (i) => i.rating === n),
      run: (s) => void setRating(sel(s), n),
    }),
  ),
  {
    id: "item.rotateCcw",
    title: "左に回転",
    icon: RotateCcw,
    keys: ["Mod+Shift+L"],
    kinds: ["image"],
    enabled: live,
    run: (s) => void orient(sel(s), "rotateCcw"),
  },
  {
    id: "item.rotateCw",
    title: "右に回転",
    icon: RotateCw,
    keys: ["Mod+Shift+R"],
    kinds: ["image"],
    enabled: live,
    run: (s) => void orient(sel(s), "rotateCw"),
  },
  {
    id: "item.flipH",
    title: "左右反転",
    icon: FlipHorizontal2,
    kinds: ["image"],
    enabled: live,
    run: (s) => void orient(sel(s), "flipH"),
  },
  {
    id: "item.flipV",
    title: "上下反転",
    icon: FlipVertical2,
    kinds: ["image"],
    enabled: live,
    run: (s) => void orient(sel(s), "flipV"),
  },
  {
    id: "item.resetOrientation",
    title: "元の向きに戻す",
    icon: Undo2,
    kinds: ["image"],
    enabled: (s) => live(s) && !allHave(s, (i) => i.rotation === 0 && !i.flipped),
    run: (s) => void orient(sel(s), "reset"),
  },

  // ---------------------------------------------------- taking things out
  {
    id: "list.export",
    title: "書き出し…",
    keys: ["Mod+E"],
    run: () => exportList(selectionOrShown()),
  },
  { id: "list.sheet", title: "まとめて出力…", run: () => void sheetList(selectionOrShown()) },
  {
    id: "list.transfer",
    title: "別のライブラリへ…",
    icon: FolderInput,
    run: () => void transferList(selectionOrShown()),
  },
  { id: "list.tray", title: "作業台にすべて追加", run: () => void trayList({ kind: "shown" }) },

  // -------------------------------------------------------------- organize
  {
    id: "item.moveTo",
    title: "フォルダへ移動…",
    keys: ["Mod+Shift+J"],
    enabled: live,
    run: (s) => s.setPicker("move"),
  },
  {
    id: "item.moveToLast",
    title: "最後に使ったフォルダへ移動",
    label: (s) => (lastFolder(s) ? `「${lastFolder(s)!.name}」へ移動` : "最後に使ったフォルダへ移動"),
    keys: ["Shift+D"],
    enabled: live,
    run: (s) => void moveToLastFolder(sel(s)),
  },
  {
    id: "item.newFolder",
    title: "選択から新しいフォルダ",
    enabled: live,
    run: (s) => void createFolder(null, sel(s)),
  },
  {
    id: "item.unfile",
    title: "未分類に戻す",
    enabled: (s) => any(s) && s.view.kind === "folder",
    run: (s) => {
      const folder = currentFolderId();
      if (folder) void s.run(() => api.removeFromFolder(sel(s), folder));
    },
  },
  { id: "folder.new", title: "新しいフォルダ", keys: ["Mod+Shift+N"], run: () => void createFolderHere() },
  {
    id: "smart.new",
    title: "新しいスマートフォルダ",
    keys: ["Mod+Shift+Alt+N"],
    run: () => void createSmartFolder(),
  },
  ...(
    [
      ["folder.up", "フォルダを上へ", "Mod+[", -1, false],
      ["folder.down", "フォルダを下へ", "Mod+]", 1, false],
      ["folder.top", "フォルダを先頭へ", "Mod+Shift+[", -1, true],
      ["folder.bottom", "フォルダを末尾へ", "Mod+Shift+]", 1, true],
    ] as const
  ).map(
    ([id, title, key, by, toEnd]): Command => ({
      id,
      title,
      keys: [key],
      enabled: (s) => s.view.kind === "folder",
      run: (s) => s.view.kind === "folder" && void shiftFolder(s.view.id, by, toEnd),
    }),
  ),
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function command(id: string): Command {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown command ${id}`);
  return c;
}

/** Whether a command applies in the current mode at all (rotate: images only). */
export const appliesTo = (c: Command, s: S) => !c.kinds || c.kinds.includes(s.mode);

export const isEnabled = (c: Command, s: S) => appliesTo(c, s) && (c.enabled?.(s) ?? true);

export const labelOf = (c: Command, s: S) => c.label?.(s) ?? c.title;

/**
 * The last command run and from where. A key can reach both the menu bar's
 * accelerator and the list's handler (which one depends on the platform),
 * so the second of the two within a moment is dropped.
 */
let lastRun = { id: "", by: "", at: 0 };

function runFrom(c: Command, s: S, by: "key" | "menu") {
  const now = performance.now();
  if (lastRun.id === c.id && lastRun.by !== by && now - lastRun.at < 250) return;
  lastRun = { id: c.id, by, at: now };
  c.run(s);
}

/** Runs a command by id if it is enabled now (menu bar items). */
export function runCommand(id: string) {
  const c = command(id);
  const s = useStore.getState();
  if (isEnabled(c, s)) runFrom(c, s, "menu");
}

// ---------------------------------------------------------------- keys

/** The key part of a combo matched against an event (layout-independent where it can be). */
function keyMatches(key: string, e: KeyboardEvent): boolean {
  if (/^[A-Z]$/.test(key)) return e.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}`;
  switch (key) {
    case "[":
      return e.code === "BracketLeft";
    case "]":
      return e.code === "BracketRight";
    // ⌘+: "=" on US keyboards (with or without Shift), ";" on JIS.
    case "=":
      return e.key === "=" || e.key === "+" || e.key === ";";
    case "-":
      return e.key === "-";
    case "/":
      return e.code === "Slash";
    case "Esc":
      return e.key === "Escape";
    case "Space":
      return e.key === " ";
    default:
      return e.key === key;
  }
}

/** Whether `e` is exactly `combo` (no extra modifiers; Shift is free for "="). */
export function comboMatches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.split("+");
  // "Mod+=" splits into ["Mod", "="]; a bare "+" never appears.
  const key = parts.pop()!;
  const mods = new Set(parts);
  if ((e.metaKey || e.ctrlKey) !== mods.has("Mod")) return false;
  if (e.altKey !== mods.has("Alt")) return false;
  if (key !== "=" && e.shiftKey !== mods.has("Shift")) return false;
  return keyMatches(key, e);
}

/**
 * The list's key handler: runs the command bound to `e`, if any is enabled.
 * Returns whether it took the key.
 */
export function runKey(e: KeyboardEvent): boolean {
  const s = useStore.getState();
  for (const c of COMMANDS) {
    if ((c.keyBy ?? "grid") !== "grid" || !c.keys?.some((k) => comboMatches(k, e))) continue;
    if (!appliesTo(c, s)) continue;
    e.preventDefault();
    if (c.enabled?.(s) ?? true) runFrom(c, s, "key");
    return true;
  }
  return false;
}
