// Splits the list into sections (rating bands, tags, folders, font
// families) for the grid.
// The result is a flattened display list plus the [start, end) of each
// section, so layouts and navigation keep working on plain indices.
import type { Folder, Item, Tag } from "./api";

export type GroupBy = "none" | "rating" | "tag" | "folder" | "family";

export const GROUP_BYS: GroupBy[] = ["none", "rating", "tag", "folder", "family"];

export interface Section {
  /** Index of the first item, and one past the last. */
  start: number;
  end: number;
  title: string;
  /** Colour name of the tag / folder (see lib/colors.ts). */
  color?: string | null;
  /** Rating sections: the number of stars (0 = unrated). */
  rating?: number;
}

export interface Grouped {
  items: Item[];
  sections: Section[];
}

/** Folders in sidebar order (depth first), each with its full path. */
export function folderPaths(folders: Folder[]): { folder: Folder; path: string }[] {
  const out: { folder: Folder; path: string }[] = [];
  const walk = (parent: string | null, prefix: string) => {
    for (const f of folders) {
      if (f.parentId !== parent) continue;
      const path = prefix ? `${prefix} / ${f.name}` : f.name;
      out.push({ folder: f, path });
      walk(f.id, path);
    }
  };
  walk(null, "");
  return out;
}

/** Similar view: one section per group of look-alikes (items stay as they are). */
export function similarSections(items: Item[]): Section[] {
  const sections: Section[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i === 0 || items[i].group !== items[i - 1].group) {
      sections.push({ start: i, end: i + 1, title: `グループ ${(items[i].group ?? 0) + 1}` });
    } else {
      sections[sections.length - 1].end = i + 1;
    }
  }
  return sections;
}

function build(buckets: { items: Item[]; title: string; color?: string | null; rating?: number }[]): Grouped {
  const items: Item[] = [];
  const sections: Section[] = [];
  for (const b of buckets) {
    if (!b.items.length) continue;
    const start = items.length;
    items.push(...b.items);
    sections.push({ start, end: items.length, title: b.title, color: b.color, rating: b.rating });
  }
  return { items, sections };
}

/**
 * Regroups `items` (already sorted) by `by`. Inside a section the order is
 * kept. With tags an image appears under each of its tags.
 */
export function groupItems(items: Item[], by: GroupBy, tags: Tag[], folders: Folder[]): Grouped {
  if (by === "none" || !items.length) return { items, sections: [] };
  if (by === "rating") {
    return build(
      [5, 4, 3, 2, 1, 0].map((n) => ({
        items: items.filter((i) => i.rating === n),
        title: n ? `★${n}` : "未評価",
        rating: n,
      })),
    );
  }
  if (by === "tag") {
    return build([
      ...tags.map((t) => ({
        items: items.filter((i) => i.tagIds.includes(t.id)),
        title: t.name,
        color: t.color,
      })),
      { items: items.filter((i) => i.tagIds.length === 0), title: "タグなし" },
    ]);
  }
  if (by === "family") return byFamily(items);
  return build([
    ...folderPaths(folders).map(({ folder, path }) => ({
      items: items.filter((i) => i.folderId === folder.id),
      title: path,
      color: folder.color,
    })),
    { items: items.filter((i) => i.folderId === null), title: "未分類" },
  ]);
}

/**
 * One section per font family, families by name, the styles of a family from
 * thin to black (then by the list order); everything else last.
 */
function byFamily(items: Item[]): Grouped {
  const families = new Map<string, Item[]>();
  for (const i of items) {
    if (i.kind !== "font") continue;
    const f = i.fontFamily || "";
    if (!families.has(f)) families.set(f, []);
    families.get(f)!.push(i);
  }
  const names = [...families.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, "ja")));
  return build([
    ...names.map((f) => ({
      // A stable sort keeps the list order among fonts of the same weight.
      items: families.get(f)!.sort((a, b) => (a.fontWeight ?? 400) - (b.fontWeight ?? 400)),
      title: f || "ファミリー不明",
    })),
    { items: items.filter((i) => i.kind !== "font"), title: "フォント以外" },
  ]);
}
