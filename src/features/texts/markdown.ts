// Markdown to HTML for the viewer, keeping only what is safe to put on the
// page: texts come from anywhere (docs/TEXT.md, ARCHITECTURE.md「外から来る
// ファイル」). marked doesn't clean its output, so the HTML is parsed into an
// inert document (nothing loads or runs there) and every element and
// attribute not listed here is dropped.
import { marked } from "marked";

/** Elements kept as they are (their attributes are checked separately). */
const TAGS = new Set([
  "a", "b", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "i", "input", "kbd", "li", "mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

/** Elements dropped with what is inside them. */
const DROP = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "button", "select",
  "textarea", "link", "meta", "base", "svg", "math", "template", "noscript", "video", "audio", "source", "picture",
  "canvas", "title", "head",
]);

const ATTRS: Record<string, string[]> = {
  a: ["href", "title"],
  td: ["align"],
  th: ["align"],
  ol: ["start"],
  input: ["type", "checked", "disabled"],
  code: ["class"],
};

/** Links the viewer opens in the browser; anything else (javascript:, file:, relative) is no link. */
export const isOpenableLink = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

function clean(el: Element) {
  for (const child of [...el.children]) {
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) {
      child.remove();
      continue;
    }
    if (tag === "img") {
      // Pictures outside the library aren't loaded (CSP); say what was there.
      const alt = child.getAttribute("alt")?.trim();
      const note = child.ownerDocument.createElement("span");
      note.className = "md-img";
      note.textContent = alt ? `画像：${alt}` : "画像";
      child.replaceWith(note);
      continue;
    }
    clean(child);
    if (!TAGS.has(tag) || (tag === "input" && child.getAttribute("type") !== "checkbox")) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    const allowed = ATTRS[tag] ?? [];
    for (const attr of [...child.attributes]) {
      if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
    }
    if (tag === "a") {
      const href = child.getAttribute("href") ?? "";
      if (!isOpenableLink(href)) child.removeAttribute("href");
    }
    if (tag === "input") child.setAttribute("disabled", "");
    if (tag === "code" && !/^language-[\w-]+$/.test(child.getAttribute("class") ?? "")) child.removeAttribute("class");
  }
}

/** The Markdown as clean HTML (GitHub flavour: tables, task lists, strikethrough). */
export function markdownHtml(md: string): string {
  const raw = marked.parse(md, { gfm: true, async: false }) as string;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${raw}</body>`, "text/html");
  clean(doc.body);
  return doc.body.innerHTML;
}
