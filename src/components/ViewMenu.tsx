// Layout (justified / grid / waterfall / list) and what to show per image.
import { Check, LayoutDashboard, LayoutGrid, LayoutList, Rows3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GroupBy } from "../lib/grouping";
import { useStore, type Layout, type ShowInfo } from "../store";

const GROUPS: { key: GroupBy; label: string; hint: string }[] = [
  { key: "none", label: "なし", hint: "区切りなしで並べる" },
  { key: "rating", label: "評価ごと", hint: "★5 から未評価までの区切りを付ける" },
  { key: "tag", label: "タグごと", hint: "タグごとにまとめる（複数のタグがある画像は各タグに表示）" },
  { key: "folder", label: "フォルダごと", hint: "フォルダごとにまとめる（すべて・サブフォルダ表示時に便利）" },
];

export const LAYOUTS: { key: Layout; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "justified", label: "ジャスティファイ", icon: <Rows3 size={15} />, hint: "行の高さをそろえて縦横比どおりに並べる" },
  { key: "waterfall", label: "ウォーターフォール", icon: <LayoutDashboard size={15} />, hint: "列の幅をそろえて石垣状に並べる" },
  { key: "grid", label: "グリッド", icon: <LayoutGrid size={15} />, hint: "同じ大きさの枠に並べる" },
  { key: "list", label: "リスト", icon: <LayoutList size={15} />, hint: "1 行ずつ詳細を表示" },
];

const INFO: { key: keyof ShowInfo; label: string }[] = [
  { key: "name", label: "名前" },
  { key: "dims", label: "画像サイズ" },
  { key: "rating", label: "評価" },
  { key: "meta", label: "形式・容量" },
];

export function ViewMenu() {
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const showInfo = useStore((s) => s.showInfo);
  const setShowInfo = useStore((s) => s.setShowInfo);
  const groupBy = useStore((s) => s.groupBy);
  const setGroupBy = useStore((s) => s.setGroupBy);
  const isSimilar = useStore((s) => s.view.kind === "similar");
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

  const current = LAYOUTS.find((l) => l.key === layout)!;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        title={`表示：${current.label}${groupBy !== "none" ? ` / ${GROUPS.find((g) => g.key === groupBy)?.label}` : ""}`}
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-md border hover:bg-white/5 ${
          open ? "bg-white/5" : ""
        } ${groupBy !== "none" && !isSimilar ? "border-accent/60 text-accent" : "border-line"}`}
      >
        {current.icon}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-1 w-60 animate-slide-down rounded-lg border border-line bg-raised p-1 text-xs shadow-xl">
          <div className="px-2 pt-1 pb-1 text-[11px] font-semibold text-dim">レイアウト</div>
          {LAYOUTS.map((l) => (
            <button
              key={l.key}
              title={l.hint}
              onClick={() => setLayout(l.key)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/8 ${
                layout === l.key ? "text-fg" : "text-dim"
              }`}
            >
              <span className={layout === l.key ? "text-accent" : ""}>{l.icon}</span>
              <span className="flex-1">{l.label}</span>
              {layout === l.key && <Check size={13} className="text-accent" />}
            </button>
          ))}
          <div className="mx-1.5 my-1 border-t border-line" />
          <div className="px-2 pt-1 pb-1 text-[11px] font-semibold text-dim">
            グループ分け{isSimilar && <span className="ml-1 font-normal">（重複の候補では無効）</span>}
          </div>
          {GROUPS.map((g) => (
            <button
              key={g.key}
              title={g.hint}
              disabled={isSimilar}
              onClick={() => setGroupBy(g.key)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left enabled:hover:bg-white/8 disabled:opacity-40 ${
                groupBy === g.key ? "text-fg" : "text-dim"
              }`}
            >
              <span className="flex-1">{g.label}</span>
              {groupBy === g.key && <Check size={13} className="text-accent" />}
            </button>
          ))}
          <div className="mx-1.5 my-1 border-t border-line" />
          <div className="px-2 pt-1 pb-1 text-[11px] font-semibold text-dim">表示する情報</div>
          {INFO.map((i) => (
            <label
              key={i.key}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 hover:bg-white/8"
            >
              <input
                type="checkbox"
                checked={showInfo[i.key]}
                onChange={(e) => setShowInfo({ [i.key]: e.target.checked })}
                className="accent-accent"
              />
              {i.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
