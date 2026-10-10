// Specimen layout: the text every font shows, and its size (toolbar row).
import { ALargeSmall } from "lucide-react";
import { useStore } from "../../store";
import { composing } from "../../lib/ime";

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
        onKeyDown={(e) => e.key === "Escape" && !composing(e) && (setText(""), e.currentTarget.blur())}
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
