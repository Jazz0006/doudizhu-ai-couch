import { describe, expect, it } from "vitest";

import { createGame, playCards, submitBid } from "@ai-doudizhu/game-core";
import type { Card } from "@ai-doudizhu/game-core";

import {
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
    const accepted = parseCoachGameContextUpdate({
      revision: 0,
      state: { ...visible, hands: fullState.hands, randomSeed: "secret" },
      events: [{ type: "game_started", gameId: visible.gameId }],
    });

    expect(accepted).not.toBeNull();
    expect(JSON.stringify(accepted)).not.toContain("hands");
    expect(JSON.stringify(accepted)).not.toContain("secret");
    expect(
      parseCoachGameContextUpdate({
        revision: 1,
        state: {
          ...visible,
          remainingCardCounts: { ...visible.remainingCardCounts, user: 99 },
        },
        events: [],
      }),
    ).toBeNull();
    expect(
      parseCoachGameContextUpdate({
        revision: 2,
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
        revision: 3,
        state: getPlayerVisibleState(fullState, "left"),
        events: [{ type: "game_started", gameId: fullState.gameId }],
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
