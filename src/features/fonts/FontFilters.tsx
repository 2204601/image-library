// Sidebar sections of the font mode: writing system, typeface style, weight
// and features, on top of the open view (like tags). Within a section a
// click shows only that one (again: all) and ⌘ / Shift + click adds or
// removes one (any of); the sections combine (all of). 言語 lists only the
// scripts there are fonts of; the others list every row, 0 included.
import { X } from "lucide-react";
// Sidebar supplies the row and section chrome and renders this: the import
// cycle is fine because everything is used at render time, not at load.
import { Row, Section } from "../../components/Sidebar";
import { FONT_CATEGORIES, FONT_FEATURES, FONT_SCRIPTS, FONT_WEIGHTS } from "../../lib/api";
import { useStore } from "../../store";

/** Clicking a filter row: only this one (again: none); ⌘ / Shift adds or removes it. */
function pickFrom(cur: string[], v: string, add: boolean): string[] {
  if (add) return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  return cur.length === 1 && cur[0] === v ? [] : [v];
}

const isAdd = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey;

export function FontFilters() {
  const counts = useStore((s) => s.counts);
  const fontScripts = useStore((s) => s.filter.fontScripts);
  const fontCategories = useStore((s) => s.filter.fontCategories);
  const fontWeights = useStore((s) => s.filter.fontWeights);
  const fontFeatures = useStore((s) => s.filter.fontFeatures);
  const setFilter = useStore((s) => s.setFilter);

  const group = (
    title: string,
    items: { key: string; label: string; names?: string; range?: string }[],
    counted: Record<string, number>,
    on: string[],
    set: (v: string[]) => void,
    // Fixed lists show every row, 0 included, so what can be told is plain.
    every = true,
  ) => {
    const shown = every ? items : items.filter((x) => counted[x.key] || on.includes(x.key));
    return (
      <Section
        title={title}
        hideId="section:fontFilters"
        action={
          on.length > 0 && (
            <button title={`${title}の絞り込みを解除`} className="text-dim hover:text-fg" onClick={() => set([])}>
              <X size={14} />
            </button>
          )
        }
      >
        {shown.length === 0 && <p className="px-2 py-1 text-xs text-dim">フォントはまだありません</p>}
        {shown.map((x) => (
          <Row
            key={x.key}
            active={on.includes(x.key)}
            icon={<span className="block h-1.5 w-1.5 rounded-full bg-current" />}
            label={
              x.names ? (
                <>
                  {x.label}
                  <span className="ml-2 text-xs text-dim">{x.names}</span>
                </>
              ) : (
                x.label
              )
            }
            count={counted[x.key] ?? 0}
            title={`${x.range ? `太さ ${x.range}。` : ""}クリックでこれだけを表示（⌘・Shift+クリックで追加）`}
            onClick={(e) => set(pickFrom(on, x.key, isAdd(e)))}
          />
        ))}
      </Section>
    );
  };

  return (
    <>
      {group("言語", FONT_SCRIPTS, counts.fontScripts, fontScripts, (v) => setFilter({ fontScripts: v }), false)}
      {group("書体", FONT_CATEGORIES, counts.fontCategories, fontCategories, (v) => setFilter({ fontCategories: v }))}
      {group("太さ", FONT_WEIGHTS, counts.fontWeights, fontWeights, (v) => setFilter({ fontWeights: v }))}
      {group("特徴", FONT_FEATURES, counts.fontFeatures, fontFeatures, (v) => setFilter({ fontFeatures: v }))}
    </>
  );
}
