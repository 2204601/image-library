import { useEffect } from "react";
import { create } from "zustand";
import { COLORS } from "../lib/colors";

export type MenuItem =
  | { label: string; onClick: () => void; danger?: boolean; hint?: string; separator?: never; colors?: never }
  | { separator: true; colors?: never }
  /** A row of colour swatches; picking `null` clears the colour. */
  | { colors: { current: string | null; onPick: (key: string | null) => void }; separator?: never; label?: never };

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  show: (e: React.MouseEvent, items: MenuItem[]) => void;
  close: () => void;
}

export const useMenu = create<MenuState>((set) => ({
  menu: null,
  show: (e, items) => {
    e.preventDefault();
    e.stopPropagation();
    set({ menu: { x: e.clientX, y: e.clientY, items } });
  },
  close: () => set({ menu: null }),
}));

export function ContextMenu() {
  const { menu, close } = useMenu();

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 200);
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 12));
  return (
    <div
      className="fixed inset-0 z-50"
      onPointerDown={close}
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div
        className="absolute min-w-44 animate-slide-down rounded-lg border border-line bg-raised p-1 shadow-xl"
        style={{ left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((it, i) =>
          it.colors ? (
            <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  title={c.label}
                  onClick={() => {
                    close();
                    it.colors.onPick(c.key);
                  }}
                  className={`h-4 w-4 rounded-full ring-offset-1 ring-offset-raised hover:scale-110 ${
                    it.colors.current === c.key ? "ring-2 ring-fg" : ""
                  }`}
                  style={{ background: c.hex }}
                />
              ))}
              <button
                title="色をなしにする"
                onClick={() => {
                  close();
                  it.colors.onPick(null);
                }}
                className="flex h-4 w-4 items-center justify-center rounded-full border border-dim text-[10px] leading-none text-dim hover:text-fg"
              >
                ×
              </button>
            </div>
          ) : "label" in it ? (
            <button
              key={i}
              className={`flex w-full items-center gap-6 rounded px-2.5 py-1.5 text-left hover:bg-accent hover:text-white ${
                it.danger ? "text-danger" : ""
              }`}
              onClick={() => {
                close();
                it.onClick();
              }}
            >
              <span className="flex-1">{it.label}</span>
              {it.hint && <span className="text-xs opacity-50">{it.hint}</span>}
            </button>
          ) : (
            <div key={i} className="mx-1.5 my-1 border-t border-line" />
          ),
        )}
      </div>
    </div>
  );
}
