import { describe, expect, it } from "vitest";

import {
  RANKS,
  createGame,
  generateLegalPlays,
  passTurn,
  playCards,
  submitBid,
} from "@ai-doudizhu/game-core";

import {
  createCoachGameContextUpdate,
  createCoachStateSummary,
  getPlayerVisibleState,
  parseCoachGameContextUpdate,
} from "./index.js";

describe("coach state summary scenarios", () => {
  it("keeps current play, history counts, and hidden-information boundaries consistent across 30 actions", () => {
    let state = submitBid(
      createGame({ gameId: "thirty-states", randomSeed: "thirty-states" }),
      "user",
      3,
    );
    let checked = 0;

    while (state.phase === "playing" && checked < 30) {
      const seat = state.currentTurn;
      const legal = generateLegalPlays(
        state.hands[seat],
        state.currentWinningPlay,
      );
      state =
        legal.length === 0
          ? passTurn(state, seat)
          : playCards(
              state,
              seat,
              legal[0]!.cards.map(({ id }) => id),
            );
      const visible = getPlayerVisibleState(state, "user");
      const summary = createCoachStateSummary(visible);
      const update = createCoachGameContextUpdate(
        visible,
        checked,
        [],
        "2026-08-03T00:00:00.000Z",
      );
      const serialized = JSON.stringify(update);

      expect(update.actionIndex).toBe(visible.publicHistory.length);
      expect(summary.lastAction).toEqual(visible.publicHistory.at(-1));
      expect(summary.currentWinningPlay).toEqual(visible.currentWinningPlay);
      for (const rank of RANKS) {
        const independentlyCounted = visible.publicHistory.reduce(
          (count, record) =>
            count +
            (record.play?.cards.filter((card) => card.rank === rank).length ??
              0),
          0,
        );
        expect(summary.playedRankCounts[rank]).toBe(independentlyCounted);
      }
      expect(parseCoachGameContextUpdate(update)).toEqual(update);
      expect(state.hands.left.every(({ id }) => !serialized.includes(id))).toBe(
        true,
      );
      expect(
        state.hands.right.every(({ id }) => !serialized.includes(id)),
      ).toBe(true);
      checked += 1;
    }

    expect(checked).toBe(30);
  });
});
