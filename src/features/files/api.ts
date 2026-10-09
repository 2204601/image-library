// File-only commands (src-tauri/src/files/commands.rs).
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The viewer's preview of a document other than a PDF (src-tauri/src/files/preview.rs). */
export type FilePreview = { kind: "pdf"; path: string } | { kind: "html"; dir: string; file: string };

export const filesApi = {
  /** Made on first use (a moment with Quick Look, seconds with Office); null when it can't be. */
  preview: (id: string) => invoke<FilePreview | null>("file_preview", { id }),
  /** Windows: starts making office documents' thumbnails with Office, in the background. */
  prepareThumbs: () => invoke<void>("prepare_file_thumbs"),
};

/** URL of a preview: the page's own files (styles, pictures) load next to it. */
export function previewSrc(p: FilePreview): string {
  // The asset protocol takes one encoded path; adding the file name after
  // the encoded folder keeps relative links inside the folder.
  return p.kind === "pdf" ? convertFileSrc(p.path) : `${convertFileSrc(p.dir)}/${encodeURIComponent(p.file)}`;
}

/** Calls `onChange` (at most once a second) when background thumbnails are replaced. */
export function onFileThumbs(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return listen<string>("file-thumbs", () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 1000);
  });
}
