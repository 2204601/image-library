// Toolbar controls for how the list looks, each on its own: the layout
// (one click), grouping into sections, and what to show per thumbnail.
import {
  ALargeSmall,
  Check,
  ChevronDown,
  Columns3,
  Layers,
  LayoutGrid,
  LayoutList,
  Rows3,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GroupBy } from "../lib/grouping";
import { useStore, type Layout, type ShowInfo } from "../store";

const GROUPS: { key: GroupBy; label: string; hint: string }[] = [
  { key: "none", label: "なし", hint: "区切らずに並べる" },
  { key: "rating", label: "評価", hint: "★5 から未評価まで" },
  { key: "tag", label: "タグ", hint: "複数のタグがある画像は各タグに出る" },
  { key: "folder", label: "フォルダ", hint: "「すべて」やサブフォルダ表示で便利" },
  { key: "kind", label: "種類", hint: "画像・フォント" },
  { key: "family", label: "フォントのファミリー", hint: "同じフォントの太さ違いをまとめる（細い順）" },
];

export const LAYOUTS: { key: Layout; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "justified", label: "標準", icon: <Rows3 size={15} />, hint: "行の高さをそろえ、縦横比のまま並べる" },
  { key: "waterfall", label: "Pinterest風", icon: <Columns3 size={15} />, hint: "列の幅をそろえ、縦に詰めて並べる" },
  { key: "grid", label: "グリッド", icon: <LayoutGrid size={15} />, hint: "同じ大きさの枠に収めて並べる" },
  { key: "list", label: "リスト", icon: <LayoutList size={15} />, hint: "1 行ずつ詳しく表示。フォントは見本の文字を表示" },
  {
    key: "specimen",
    label: "フォント見本",
    icon: <ALargeSmall size={15} />,
    hint: "フォントを 1 行ずつ大きく並べ、同じ文字で見比べる",
  },
];

const INFO: { key: keyof ShowInfo; label: string }[] = [
  { key: "name", label: "名前" },
  { key: "dims", label: "画像サイズ" },
  { key: "rating", label: "評価" },
  { key: "meta", label: "形式・容量" },
];

/** A toolbar button with a dropdown that closes on Escape or a click elsewhere. */
function Dropdown({
  button,
  title,
  active,
  width,
  children,
}: {
  button: React.ReactNode;
  title: string;
  /** Highlighted: the setting differs from the default. */
  active?: boolean;
  width: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 whitespace-nowrap hover:bg-white/5 ${
          open ? "bg-white/5" : ""
        } ${active ? "border-accent/60 text-accent" : "border-line"}`}
      >
        {button}
      </button>
      {open && (
        <div
          className={`absolute top-full right-0 z-40 mt-1 ${width} animate-slide-down rounded-lg border border-line bg-raised p-1 text-xs shadow-xl`}
          onClick={(e) => (e.target as HTMLElement).closest("[data-close]") && setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const heading = "px-2 pt-1 pb-1 text-[11px] font-semibold text-dim";

/** Layouts always on the toolbar; the others are in the display menu. */
const PRIMARY: Layout[] = ["justified", "waterfall"];

/**
 * The everyday layouts side by side, one click to switch. Grid / list sit in
 * the display menu, and show up here only while one of them is in use.
 */
export function LayoutSwitch() {
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const shown = LAYOUTS.filter((l) => PRIMARY.includes(l.key) || l.key === layout);
  return (
    <div className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-line">
      {shown.map((l, i) => (
        <button
          key={l.key}
          title={`${l.label}：${l.hint}`}
          aria-label={l.label}
          aria-pressed={layout === l.key}
          onClick={() => setLayout(l.key)}
          className={`flex w-8 items-center justify-center ${i > 0 ? "border-l border-line" : ""} ${
            layout === l.key ? "bg-accent/20 text-accent" : "text-dim hover:bg-white/5 hover:text-fg"
          }`}
        >
          {l.icon}
        </button>
      ))}
    </div>
  );
}

/** Splitting the list into sections. */
export function GroupMenu() {
  const groupBy = useStore((s) => s.groupBy);
  const setGroupBy = useStore((s) => s.setGroupBy);
  const isSimilar = useStore((s) => s.view.kind === "similar");
  const current = GROUPS.find((g) => g.key === groupBy)!;
  const on = groupBy !== "none" && !isSimilar;
  return (
    <Dropdown
      title={isSimilar ? "グループ分け（重複の候補では使えません）" : `グループ分け：${current.label}`}
      active={on}
      width="w-64"
      button={
        <>
          <Layers size={15} />
          <span>{on ? current.label : "グループ"}</span>
          <ChevronDown size={13} className="text-dim" />
        </>
      }
    >
      <div className={heading}>
        グループ分け{isSimilar && <span className="ml-1 font-normal">（重複の候補では無効）</span>}
      </div>
      {GROUPS.map((g) => (
        <button
          key={g.key}
          data-close
          disabled={isSimilar}
          onClick={() => setGroupBy(g.key)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left enabled:hover:bg-white/8 disabled:opacity-40 ${
            groupBy === g.key ? "text-fg" : "text-dim"
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{g.label}</span>
            {g.key !== "none" && <span className="text-[11px] text-dim">{g.hint}</span>}
          </span>
          {groupBy === g.key && <Check size={13} className="shrink-0 text-accent" />}
        </button>
      ))}
    </Dropdown>
  );
}

/** Thumbnail size and the information shown under each thumbnail. */
export function DisplayMenu() {
  const showInfo = useStore((s) => s.showInfo);
  const setShowInfo = useStore((s) => s.setShowInfo);
  const thumbSize = useStore((s) => s.thumbSize);
  const setThumbSize = useStore((s) => s.setThumbSize);
  const specimenSize = useStore((s) => s.specimenSize);
  const setSpecimenSize = useStore((s) => s.setSpecimenSize);
  const layout = useStore((s) => s.layout);
  // The specimen layout sizes its sample text instead of thumbnails.
  const specimen = layout === "specimen";
  const setLayout = useStore((s) => s.setLayout);
  return (
    <Dropdown title="表示（レイアウト・サムネイルの大きさ・表示する情報）" width="w-64" button={<SlidersHorizontal size={15} />}>
      <div className={heading}>レイアウト</div>
      {LAYOUTS.map((l) => (
        <button
          key={l.key}
          data-close
          onClick={() => setLayout(l.key)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/8 ${
            layout === l.key ? "text-fg" : "text-dim"
          }`}
        >
          <span className={`shrink-0 ${layout === l.key ? "text-accent" : ""}`}>{l.icon}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{l.label}</span>
            <span className="text-[11px] text-dim">{l.hint}</span>
          </span>
          {layout === l.key && <Check size={13} className="shrink-0 text-accent" />}
        </button>
      ))}
      <div className="mx-1.5 my-1 border-t border-line" />
      <div className={heading}>{specimen ? "見本の文字の大きさ" : "サムネイルの大きさ"}</div>
      <label className="flex items-center gap-2 px-2 py-1.5" title="⌘+ / ⌘-">
        <input
          type="range"
          min={specimen ? 12 : 80}
          max={specimen ? 160 : 360}
          step={specimen ? 2 : 10}
          value={specimen ? specimenSize : thumbSize}
          disabled={layout === "list"}
          onChange={(e) => (specimen ? setSpecimenSize : setThumbSize)(Number(e.target.value))}
          className="min-w-0 flex-1 accent-accent disabled:opacity-40"
        />
        <span className="w-10 text-right text-dim tabular-nums">{specimen ? specimenSize : thumbSize}</span>
      </label>
      <div className="mx-1.5 my-1 border-t border-line" />
      <div className={heading}>サムネイルの下に表示</div>
      {INFO.map((i) => (
        <label key={i.key} className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 hover:bg-white/8">
          <input
            type="checkbox"
            checked={showInfo[i.key]}
            onChange={(e) => setShowInfo({ [i.key]: e.target.checked })}
            className="accent-accent"
          />
          {i.label}
        </label>
      ))}
    </Dropdown>
  );
}

/** Specimen layout: the text every font shows, and its size. */
export function SpecimenControls() {
  const text = useStore((s) => s.specimenText);
  const setText = useStore((s) => s.setSpecimenText);
  const size = useStore((s) => s.specimenSize);
  const setSize = useStore((s) => s.setSpecimenSize);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <ALargeSmall size={15} className="shrink-0 text-dim" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (setText(""), e.currentTarget.blur())}
        placeholder="見本の文字を入力（空欄なら各フォントの見本）"
        className="h-7 min-w-32 flex-1 rounded-md border border-line bg-bg px-2 text-[13px] outline-none placeholder:text-dim focus:border-accent"
      />
      <input
        type="range"
        min={12}
        max={160}
        step={2}
        value={size}
        onChange={(e) => setSize(Number(e.target.value))}
        title="見本の文字の大きさ（⌘+ / ⌘-）"
        className="w-24 shrink-0 accent-accent"
      />
      <span className="w-12 shrink-0 text-dim tabular-nums">{size}px</span>
    </div>
  );
}
