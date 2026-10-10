// Rows of the list for fonts: the cells of the shared list layout, and the
// specimen layout's row. Both draw the sample in the font itself, loaded only
// while the row is on screen (see loader.ts).
import { Heart, Layers, Pin } from "lucide-react";
import { memo, useEffect, useState } from "react";
// Grid supplies the cell plumbing and uses these rows: the import cycle is
// fine because everything is used at render time, not at load.
import { onItemPointerDown, rowSelection, showItemMenu, Stars, type CellProps } from "../../components/Grid";
import { ChangePulse } from "../../components/ActionHud";
import { fontCategoryLabel, fontCategoryOf, fontScriptLabel, type Item } from "../../lib/api";
import { useStore } from "../../store";
import { type FontListPreview } from "./api";
import { fontChars, fontPreview, loadFont } from "./loader";
import { Sample } from "./Sample";

/** Loads the font and its sample line for a row; `failed` when either can't be had. */
function useFontRow(id: string) {
  const [family, setFamily] = useState<string | null>(null);
  const [preview, setPreview] = useState<FontListPreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFamily(null);
    setPreview(null);
    setFailed(false);
    fontPreview(id)
      .then((p) => live && setPreview(p))
      .catch(() => live && setFailed(true));
    loadFont(id)
      .then((f) => live && setFamily(f))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);
  const style = [preview?.style, preview && preview.faces > 1 ? `ほか ${preview.faces - 1} 個` : ""]
    .filter(Boolean)
    .join(" · ");
  return { family, preview, failed, style };
}

/** List row of a font: family and style, then a sample line drawn in the font. */
export function FontListCells({ item }: { item: Item }) {
  const { family, preview, failed, style } = useFontRow(item.id);
  return (
    <>
      <span className="flex w-36 shrink-0 flex-col leading-tight" title={item.name}>
        <span className="truncate text-[13px]">{item.fontFamily || item.name}</span>
        <span className="truncate text-[11px] text-dim">{style || item.name}</span>
      </span>
      {failed ? (
        <span className="min-w-0 flex-1 truncate text-dim">見本を表示できません</span>
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-[20px] leading-none transition-opacity duration-200 ${
            family && preview ? "opacity-100" : "opacity-0"
          }`}
          style={{ fontFamily: family ? `"${family}"` : undefined }}
        >
          {preview?.sample}
        </span>
      )}
    </>
  );
}

/**
 * Specimen layout: a font as a row with its name and a sample line at the
 * chosen size, in the text typed above the list (or the font's own sample).
 * Characters the font lacks are marked.
 */
export const SpecimenRow = memo(function SpecimenRow(props: CellProps) {
  const { item, index, selected, focused, dimmed, width, height, reorderable, insert, flags } = props;
  const text = useStore((s) => s.specimenText);
  const size = useStore((s) => s.specimenSize);
  const { family, preview, failed, style } = useFontRow(item.id);
  const [has, setHas] = useState<Set<number> | null>(null);

  // The characters are only needed to check typed text.
  const typed = text.trim() !== "";
  useEffect(() => {
    if (!typed) return;
    let live = true;
    setHas(null);
    fontChars(item.id)
      .then((c) => live && setHas(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item.id, typed]);

  const category = fontCategoryOf(item);
  return (
    <div
      className={`relative flex flex-col justify-center gap-1 overflow-hidden rounded-md border-b border-line/60 px-3 transition-opacity duration-200 ${rowSelection(
        selected,
        focused,
      )} ${dimmed ? "opacity-35" : ""}`}
      style={{ width, height }}
      onPointerDown={(e) => onItemPointerDown(e, item, index)}
      onDoubleClick={() => useStore.getState().openViewer(index)}
      onContextMenu={(e) => showItemMenu(e, item, index)}
      data-drop={reorderable ? `item:${item.id}` : undefined}
      data-axis="y"
    >
      <ChangePulse id={item.id} className="rounded-md" />
      <div className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="truncate text-[13px] font-medium">{item.fontFamily || item.name}</span>
        <span className="shrink-0 text-dim">{style}</span>
        <span className="min-w-0 truncate text-dim/70">{item.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-dim">
          {flags && item.pinnedAt !== null && <Pin size={11} className="text-accent" fill="currentColor" />}
          {flags && item.inTray && <Layers size={11} className="text-emerald-400" />}
          {flags && item.favorite && <Heart size={11} className="text-pink-400" fill="currentColor" />}
          {item.rating > 0 && <Stars n={item.rating} />}
          {item.fontScript && <span className="rounded bg-white/8 px-1.5 py-px">{fontScriptLabel(item.fontScript)}</span>}
          <span
            className={`rounded px-1.5 py-px ${category === "none" ? "text-dim/70" : "bg-white/8"}`}
            title={item.fontCategoryUser ? "手で設定した書体" : "自動で判定した書体（詳細パネルで変更できます）"}
          >
            {fontCategoryLabel(category)}
            {item.fontCategoryUser && " ✎"}
          </span>
          <span className="uppercase">{item.ext}</span>
        </span>
      </div>
      {failed ? (
        <span className="text-dim">見本を表示できません</span>
      ) : (
        <Sample
          text={typed ? text : (preview?.sample ?? "")}
          has={typed ? has : null}
          style={{ fontFamily: family ? `"${family}"` : undefined, fontSize: size, lineHeight: 1.15 }}
          className={`block truncate whitespace-pre transition-opacity duration-200 ${
            family && preview ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {insert && (
        <span
          className={`pointer-events-none absolute right-2 left-2 h-0.5 rounded-full bg-accent shadow-[0_0_6px] shadow-accent ${
            insert === "before" ? "-top-px" : "-bottom-px"
          }`}
        />
      )}
    </div>
  );
});
