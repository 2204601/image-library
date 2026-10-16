// Text-only commands (src-tauri/src/texts/commands.rs). docs/TEXT.md
import { invoke } from "@tauri-apps/api/core";

export interface TextContent {
  text: string;
  /** "UTF-8", "Shift_JIS", … as read. */
  encoding: string;
  /** Larger than the editor takes: `text` is its start. */
  truncated: boolean;
  /** False when truncated, or its encoding couldn't be told (saving would lose bytes). */
  editable: boolean;
}

export interface SavedText {
  encoding: string;
  /** Didn't fit Shift_JIS and was saved as UTF-8 instead. */
  encodingChanged: boolean;
}

export const textsApi = {
  read: (id: string) => invoke<TextContent>("read_text", { id }),
  /** Writes the file in its own encoding and line endings; remakes size, hash, thumbnail and search text. */
  save: (id: string, text: string) => invoke<SavedText>("save_text", { id, text }),
  /** A new text named `name` (with .md / .txt / .csv …), in `folderId` if given. Returns its id. */
  create: (name: string, text: string, folderId: string | null) =>
    invoke<string>("create_text", { name, text, folderId }),
};
