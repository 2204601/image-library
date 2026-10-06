import { useEffect } from "react";
import { create } from "zustand";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

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
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 12);
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
        className="absolute min-w-44 rounded-md border border-line bg-raised py-1 shadow-xl"
        style={{ left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((it) => (
          <button
            key={it.label}
            className={`block w-full px-3 py-1.5 text-left hover:bg-accent hover:text-white ${
              it.danger ? "text-danger" : ""
            }`}
            onClick={() => {
              close();
              it.onClick();
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
