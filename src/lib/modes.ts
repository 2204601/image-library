// What the app shows: every kind together ("すべて"), or the fonts on their
// own (they are compared, not browsed). Images and files are narrowed with
// the kind filter inside "すべて". See docs/ARCHITECTURE.md (モード).
import { KINDS, kindLabel, type ItemKind } from "./api";

export type Mode = "all" | "font";

/** Modes in menu order; ⌘1 / ⌘2 follow it. */
export const MODES: Mode[] = ["all", "font"];

export const modeLabel = (m: Mode) => (m === "all" ? "すべて" : kindLabel(m));

/** What items of these kinds are called in a sentence ("条件に一致する画像はありません"). */
export const kindsNoun = (kinds: ItemKind[]) => (kinds.length === 1 ? kindLabel(kinds[0]) : "アイテム");

/** What these items are called: their kind when they are of one ("画像"), else "アイテム". */
export const itemsNoun = (items: { kind: ItemKind }[]) => kindsNoun([...new Set(items.map((i) => i.kind))]);

/** The kind the mode is limited to; undefined = every kind. */
export const modeKind = (m: Mode): ItemKind | undefined => (m === "all" ? undefined : m);

/**
 * Modes to switch between given the kinds a library is used for: the fonts
 * get their own only next to another kind ("すべて" of fonts alone is the same list).
 */
export const modesFor = (used: ItemKind[]): Mode[] =>
  used.length === 1 && used[0] === "font" ? ["font"] : used.includes("font") ? ["all", "font"] : ["all"];

/** Kinds a mode lists, of those the library is used for (in `KINDS` order). */
export const kindsOfMode = (m: Mode, used: ItemKind[]): ItemKind[] =>
  m === "font" ? ["font"] : KINDS.map((k) => k.kind).filter((k) => used.includes(k));
