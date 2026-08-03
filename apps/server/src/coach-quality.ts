import type { CoachStyle } from "@ai-doudizhu/coach-protocol";

const FILLER_PATTERNS = [
  /根据.{0,8}形势/,
  /灵活应对/,
  /具体情况具体分析/,
  /还要观察/,
  /继续观察/,
  /保持警惕/,
  /视情况而定/,
  /要看后续/,
];

const CHARACTER_LIMITS: Record<CoachStyle, number> = {
  direct: 70,
  warm: 110,
  analytical: 220,
};

const RULE_ERROR_PATTERNS = [/同花顺/, /花色.{0,8}(重要|影响|控制|优势)/];

export interface CoachResponseQuality {
  readonly characterCount: number;
  readonly fillerMatches: string[];
  readonly repeatedSentences: string[];
  readonly ruleErrorMatches: string[];
  readonly withinStyleLimit: boolean;
}

export function assessCoachResponseQuality(
  text: string,
  style: CoachStyle,
  previousResponses: readonly string[] = [],
): CoachResponseQuality {
  const sentences = splitSentences(text);
  const previousSentences = new Set(previousResponses.flatMap(splitSentences));
  return {
    characterCount: [...text.replace(/\s/g, "")].length,
    fillerMatches: FILLER_PATTERNS.filter((pattern) => pattern.test(text)).map(
      (pattern) => pattern.source,
    ),
    repeatedSentences: sentences.filter((sentence) =>
      previousSentences.has(sentence),
    ),
    ruleErrorMatches: RULE_ERROR_PATTERNS.filter((pattern) =>
      pattern.test(text),
    ).map((pattern) => pattern.source),
    withinStyleLimit:
      [...text.replace(/\s/g, "")].length <= CHARACTER_LIMITS[style],
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 4);
}
