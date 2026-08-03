import { describe, expect, it } from "vitest";

import { createGame, playCards, submitBid } from "@ai-doudizhu/game-core";
import type { Card } from "@ai-doudizhu/game-core";

import {
  createCoachGameContextUpdate,
  createCoachStateSummary,
  deriveCoachGameEvents,
  getPlayerVisibleState,
  parseCoachGameContextUpdate,
} from "./index.js";

const NOW = "2026-08-02T00:00:00.000Z";

describe("coach game context", () => {
  it("derives public events without opponent hands", () => {
    const bidding = createGame({
      gameId: "events",
      randomSeed: "events",
      now: NOW,
    });
    const playing = submitBid(bidding, "user", 3, NOW);
    const play = playing.hands.user.slice(0, 1);
    const afterPlay = playCards(
      playing,
      "user",
      play.map(({ id }) => id),
      NOW,
    );
    const previous = getPlayerVisibleState(playing, "user");
    const current = getPlayerVisibleState(afterPlay, "user");
    const events = deriveCoachGameEvents(previous, current);
    const serialized = JSON.stringify(events);

    expect(events.map(({ type }) => type)).toEqual([
      "cards_played",
      "turn_changed",
    ]);
    expect(
      afterPlay.hands.left.every(({ id }) => !serialized.includes(id)),
    ).toBe(true);
    expect(
      afterPlay.hands.right.every(({ id }) => !serialized.includes(id)),
    ).toBe(true);
  });

  it("sanitizes an accepted context and rejects full-state leakage", () => {
    const fullState = createGame({
      gameId: "sanitize",
      randomSeed: "sanitize",
      now: NOW,
    });
    const visible = getPlayerVisibleState(fullState, "user");
    const baseUpdate = createCoachGameContextUpdate(
      visible,
      0,
      [{ type: "game_started", gameId: visible.gameId }],
      NOW,
    );
    const accepted = parseCoachGameContextUpdate({
      ...baseUpdate,
      state: { ...visible, hands: fullState.hands, randomSeed: "secret" },
    });

    expect(accepted).not.toBeNull();
    expect(JSON.stringify(accepted)).not.toContain("hands");
    expect(JSON.stringify(accepted)).not.toContain("secret");
    expect(
      parseCoachGameContextUpdate({
        ...createCoachGameContextUpdate(visible, 1, [], NOW),
        state: {
          ...visible,
          remainingCardCounts: { ...visible.remainingCardCounts, user: 99 },
        },
        events: [],
      }),
    ).toBeNull();
    expect(
      parseCoachGameContextUpdate({
        ...createCoachGameContextUpdate(visible, 2, [], NOW),
        state: visible,
        events: [
          {
            type: "cards_played",
            seat: "left",
            play: { ...recognizeSingle(fullState.hands.left[0]!) },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseCoachGameContextUpdate({
        ...createCoachGameContextUpdate(
          getPlayerVisibleState(fullState, "left"),
          3,
          [{ type: "game_started", gameId: fullState.gameId }],
          NOW,
        ),
        events: [{ type: "game_started", gameId: fullState.gameId }],
      }),
    ).toBeNull();
  });

  it("creates a deterministic current-trick and played-card summary", () => {
    const bidding = createGame({
      gameId: "summary",
      randomSeed: "summary",
      now: NOW,
    });
    const playing = submitBid(bidding, "user", 3, NOW);
    const card = playing.hands.user[0]!;
    const afterPlay = playCards(playing, "user", [card.id], NOW);
    const visible = getPlayerVisibleState(afterPlay, "user");
    const summary = createCoachStateSummary(visible);

    expect(summary.freeToPlay).toBe(false);
    expect(summary.currentWinningPlay?.cards).toEqual([card]);
    expect(summary.lastAction).toEqual(visible.publicHistory.at(-1));
    expect(summary.playedRankCounts[card.rank]).toBe(1);
    expect(summary.remainingCardCounts.user).toBe(19);
  });

  it("rejects a checksum, action index, or summary that does not match state", () => {
    const state = getPlayerVisibleState(
      createGame({ gameId: "integrity", randomSeed: "integrity", now: NOW }),
      "user",
    );
    const update = createCoachGameContextUpdate(state, 1, [], NOW);

    expect(
      parseCoachGameContextUpdate({ ...update, actionIndex: 99 }),
    ).toBeNull();
    expect(
      parseCoachGameContextUpdate({
        ...update,
        stateChecksum: "fnv1a32:00000000",
      }),
    ).toBeNull();
    expect(
      parseCoachGameContextUpdate({
        ...update,
        summary: { ...update.summary, freeToPlay: true },
      }),
    ).toBeNull();
  });
});

function recognizeSingle(card: Card) {
  return {
    cards: [card],
    type: "single" as const,
    primaryRank: card.rank,
    length: 1,
  };
}
