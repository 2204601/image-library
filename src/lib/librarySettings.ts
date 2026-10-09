// Settings stored in the library itself (library.db `settings`, see
// docs/SETTINGS.md): the kinds it is used for, the mode it was left in and
// the sidebar entries hidden in each mode. They travel with the library.
import { KINDS, type ItemKind } from "./api";
import { MODES, modesFor, type Mode } from "./modes";

export interface LibrarySettings {
  /** Kinds the library is used for, in the order of `KINDS`; never empty. */
  modes: ItemKind[];
  /** The mode the library was last left in. */
  lastMode: Mode | null;
  /** Sidebar entries hidden, per mode (ids of `SIDEBAR_ENTRIES`). */
  hidden: Partial<Record<Mode, string[]>>;
}

const ALL_KINDS = KINDS.map((k) => k.kind);

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = { modes: ALL_KINDS, lastMode: null, hidden: {} };

/** Sidebar entries that can be hidden. "すべて" and "ゴミ箱" always stay. */
export const SIDEBAR_ENTRIES: { id: string; label: string; modes?: Mode[] }[] = [
  { id: "unfiled", label: "未分類" },
  { id: "untagged", label: "タグなし" },
  { id: "favorites", label: "お気に入り" },
  { id: "pinned", label: "ピン留め" },
  { id: "tray", label: "作業台" },
  { id: "similar", label: "重複の候補", modes: ["image"] },
  { id: "section:fontFilters", label: "言語・書体", modes: ["font"] },
  { id: "section:folders", label: "フォルダ" },
  { id: "section:smart", label: "スマートフォルダ" },
  { id: "section:tags", label: "タグ" },
];

export const sidebarEntriesOf = (mode: Mode) => SIDEBAR_ENTRIES.filter((e) => !e.modes || e.modes.includes(mode));

const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Reads the stored JSON, skipping keys, kinds and entries this version doesn't know. */
export function parseLibrarySettings(raw: Record<string, unknown>): LibrarySettings {
  const listed = strings(raw.modes);
  const modes = ALL_KINDS.filter((k) => listed.includes(k));
  const known = new Set(SIDEBAR_ENTRIES.map((e) => e.id));
  const hidden: LibrarySettings["hidden"] = {};
  for (const k of MODES) {
    const ids = strings(raw[`hidden:${k}`]).filter((id) => known.has(id));
    if (ids.length) hidden[k] = ids;
  }
  return {
    modes: modes.length ? modes : ALL_KINDS,
    lastMode: isMode(raw.lastMode) ? raw.lastMode : null,
    hidden,
  };
}

/**
 * The mode a library opens in: the one it was left in, else the used kind it
 * has the most of, else the first used kind.
 */
export function openingMode(s: LibrarySettings, kinds: Partial<Record<ItemKind, number>>): Mode {
  if (s.lastMode && modesFor(s.modes).includes(s.lastMode)) return s.lastMode;
  let best = s.modes[0];
  for (const m of s.modes) if ((kinds[m] ?? 0) > (kinds[best] ?? 0)) best = m;
  return best;
}
