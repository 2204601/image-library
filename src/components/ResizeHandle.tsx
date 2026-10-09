// The edge of a side panel that can be dragged to change its width
// (double-click: back to the default). The panel's open / close animation is
// turned off while dragging so the edge follows the pointer.
import { useState } from "react";
import { PANEL_WIDTH, useStore } from "../store";

export function ResizeHandle({
  panel,
  onResizing,
}: {
  panel: "sidebar" | "inspector";
  onResizing: (on: boolean) => void;
}) {
  const [active, setActive] = useState(false);
  // The sidebar grows to the right, the details panel to the left.
  const dir = panel === "sidebar" ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const s = useStore.getState();
    const start = panel === "sidebar" ? s.sidebarWidth : s.inspectorWidth;
    const x0 = e.clientX;
    setActive(true);
    onResizing(true);
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => useStore.getState().setPanelWidth(panel, start + (ev.clientX - x0) * dir);
    const up = () => {
      setActive(false);
      onResizing(false);
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="ドラッグで幅を変更（ダブルクリックで元に戻す）"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().setPanelWidth(panel, PANEL_WIDTH[panel].initial)}
      className={`group absolute inset-y-0 z-20 w-2 cursor-col-resize ${panel === "sidebar" ? "right-0" : "left-0"}`}
    >
      <div
        className={`mx-auto h-full w-0.5 transition-colors ${active ? "bg-accent" : "bg-transparent group-hover:bg-accent/60"}`}
      />
    </div>
  );
}
