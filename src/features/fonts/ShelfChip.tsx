// A font on the shelf: a character in the font itself and its name.
import { useEffect, useState } from "react";
import type { Item } from "../../lib/api";
import { holdFont, loadFont } from "./loader";
import { weightName } from "./weights";

/** The font of `id`, loaded while shown (its CSS family once loaded). */
function useLoadedFont(id: string): string | null {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const release = holdFont(id);
    loadFont(id)
      .then((f) => live && setFamily(f))
      .catch(() => {});
    return () => {
      live = false;
      release();
    };
  }, [id]);
  return family;
}

/** "Aa" or "あ" in the font, where a font has no rendered sample (an installed font in the viewer's strip). */
export function FontMark({ item, className }: { item: Item; className?: string }) {
  const family = useLoadedFont(item.id);
  return (
    <span
      className={`transition-opacity ${family ? "" : "opacity-40"} ${className ?? ""}`}
      style={{ fontFamily: family ? `"${family}"` : undefined }}
    >
      {item.fontScript === "latin" ? "Aa" : "あ"}
    </span>
  );
}

/** The font's mark and name, for the shelf's chip (the chip itself is Shelf.tsx's). */
export function FontShelfLabel({ item }: { item: Item }) {
  const family = useLoadedFont(item.id);
  return (
    <>
      <span
        className={`w-6 shrink-0 text-center text-base leading-none transition-opacity ${family ? "" : "opacity-40"}`}
        style={{ fontFamily: family ? `"${family}"` : undefined }}
      >
        {item.fontScript === "latin" ? "Aa" : "あ"}
      </span>
      <span className="min-w-0 truncate" title={item.name}>
        {item.fontFamily || item.name}
        {/* Which of the family's styles, unless it is the regular. */}
        {item.fontFamily && (item.fontWeight ?? 400) !== 400 && (
          <span className="ml-1 text-dim">{weightName(item.fontWeight)}</span>
        )}
      </span>
    </>
  );
}
