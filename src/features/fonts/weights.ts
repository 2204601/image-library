// Names of the OpenType weight classes (usWeightClass, 100-900).
const NAMES: [number, string][] = [
  [100, "Thin"],
  [200, "ExtraLight"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "SemiBold"],
  [700, "Bold"],
  [800, "ExtraBold"],
  [900, "Black"],
];

/** "Bold" for 700; the nearest class for weights in between. */
export function weightName(w: number | null): string {
  const v = w ?? 400;
  return NAMES.reduce((best, n) => (Math.abs(n[0] - v) < Math.abs(best[0] - v) ? n : best))[1];
}
