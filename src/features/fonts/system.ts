// The fonts installed on this computer (docs/SYSTEM_FONTS.md): the font
// mode's "この端末のフォント", a read-only list that is not in the library.
// Rust reads the font folders (src-tauri/src/fonts/system.rs); the list is
// filtered, searched and sorted here instead of in SQL (db.rs `query_where`),
// with the same meaning for the conditions the font mode offers.
import { type Facets, type Item, type ItemQuery } from "../../lib/api";
import { useStore } from "../../store";
import { fontApi, type SystemFont } from "./api";

let listed: Promise<SystemFont[]> | null = null;

/** The installed fonts, read once per run (or again with `reload`). */
export function systemFonts(reload = false): Promise<SystemFont[]> {
  if (!listed || reload) {
    const p = fontApi.systemFonts(reload);
    p.catch(() => {
      if (listed === p) listed = null;
    });
    listed = p;
  }
  return listed;
}

/** Weight ranges as numbers (db.rs `FONT_WEIGHTS`; labels are lib/api.ts `FONT_WEIGHTS`). */
const WEIGHT_RANGES: Record<string, [number, number]> = {
  light: [1, 399],
  regular: [400, 549],
  bold: [550, 749],
  black: [750, 9999],
};

/** An installed font as a list row. Nothing about it can be changed: no rating, tags, folder… */
export function systemItem(f: SystemFont): Item {
  return {
    id: f.id,
    kind: "font",
    name: f.name,
    fileName: f.fileName,
    ext: f.ext,
    width: 0,
    height: 0,
    size: f.size,
    thumb: "",
    note: "",
    rating: 0,
    importedAt: f.modified,
    deletedAt: null,
    preview: null,
    favorite: false,
    pinnedAt: null,
    rotation: 0,
    flipped: false,
    folderId: null,
    tagIds: [],
    sourceUrl: null,
    fontFamily: f.family,
    fontWeight: f.weight,
    fontScript: f.script,
    fontCategory: f.category,
    fontCategoryUser: null,
    fontFeatures: f.features,
    inTray: false,
    filePath: f.path,
    // No rendered sample: rows and tiles draw in the font itself.
    thumbPath: "",
    displayPath: f.path,
  };
}

const inWeight = (f: SystemFont, key: string) => {
  const r = WEIGHT_RANGES[key];
  return !!r && f.weightMin <= r[1] && f.weightMax >= r[0];
};

/**
 * Words of the search box: all must be in the name, family or file name;
 * "-word" must not; "two words" in quotes are one. (OR and parentheses of the
 * library's search are read as plain words.)
 */
function searchTerms(search: string): { has: string[]; not: string[] } {
  const has: string[] = [];
  const not: string[] = [];
  for (const m of search.toLowerCase().matchAll(/(-?)"([^"]*)"|(-?)(\S+)/g)) {
    const minus = m[1] || m[3];
    const word = m[2] ?? m[4];
    if (!word || (minus && word === "-")) continue;
    (minus ? not : has).push(word);
  }
  return { has, not };
}

type Condition = "search" | "fontScripts" | "fontCategories" | "fontWeights" | "fontFeatures" | "exts";

/** Whether `f` meets the query's conditions, `without` one of them (for that condition's counts). */
function matches(f: SystemFont, q: ItemQuery, without?: Condition): boolean {
  const c = q.filter;
  const on = (k: Condition) => k !== without;
  if (on("search")) {
    const { has, not } = searchTerms(q.search);
    const text = `${f.name}\n${f.family}\n${f.fileName}`.toLowerCase();
    if (!has.every((w) => text.includes(w)) || not.some((w) => text.includes(w))) return false;
  }
  if (on("fontScripts") && c.fontScripts.length && !c.fontScripts.includes(f.script)) return false;
  if (on("fontCategories") && c.fontCategories.length && !c.fontCategories.includes(f.category ?? "none")) return false;
  if (on("fontWeights") && c.fontWeights.length && !c.fontWeights.some((k) => inWeight(f, k))) return false;
  if (on("fontFeatures") && c.fontFeatures.length && !c.fontFeatures.some((k) => f.features.includes(k))) return false;
  if (on("exts") && c.exts.length && !c.exts.includes(f.ext)) return false;
  return true;
}

const byName = (a: SystemFont, b: SystemFont) => a.name.localeCompare(b.name, "ja");

/** Orders of the toolbar's sort that installed fonts have; the rest (rating, manual) go by name. */
function sorter(q: ItemQuery): (a: SystemFont, b: SystemFont) => number {
  const dir = q.desc ? -1 : 1;
  switch (q.sort) {
    case "importedAt":
      return (a, b) => dir * (a.modified - b.modified) || byName(a, b);
    case "size":
      return (a, b) => dir * (a.size - b.size) || byName(a, b);
    case "name":
      return (a, b) => dir * byName(a, b);
    default:
      return byName;
  }
}

/** The installed fonts meeting `q` (its view, rating and tags don't apply), sorted as asked. */
export async function querySystemFonts(q: ItemQuery): Promise<Item[]> {
  const all = await systemFonts();
  return all
    .filter((f) => matches(f, q))
    .sort(sorter(q))
    .map(systemItem);
}

/** The filter row's counts for the installed fonts (db.rs `facet_counts`), each condition left out of its own. */
export async function systemFacetCounts(q: ItemQuery): Promise<Facets> {
  const all = await systemFonts();
  const count = (without: Condition, keys: (f: SystemFont) => string[]) => {
    const out: Record<string, number> = {};
    for (const f of all) {
      if (!matches(f, q, without)) continue;
      for (const k of keys(f)) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const exts = count("exts", (f) => [f.ext]);
  return {
    ratings: {},
    tags: {},
    kinds: {},
    exts: Object.entries(exts).sort((a, b) => b[1] - a[1]),
    shapes: {},
    fontScripts: count("fontScripts", (f) => [f.script]),
    fontCategories: count("fontCategories", (f) => [f.category ?? "none"]),
    fontWeights: count("fontWeights", (f) => Object.keys(WEIGHT_RANGES).filter((k) => inWeight(f, k))),
    fontFeatures: count("fontFeatures", (f) => f.features),
  };
}

/** Reads the font folders again (fonts installed or removed since) and shows the result. */
export async function reloadSystemFonts(): Promise<void> {
  const s = useStore.getState();
  try {
    await systemFonts(true);
  } catch (e) {
    s.toast(String(e), true);
    return;
  }
  await s.refresh();
}
