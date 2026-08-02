import { describe, expect, it } from "vitest";

import {
  createGame,
  generateLegalPlays,
  passTurn,
  playCards,
  submitBid,
} from "@ai-doudizhu/game-core";
import type { FullGameState } from "@ai-doudizhu/game-core";

import { createGameReview } from "./index.js";

function finishGame(): FullGameState {
  let state = submitBid(
    createGame({ gameId: "review", randomSeed: "review" }),
    "user",
    3,
  );
  for (let turn = 0; turn < 500 && state.phase !== "finished"; turn += 1) {
    const seat = state.currentTurn;
    const play = generateLegalPlays(
      state.hands[seat],
      state.currentWinningPlay,
    )[0];
    state = play
      ? playCards(
          state,
          seat,
          play.cards.map(({ id }) => id),
        )
      : passTurn(state, seat);
  }
  if (state.phase !== "finished") throw new Error("Fixture did not finish");
  return state;
}

describe("game review", () => {
  it("selects three to five deterministic, serializable teaching nodes", () => {
    const state = finishGame();
    const review = createGameReview(state);
    const userCardIds = new Set(
      review.items.flatMap(({ userHandBefore }) =>
        userHandBefore.map(({ id }) => id),
      ),
    );

    expect(review.items.length).toBeGreaterThanOrEqual(3);
    expect(review.items.length).toBeLessThanOrEqual(5);
    expect(review.items.map(({ actionIndex }) => actionIndex)).toEqual(
      [...review.items.map(({ actionIndex }) => actionIndex)].sort(
        (left, right) => left - right,
      ),
    );
    expect(
      review.items
        .flatMap(({ alternatives }) => alternatives)
        .every(({ cardIds }) => cardIds.every((id) => userCardIds.has(id))),
    ).toBe(true);
    expect(() => JSON.stringify(review)).not.toThrow();
  });

  it("does not expose review tools before the game finishes", () => {
    expect(() =>
      createGameReview(createGame({ gameId: "active", randomSeed: "active" })),
    ).toThrow(/only available/);
  });
});
