// Colours for folders, smart folders and tags. The backend stores the name.
export const COLORS = [
  { key: "red", label: "赤", hex: "#ef5d5d" },
  { key: "orange", label: "オレンジ", hex: "#f59e42" },
  { key: "yellow", label: "黄", hex: "#e8c547" },
  { key: "green", label: "緑", hex: "#4cc38a" },
  { key: "teal", label: "青緑", hex: "#3cc3c3" },
  { key: "blue", label: "青", hex: "#4c8dff" },
  { key: "purple", label: "紫", hex: "#9b7cf0" },
  { key: "pink", label: "ピンク", hex: "#ec6fb0" },
  { key: "gray", label: "グレー", hex: "#9a9ba3" },
] as const;

/** CSS colour for a stored colour name, or undefined for none / unknown. */
export const colorHex = (key: string | null | undefined): string | undefined =>
  COLORS.find((c) => c.key === key)?.hex;
