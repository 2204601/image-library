// Fonts of the library loaded into the page for the list layout, where each
// font row draws its sample in its own font. Only rows on screen ask, and the
// least recently used fonts are dropped so scrolling through hundreds of
// (often large, Japanese) fonts doesn't pile them all up in memory.
import { api, type FontListPreview } from "./api";

/** Fonts kept loaded at once (a screenful of rows, with room to scroll back). */
const MAX_LOADED = 40;

/** Item id -> the CSS family name it is loaded under. Map order = least recently used first. */
const loaded = new Map<string, Promise<string>>();
const faces = new Map<string, FontFace>();
const previews = new Map<string, Promise<FontListPreview>>();

/** Loads the first font of item `id` and resolves to its CSS family name. */
export function loadFont(id: string): Promise<string> {
  const hit = loaded.get(id);
  if (hit) {
    loaded.delete(id);
    loaded.set(id, hit);
    return hit;
  }
  const name = `il-list-${id}`;
  const p = api
    .fontData(id, 0)
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
  while (loaded.size > MAX_LOADED) {
    const oldest = loaded.keys().next().value!;
    loaded.delete(oldest);
    const f = faces.get(oldest);
    if (f) document.fonts.delete(f);
    faces.delete(oldest);
  }
  return p;
}

/** Sample line and style of item `id` (kept: they are small). */
export function fontPreview(id: string): Promise<FontListPreview> {
  let p = previews.get(id);
  if (!p) {
    p = api.fontListPreview(id);
    p.catch(() => previews.delete(id));
    previews.set(id, p);
  }
  return p;
}
