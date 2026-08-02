const TERM_REPLACEMENTS: readonly [RegExp, string][] = [
  [/(?:联|链)队/g, "连对"],
  [/王炸弹/g, "王炸"],
  [/三代一/g, "三带一"],
  [/三代二/g, "三带二"],
  [/四代二/g, "四带二"],
  [/不出牌/g, "不出"],
];

export function normalizeDoudizhuTerms(text: string): string {
  let normalized = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "");
  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}
