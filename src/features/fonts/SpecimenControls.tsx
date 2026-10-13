// Specimen layout: the text every font shows, and its size (toolbar row).
import { ALargeSmall, ChevronDown, Minus, Plus } from "lucide-react";
import { useStore } from "../../store";
import { composing } from "../../lib/ime";
import { command } from "../../lib/commands";
import { Slider } from "../../components/Slider";
import { useMenu } from "../../components/ContextMenu";

/** Ready-made sample texts ("" = each font's own sample). */
const PRESETS: { label: string; text: string }[] = [
  { label: "各フォントの見本", text: "" },
  { label: "ひらがな", text: "あいうえお かきくけこ さしすせそ" },
  { label: "カタカナ", text: "アイウエオ カキクケコ サシスセソ" },
  { label: "漢字", text: "永遠 東京 驚愕 鬱蒼 薔薇 麒麟" },
  { label: "いろは歌", text: "いろはにほへと ちりぬるを わかよたれそ つねならむ" },
  { label: "文章", text: "あのイーハトーヴォのすきとおった風、夏でも底に冷たさをもつ青いそら" },
  { label: "見出し", text: "知らないと損する！ 3つのポイント" },
  { label: "英字", text: "ABCDEFGHIJKLM abcdefghijklm" },
  { label: "英文", text: "The quick brown fox jumps over the lazy dog" },
  { label: "数字・記号", text: "0123456789 ¥$%&@#!?（）「」" },
];

export function SpecimenControls() {
  const text = useStore((s) => s.specimenText);
  const setText = useStore((s) => s.setSpecimenText);
  const size = useStore((s) => s.specimenSize);
  const setSize = useStore((s) => s.setSpecimenSize);
  const zoom = (id: "view.zoomIn" | "view.zoomOut") => command(id).run(useStore.getState());
  const step = "flex h-6 w-5 shrink-0 items-center justify-center rounded text-dim hover:bg-white/8 hover:text-fg";

  const showPresets = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    useMenu.getState().show(
      { clientX: r.left, clientY: r.bottom + 4 },
      PRESETS.map((p) => ({ label: p.label, hint: p.text, checked: p.text === text, onClick: () => setText(p.text) })),
    );
  };

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <ALargeSmall size={15} className="shrink-0 text-dim" />
      <div className="flex h-7 min-w-32 flex-1 items-center rounded-md border border-line bg-bg focus-within:border-accent">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && !composing(e) && (setText(""), e.currentTarget.blur())}
          placeholder="見本の文字を入力（空欄なら各フォントの見本）"
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-dim"
        />
        <button
          title="見本の文字を選ぶ"
          onClick={showPresets}
          className="flex h-full shrink-0 items-center gap-0.5 border-l border-line px-1.5 text-dim hover:text-fg"
        >
          パターン
          <ChevronDown size={12} />
        </button>
      </div>
      <div className="flex shrink-0 items-center">
        <button title="文字を小さく（⌘-）" onClick={() => zoom("view.zoomOut")} className={step}>
          <Minus size={13} />
        </button>
        <Slider
          min={12}
          max={160}
          step={2}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          title="見本の文字の大きさ（⌘+ / ⌘-）"
          className="mx-1 w-24"
        />
        <button title="文字を大きく（⌘+）" onClick={() => zoom("view.zoomIn")} className={step}>
          <Plus size={13} />
        </button>
      </div>
      <span className="w-12 shrink-0 text-dim tabular-nums">{size}px</span>
    </div>
  );
}
