// What the app shows: every kind together ("すべて"), or one kind. See
// docs/ARCHITECTURE.md (モード).
import { kindLabel, type ItemKind } from "./api";

export type Mode = ItemKind | "all";

/** Modes in menu order; ⌘1〜⌘4 follow it. */
export const MODES: Mode[] = ["all", "image", "font", "file"];

export const modeLabel = (m: Mode) => (m === "all" ? "すべて" : kindLabel(m));

/** What the mode's items are called in a sentence ("条件に一致する画像はありません"). */
export const modeNoun = (m: Mode) => (m === "all" ? "アイテム" : kindLabel(m));

/** The kind the mode is limited to; undefined = every kind. */
export const modeKind = (m: Mode): ItemKind | undefined => (m === "all" ? undefined : m);

/** `filter.kinds` of the mode's list (empty = every kind). */
export const modeKinds = (m: Mode): ItemKind[] => (m === "all" ? [] : [m]);

/** Modes to switch between given the kinds a library is used for: "すべて" only with two or more. */
export const modesFor = (used: ItemKind[]): Mode[] => (used.length > 1 ? ["all", ...used] : used);
