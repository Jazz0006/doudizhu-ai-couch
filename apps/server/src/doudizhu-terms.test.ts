import { describe, expect, it } from "vitest";

import { normalizeDoudizhuTerms } from "./doudizhu-terms.js";

describe("normalizeDoudizhuTerms", () => {
  it.each([
    ["我想出联队", "我想出连对"],
    ["链队 从 三 到 八", "连对从三到八"],
    ["三代一", "三带一"],
    ["四代二", "四带二"],
    ["我选择不出牌", "我选择不出"],
  ])("normalizes recognition variants", (input, expected) => {
    expect(normalizeDoudizhuTerms(input)).toBe(expected);
  });

  it("does not change unrelated Chinese", () => {
    expect(normalizeDoudizhuTerms("地主还剩五张牌")).toBe("地主还剩五张牌");
  });

  it("preserves meaningful spaces in mixed-language recognition", () => {
    expect(normalizeDoudizhuTerms("今天 is Monday morning")).toBe(
      "今天 is Monday morning",
    );
  });
});
