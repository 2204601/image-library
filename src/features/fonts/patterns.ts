// Ready-made specimen texts, headed by what each lets you check, and the
// user's own (saved per library, `specimenPatterns`). docs/FONT_UI.md
// (見本のパターン).

export interface Pattern {
  label: string;
  text: string;
  /** What the pattern lets you check, shown in the menu. */
  check?: string;
}

/** Each font's own sample (a line it fully covers). */
export const OWN_SAMPLE: Pattern = { label: "各フォントの見本", text: "" };

export const PATTERN_GROUPS: { heading: string; patterns: Pattern[] }[] = [
  {
    heading: "和文",
    patterns: [
      { label: "かな", text: "あさきゆめみし ぁっゃ がぱ アキヲヴ ァッ", check: "ふところ・小書き・濁点" },
      { label: "漢字", text: "一二三 永東京 鬱薔薇驚", check: "画数の少ない字と多い字" },
      { label: "本文", text: "あのイーハトーヴォのすきとおった風、夏でも底に冷たさをもつ青いそら", check: "長文の読みやすさ" },
      { label: "見出し", text: "知らないと損する！3つのポイント", check: "太さ・勢い" },
      { label: "約物（全角）", text: "、。・ー〜「」『』（）【】！？", check: "句読点と括弧の位置" },
    ],
  },
  {
    heading: "欧文",
    patterns: [
      { label: "英字", text: "ABCDEFGHIJKLM abcdefghijklm" },
      { label: "英文", text: "The quick brown fox jumps over the lazy dog" },
      { label: "紛らわしい字", text: "Il1| O0o rn m {}[]", check: "コード用フォントの判別" },
    ],
  },
  {
    heading: "数字・記号",
    patterns: [
      { label: "半角", text: "0123456789 ()[]{}<>!?#$%&@+-=*/" },
      { label: "全角", text: "０１２３４５６７８９（）［］！？＃＄％＆＠" },
    ],
  },
  {
    heading: "混植",
    patterns: [
      { label: "和欧混植", text: "2026年10月14日（水）iPhoneを¥128,000で購入", check: "和文・欧文・数字の釣り合い" },
    ],
  },
];

/** A saved pattern's name: the start of its text. */
export const ownPatternName = (text: string) => {
  const chars = [...text.trim()];
  return chars.length > 12 ? `${chars.slice(0, 12).join("")}…` : chars.join("");
};

/** What the pattern button says for `text`: its pattern's name, else "自由入力". */
export function patternName(text: string, own: string[]): string {
  if (!text.trim()) return OWN_SAMPLE.label;
  for (const g of PATTERN_GROUPS) for (const p of g.patterns) if (p.text === text) return p.label;
  if (own.includes(text)) return ownPatternName(text);
  return "自由入力";
}

/** Most saved patterns kept (the oldest give way). */
export const MAX_OWN_PATTERNS = 20;

/** The text of the ready-made pattern named `label`. */
export function patternText(label: string): string {
  for (const g of PATTERN_GROUPS) for (const p of g.patterns) if (p.label === label) return p.text;
  return "";
}
