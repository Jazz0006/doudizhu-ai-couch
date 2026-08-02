export interface SentenceBufferResult {
  readonly sentences: readonly string[];
  readonly remainder: string;
}

const SENTENCE_END = /[。！？!?；;\n]/u;

export function takeCompleteSentences(text: string): SentenceBufferResult {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character && SENTENCE_END.test(character)) {
      const sentence = cleanTextForSpeech(text.slice(start, index + 1));
      if (sentence) sentences.push(sentence);
      start = index + 1;
    }
  }
  return { sentences, remainder: text.slice(start) };
}

export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
