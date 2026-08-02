import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameReview } from "@ai-doudizhu/coach-protocol";

import { GameReviewPanel } from "./GameReviewPanel";

describe("GameReviewPanel", () => {
  it("explains key decisions without equating outcome and decision quality", () => {
    const review: GameReview = {
      gameId: "review-ui",
      winner: "farmers",
      learningTags: ["misses_endgame_threat"],
      items: [
        {
          actionIndex: 8,
          seat: "user",
          title: "对手进入收尾阶段",
          userHandBefore: [],
          tablePlayBefore: null,
          action: "pass",
          playedCards: [],
          alternatives: [],
          evaluation: "应检查是否有可控的拦截动作。",
          impact: "重要",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <GameReviewPanel review={review} onRestart={() => undefined} />,
    );

    expect(html).toContain("本局复盘");
    expect(html).toContain("不用最终输赢倒推每一步好坏");
    expect(html).toContain("残局威胁判断");
    expect(html).toContain("再来一局");
  });
});
