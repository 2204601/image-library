/**
 * The keyboard shortcuts and mouse gestures, for the shortcut list (⌘/).
 * The handlers themselves are in Grid.tsx / Viewer.tsx and the dialogs; keep
 * this in step with them. (See docs/MENUS.md: this becomes the seed of a
 * single command table that the menus and the handlers also use.)
 *
 * A combo is written like "Mod+Shift+R": Mod is ⌘ on macOS and Ctrl elsewhere.
 * "Click", "Drag", "Wheel" and "Pinch" are mouse gestures, "0-5" and "Arrows"
 * key ranges, "=" the ⌘+ key.
 */
import { KINDS, type ItemKind } from "./api";
import type { Layout } from "../store";

export type ShortcutRow = {
  label: string;
  /** Alternatives, any of which does it. */
  keys: string[];
  /** Kinds it works for (all when absent). */
  kinds?: ItemKind[];
  /** A different label in some layouts. */
  labelIn?: Partial<Record<Layout, string>>;
};

export type ShortcutSection = { id: string; title: string; rows: ShortcutRow[] };

const modes: ShortcutRow = {
  label: KINDS.map((k) => k.label).join(" / "),
  keys: KINDS.map((_, i) => `Mod+${i + 1}`),
};

export const SHORTCUTS: ShortcutSection[] = [
  {
    id: "general",
    title: "全体",
    rows: [
      modes,
      { label: "サイドバーの表示・非表示", keys: ["Tab", "Mod+Alt+1"] },
      { label: "詳細パネルの表示・非表示", keys: ["Mod+I", "Mod+Alt+2"] },
      { label: "検索", keys: ["Mod+F"] },
      { label: "絞り込み", keys: ["Mod+Shift+F"] },
      { label: "フォルダを開く（名前で探す）", keys: ["Mod+J"] },
      {
        label: "サムネイルを大きく / 小さく",
        labelIn: { specimen: "見本の文字を大きく / 小さく" },
        keys: ["Mod+=", "Mod+-"],
      },
      { label: "ショートカット一覧", keys: ["Mod+/", "?"] },
    ],
  },
  {
    id: "list",
    title: "一覧の移動と選択",
    rows: [
      { label: "移動", keys: ["Arrows", "A", "D"] },
      { label: "範囲を選択", keys: ["Shift+Arrows", "Shift+Click"] },
      { label: "選択に追加・外す", keys: ["Mod+Click"] },
      { label: "囲んで選択（背景からドラッグ）", keys: ["Drag", "Shift+Drag"] },
      { label: "すべてを選択", keys: ["Mod+A"] },
      { label: "選択を解除", keys: ["Esc"] },
      { label: "表示（ビューアで開く）", keys: ["Space", "Enter"] },
    ],
  },
  {
    id: "item",
    title: "選択した項目",
    rows: [
      { label: "お気に入り", keys: ["F"] },
      { label: "ピン留め", keys: ["P"] },
      { label: "作業台に追加・外す", keys: ["B"] },
      { label: "評価", keys: ["0-5"] },
      { label: "評価して次へ", keys: ["Shift+0-5"] },
      { label: "左に回転 / 右に回転", keys: ["Mod+Shift+L", "Mod+Shift+R"], kinds: ["image"] },
      { label: "名前を変更", keys: ["F2", "Mod+R"] },
      { label: "コピー", keys: ["Mod+C"] },
      { label: "タグをコピー / 貼り付け", keys: ["Mod+Shift+C", "Mod+Shift+V"] },
      { label: "ゴミ箱へ移動", keys: ["Mod+Backspace", "Delete"] },
    ],
  },
  {
    id: "organize",
    title: "整理",
    rows: [
      { label: "フォルダへ移動…", keys: ["Mod+Shift+J"] },
      { label: "最後に使ったフォルダへ移動", keys: ["Shift+D"] },
      { label: "フォルダへ入れる", keys: ["Drag"] },
      { label: "新しいフォルダ", keys: ["Mod+Shift+N"] },
      { label: "新しいスマートフォルダ", keys: ["Mod+Shift+Alt+N"] },
      { label: "フォルダを上へ / 下へ", keys: ["Mod+[", "Mod+]"] },
      { label: "フォルダを先頭へ / 末尾へ", keys: ["Mod+Shift+[", "Mod+Shift+]"] },
    ],
  },
  {
    id: "viewer",
    title: "ビューア",
    rows: [
      { label: "前 / 次", keys: ["Arrows", "A", "D"] },
      { label: "最初 / 最後", keys: ["Home", "End"] },
      { label: "閉じる", keys: ["Esc", "Space", "Enter"] },
      { label: "全体表示 ⇔ 実寸", keys: ["Z"], kinds: ["image"] },
      { label: "拡大 / 縮小", keys: ["Mod+=", "Mod+-", "Alt+Wheel", "Pinch"], kinds: ["image"] },
      { label: "実寸 / 全体を表示", keys: ["Mod+0", "Mod+9"], kinds: ["image"] },
      { label: "詳細", keys: ["I"] },
      { label: "前後のサムネイル", keys: ["T"] },
      { label: "お気に入り・ピン留め・作業台・評価", keys: ["F", "P", "B", "0-5"] },
      { label: "左に回転 / 右に回転", keys: ["Mod+Shift+L", "Mod+Shift+R"], kinds: ["image"] },
    ],
  },
  {
    id: "dialog",
    title: "ダイアログ・入力",
    rows: [
      { label: "閉じる・入力をやめる", keys: ["Esc"] },
      { label: "候補を選ぶ / 決定（フォルダ選び・タグ）", keys: ["↑", "↓", "Enter"] },
    ],
  },
];

// ------------------------------------------------------------ display

export const isMac = navigator.userAgent.includes("Mac");

const MOUSE: Record<string, string> = { Click: "クリック", Drag: "ドラッグ", Wheel: "ホイール", Pinch: "ピンチ" };

const MAC: Record<string, string> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Backspace: "⌫",
  // "↩" is drawn as an emoji.
  Enter: "Return",
};
const OTHER: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift" };

/** A key or gesture as shown: `cap` is drawn as a key, otherwise as text. */
export type KeyPart = { text: string; cap: boolean };

export function keyParts(combo: string): KeyPart[] {
  return combo.split("+").map((p) => {
    if (MOUSE[p]) return { text: MOUSE[p], cap: false };
    if (p === "0-5") return { text: "0〜5", cap: true };
    if (p === "Arrows") return { text: "← → ↑ ↓", cap: true };
    if (p === "=") return { text: "+", cap: true };
    return { text: (isMac ? MAC : OTHER)[p] ?? p, cap: true };
  });
}

/** "⌘⇧R" / "Ctrl+Shift+R": how a combo reads, for searching. */
const comboText = (combo: string) =>
  keyParts(combo)
    .map((p) => p.text)
    .join(isMac ? "" : "+");

const norm = (s: string) => s.toLowerCase().replace(/[\s+＋]/g, "");

/** Rows matching the query by name, or by key ("⌘R", "ctrl+r", "F"). */
export function matchRow(row: ShortcutRow, label: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  if (norm(label).includes(q)) return true;
  return row.keys.some((k) => {
    const shown = norm(comboText(k));
    const last = norm(keyParts(k).at(-1)?.text ?? "");
    return shown === q || last === q || norm(k) === q;
  });
}
