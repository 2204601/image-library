// What the app shows: every kind together ("すべて"), or the fonts on their
// own (they are compared, not browsed). Images and files are narrowed with
// the kind filter inside "すべて". See docs/ARCHITECTURE.md (モード).
import { KINDS, kindLabel, type Filter, type ItemKind, type SmartFolder, type View } from "./api";

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

/** What decides the kinds a list holds (the store's state has it all). */
export type KindState = {
  mode: Mode;
  view: View;
  filter: Filter;
  smartFolders: SmartFolder[];
  librarySettings: { modes: ItemKind[] };
};

/** Kinds the open library is used for, in `KINDS` order. */
export const usedKinds = (s: Pick<KindState, "librarySettings">): ItemKind[] =>
  KINDS.map((k) => k.kind).filter((k) => s.librarySettings.modes.includes(k));

/** Kinds the query asks for: the mode's, narrowed by the kind filter. */
export function shownKinds(s: Pick<KindState, "mode" | "filter" | "librarySettings">): ItemKind[] {
  const base = kindsOfMode(s.mode, usedKinds(s));
  const picked = s.filter.kinds.filter((k) => base.includes(k));
  return picked.length ? picked : base;
}

/**
 * `filter.kinds` of the query: none when every kind is shown. The similar
 * view is of images whatever the kind filter (look-alikes are found by image hash).
 */
export const queryKinds = (s: Pick<KindState, "mode" | "view" | "filter" | "librarySettings">): ItemKind[] => {
  if (s.view.kind === "similar") return ["image"];
  const kinds = shownKinds(s);
  return kinds.length === KINDS.length ? [] : kinds;
};

/**
 * Kinds the list on screen can hold: those shown, narrowed further by an
 * open smart folder's rule and the similar view (images only). What applies
 * to one kind only (an image's shape and pixel size) is offered when this is
 * that kind alone; commands go by the selection too (`appliesTo`).
 */
export function listKinds(s: KindState): ItemKind[] {
  const v = s.view;
  if (v.kind === "similar") return ["image"];
  let kinds = shownKinds(s);
  const rule = v.kind === "smart" ? s.smartFolders.find((f) => f.id === v.id)?.rule.filter.kinds : undefined;
  if (rule?.length) kinds = kinds.filter((k) => rule.includes(k));
  return kinds;
}

/** Whether the list on screen holds only `kind`. */
export const listIs = (s: KindState, kind: ItemKind) => {
  const kinds = listKinds(s);
  return kinds.length === 1 && kinds[0] === kind;
};

/** What the list's items are called ("画像", or "アイテム" for several kinds). */
export const listNoun = (s: KindState) => kindsNoun(listKinds(s));

/** A rule's kinds for the kind filter: its own, else images when it has image-only conditions. */
export function ruleKinds(f: Partial<Filter>): ItemKind[] {
  if (f.kinds?.length) return f.kinds;
  const sized = !!f.shapes?.length || [f.minWidth, f.maxWidth, f.minHeight, f.maxHeight].some((v) => v != null);
  return sized ? ["image"] : [];
}
