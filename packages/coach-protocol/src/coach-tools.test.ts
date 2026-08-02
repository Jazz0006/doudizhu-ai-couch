import { describe, expect, it } from "vitest";

import {
  createGame,
  generateLegalPlays,
  submitBid,
} from "@ai-doudizhu/game-core";

import {
  analyzeSelectedCards,
  createHighlightInstruction,
  getPlayerVisibleState,
} from "./index.js";

const NOW = "2026-08-02T00:00:00.000Z";

describe("coach tools", () => {
  it("analyzes the user's current selection with rule-engine truth", () => {
    const state = submitBid(
      createGame({ gameId: "analysis", randomSeed: "analysis", now: NOW }),
      "user",
      3,
      NOW,
    );
    const play = generateLegalPlays(state.hands.user, null)[0]!;
    const visible = getPlayerVisibleState(state, "user", {
      selectedCardIds: play.cards.map(({ id }) => id),
    });

    expect(analyzeSelectedCards(visible)).toMatchObject({
      legal: true,
      play: { type: play.type },
      warnings: [],
    });
  });

  it("filters highlights to the user hand and clamps their lifetime", () => {
    const state = createGame({
      gameId: "highlight",
      randomSeed: "highlight",
      now: NOW,
    });
    const visible = getPlayerVisibleState(state, "user");
    const ownId = state.hands.user[0]!.id;
    const hiddenId = state.hands.left[0]!.id;

    expect(
      createHighlightInstruction(
        visible,
        [ownId, hiddenId, ownId],
        "  关注这张牌  ",
        60_000,
      ),
    ).toEqual({
      cardIds: [ownId],
      reason: "关注这张牌",
      expiresInMs: 10_000,
    });
    expect(createHighlightInstruction(visible, [hiddenId])).toBeNull();
  });
});
