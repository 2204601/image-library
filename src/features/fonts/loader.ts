// Fonts of the library loaded into the page for the list layout, where each
// font row draws its sample in its own font. Only rows on screen ask, and the
// least recently used fonts are dropped so scrolling through hundreds of
// (often large, Japanese) fonts doesn't pile them all up in memory.
import { fontApi, type FontListPreview } from "./api";

/**
 * Fonts kept loaded once off screen (room to scroll back). Rows on screen
 * hold theirs (`holdFont`) on top of this: a tall window or small samples
 * show more rows than this, and a row whose font was dropped would quietly
 * draw its sample in the system font.
 */
const MAX_LOADED = 40;
/** Item id -> rows showing it now. */
const held = new Map<string, number>();

/** Item id -> the CSS family name it is loaded under. Map order = least recently used first. */
const loaded = new Map<string, Promise<string>>();
const faces = new Map<string, FontFace>();
const previews = new Map<string, Promise<FontListPreview>>();
/** Item id -> the characters of its first font (least recently used first). */
const charSets = new Map<string, Promise<Set<number>>>();

/** Loads the first font of item `id` and resolves to its CSS family name. */
export function loadFont(id: string): Promise<string> {
  const hit = loaded.get(id);
  if (hit) {
    loaded.delete(id);
    loaded.set(id, hit);
    return hit;
  }
  const name = `il-list-${id}`;
  const p = fontApi
    .data(id, 0)
    .then((data) => new FontFace(name, data).load())
    .then((f) => {
      // Dropped while loading: don't leave it in the page.
      if (loaded.get(id) !== p) return name;
      document.fonts.add(f);
      faces.set(id, f);
      return name;
    });
  p.catch(() => loaded.get(id) === p && loaded.delete(id));
  loaded.set(id, p);
  trim();
  return p;
}

/** Drops the least recently used fonts no row shows, down to MAX_LOADED. */
function trim() {
  for (const id of [...loaded.keys()]) {
    if (loaded.size <= MAX_LOADED) return;
    if (held.has(id)) continue;
    loaded.delete(id);
    const f = faces.get(id);
    if (f) document.fonts.delete(f);
    faces.delete(id);
  }
}

/** A row shows item `id`'s font until the returned function is called. */
export function holdFont(id: string): () => void {
  held.set(id, (held.get(id) ?? 0) + 1);
  return () => {
    const n = (held.get(id) ?? 1) - 1;
    if (n > 0) held.set(id, n);
    else held.delete(id);
    trim();
  };
}

/** Sample line and style of item `id` (kept: they are small). */
export function fontPreview(id: string): Promise<FontListPreview> {
  let p = previews.get(id);
  if (!p) {
    p = fontApi.listPreview(id);
    p.catch(() => previews.delete(id));
    previews.set(id, p);
  }
  return p;
}

/**
 * Characters of item `id`'s first font, to mark the ones typed text lacks.
 * Kept for as many fonts as are loaded (a Japanese font has ~20,000).
 */
export function fontChars(id: string): Promise<Set<number>> {
  let p = charSets.get(id);
  if (p) {
    charSets.delete(id);
  } else {
    p = fontApi.info(id, 0).then((i) => new Set(i.chars));
    p.catch(() => charSets.get(id) === p && charSets.delete(id));
  }
  charSets.set(id, p);
  while (charSets.size > MAX_LOADED) charSets.delete(charSets.keys().next().value!);
  return p;
}
