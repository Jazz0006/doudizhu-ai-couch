import { describe, expect, it } from "vitest";

import {
  cleanTextForSpeech,
  takeCompleteSentences,
} from "./sentence-buffer.js";

describe("takeCompleteSentences", () => {
  it("extracts completed Chinese sentences and retains a partial tail", () => {
    expect(takeCompleteSentences("可以先出。注意保留大牌！下一步")).toEqual({
      sentences: ["可以先出。", "注意保留大牌！"],
      remainder: "下一步",
    });
  });

  it("treats a newline as a sentence boundary", () => {
    expect(takeCompleteSentences("第一点\n第二点")).toEqual({
      sentences: ["第一点"],
      remainder: "第二点",
    });
  });
});

describe("cleanTextForSpeech", () => {
  it("removes common Markdown marks", () => {
    expect(cleanTextForSpeech("**建议**：先出 `连对`。")).toBe(
      "建议：先出 连对。",
    );
  });
});
