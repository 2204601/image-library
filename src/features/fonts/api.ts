// Font-only commands (src-tauri/src/fonts/commands.rs). The shared item
// commands and the vocabulary stored in the DB (FONT_SCRIPTS, FONT_CATEGORIES)
// stay in lib/api.ts.
import { invoke } from "@tauri-apps/api/core";

export interface FontAxis {
  /** e.g. "wght" (weight), "wdth" (width), "ital". */
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
}

export interface FontFaceInfo {
  family: string;
  style: string;
  fullName: string;
  weight: number;
  italic: boolean;
  glyphs: number;
  /** Characters the font has (not counting spaces). */
  charCount: number;
  version: string;
  /** Designer, else the foundry. */
  designer: string;
  /** Variation axes; empty unless it is a variable font. */
  axes: FontAxis[];
  /** Named styles of a variable font ("Thin", "Bold", ...). */
  instances: string[];
}

/** What the list layout shows for a font. */
export interface FontListPreview {
  /** A sample line the font fully covers (or the characters it has). */
  sample: string;
  /** Style of the first font in the file, e.g. "Bold", "W3". */
  style: string;
  /** Fonts in the file (several for TTC / OTC). */
  faces: number;
}

export interface FontInfo {
  /** Every font in the file (several for TTC / OTC). */
  faces: FontFaceInfo[];
  /** Every character of the requested font (code points), in order. */
  chars: number[];
}

export const fontApi = {
  /** Names of every font in the file and the characters of font `face`. */
  info: (id: string, face: number) => invoke<FontInfo>("font_info", { id, face }),
  /** Names and details of every font in the file, without the characters. */
  faces: (id: string) => invoke<FontFaceInfo[]>("font_faces", { id }),
  /** One font of the file as plain OpenType data, for `new FontFace()`. */
  data: (id: string, face: number) => invoke<ArrayBuffer>("font_data", { id, face }),
  listPreview: (id: string) => invoke<FontListPreview>("font_list_preview", { id }),
  /** Sets fonts' typeface style by hand; null = back to the guess. */
  setCategory: (ids: string[], category: string | null) =>
    invoke<number>("set_font_category", { ids, category }),
  /** Reads the family of fonts imported before it was stored; returns how many. */
  index: () => invoke<number>("index_fonts"),
};
