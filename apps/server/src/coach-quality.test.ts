import { describe, expect, it } from "vitest";

import { assessCoachResponseQuality } from "./coach-quality.js";

describe("coach response quality", () => {
  it("flags generic filler and repeated advice", () => {
    const quality = assessCoachResponseQuality(
      "可以先出单张。还是要根据场上的形势灵活应对。",
      "direct",
      ["可以先出单张。"],
    );

    expect(quality.fillerMatches).toHaveLength(2);
    expect(quality.repeatedSentences).toContain("可以先出单张");
  });

  it("accepts a concise answer grounded in visible facts", () => {
    const quality = assessCoachResponseQuality(
      "先别出王。右家只剩两张，留王更容易抢回牌权。",
      "direct",
    );

    expect(quality).toMatchObject({
      fillerMatches: [],
      repeatedSentences: [],
      ruleErrorMatches: [],
      withinStyleLimit: true,
    });
  });

  it("flags poker concepts that do not exist in doudizhu", () => {
    expect(
      assessCoachResponseQuality(
        "这手牌有同花顺潜力，可以保留花色优势。",
        "warm",
      ),
    ).toMatchObject({
      ruleErrorMatches: ["同花顺", "花色.{0,8}(重要|影响|控制|优势)"],
    });
  });
});
