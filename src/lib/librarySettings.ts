// Settings stored in the library itself (library.db `settings`, see
// docs/SETTINGS.md): the kinds it is used for, the mode it was left in and
// the sidebar entries hidden in each mode. They travel with the library.
// The sidebar can instead follow the app's (settings.json `sidebarHidden`).
import { KINDS, type ItemKind } from "./api";
import { MODES, modesFor, type Mode } from "./modes";

export interface LibrarySettings {
  /** Kinds the library is used for, in the order of `KINDS`; never empty. */
  modes: ItemKind[];
  /** The mode the library was last left in. */
  lastMode: Mode | null;
  /**
   * The kind filter it was left in, from versions with an image / file mode
   * (`lastMode` "image" opens "すべて" narrowed to images). Read, never saved.
   */
  lastKinds: ItemKind[];
  /** Sidebar entries hidden, per mode; used when `sidebarOwn`. */
  hidden: SidebarHidden;
  /** The library has its own sidebar entries; otherwise it follows the app's. */
  sidebarOwn: boolean;
}

/** Sidebar entries hidden, per mode (ids of `SIDEBAR_ENTRIES`). */
export type SidebarHidden = Partial<Record<Mode, string[]>>;

const ALL_KINDS = KINDS.map((k) => k.kind);

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = { modes: ALL_KINDS, lastMode: null, lastKinds: [], hidden: {}, sidebarOwn: false };

/** Sidebar entries that can be hidden. "すべて" and "ゴミ箱" always stay. */
export const SIDEBAR_ENTRIES: { id: string; label: string; modes?: Mode[] }[] = [
  { id: "unfiled", label: "未分類" },
  { id: "untagged", label: "タグなし" },
  { id: "favorites", label: "お気に入り" },
  { id: "pinned", label: "ピン留め" },
  { id: "tray", label: "作業台" },
  { id: "similar", label: "重複の候補", modes: ["all"] },
  { id: "section:fontFilters", label: "言語・書体・太さ・特徴", modes: ["font"] },
  { id: "section:folders", label: "フォルダ" },
  { id: "section:smart", label: "スマートフォルダ" },
  { id: "section:tags", label: "タグ" },
];

export const sidebarEntriesOf = (mode: Mode) => SIDEBAR_ENTRIES.filter((e) => !e.modes || e.modes.includes(mode));

const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);
/** The image and file modes of earlier versions, now "すべて" narrowed to the kind. */
const isOldMode = (v: unknown): v is "image" | "file" => v === "image" || v === "file";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Reads the stored JSON, skipping keys, kinds and entries this version doesn't know. */
export function parseLibrarySettings(raw: Record<string, unknown>): LibrarySettings {
  const listed = strings(raw.modes);
  const modes = ALL_KINDS.filter((k) => listed.includes(k));
  const known = new Set(SIDEBAR_ENTRIES.map((e) => e.id));
  const ids = (key: string) => strings(raw[key]).filter((id) => known.has(id));
  const hidden: LibrarySettings["hidden"] = {};
  for (const k of MODES) {
    // "すべて" takes over the image / file mode's (the one left in first) until saved anew.
    const keys =
      k === "all"
        ? ["hidden:all", ...(isOldMode(raw.lastMode) ? [`hidden:${raw.lastMode}`] : []), "hidden:image", "hidden:file"]
        : [`hidden:${k}`];
    const from = keys.find((key) => raw[key] !== undefined);
    const list = from ? ids(from) : [];
    if (list.length) hidden[k] = list;
  }
  // Libraries that hid something before the app's sidebar existed keep it as their own.
  const sidebarOwn = raw.sidebar === "own" || (raw.sidebar === undefined && Object.keys(hidden).length > 0);
  return {
    modes: modes.length ? modes : ALL_KINDS,
    lastMode: isMode(raw.lastMode) ? raw.lastMode : isOldMode(raw.lastMode) ? "all" : null,
    lastKinds: isOldMode(raw.lastMode) ? [raw.lastMode] : [],
    hidden,
    sidebarOwn,
  };
}

/** The app's sidebar entries (settings.json), skipping modes and entries this version doesn't know. */
export function parseSidebarHidden(raw: unknown): SidebarHidden {
  const known = new Set(SIDEBAR_ENTRIES.map((e) => e.id));
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hidden: SidebarHidden = {};
  for (const m of MODES) {
    const list = strings(obj[m]).filter((id) => known.has(id));
    if (list.length) hidden[m] = list;
  }
  return hidden;
}

/**
 * The mode a library opens in: the one it was left in, else the fonts when
 * they are what it has the most of, else "すべて".
 */
export function openingMode(s: LibrarySettings, kinds: Partial<Record<ItemKind, number>>): Mode {
  const shown = modesFor(s.modes);
  if (s.lastMode && shown.includes(s.lastMode)) return s.lastMode;
  if (!shown.includes("font")) return shown[0];
  let best = s.modes[0];
  for (const m of s.modes) if ((kinds[m] ?? 0) > (kinds[best] ?? 0)) best = m;
  return best === "font" ? "font" : shown[0];
}
