import { describe, expect, it } from "vitest";

import {
  createGame,
  generateLegalPlays,
  submitBid,
} from "@ai-doudizhu/game-core";

import {
  chooseBotAction,
  chooseBotBid,
  getBotGameView,
  simulateGame,
} from "./index.js";

const NOW = "2026-08-01T00:00:00.000Z";

describe("bot information boundary", () => {
  it("exposes only the bot hand and public counts", () => {
    const state = createGame({
      gameId: "view",
      randomSeed: "view",
      now: NOW,
    });
    const view = getBotGameView(state, "left");
    const serialized = JSON.stringify(view);

    expect(view.hand).toEqual(state.hands.left);
    expect(view.bottomCards).toEqual([]);
    expect(view.remainingCardCounts).toEqual({ user: 17, left: 17, right: 17 });
    expect(serialized).not.toContain(state.hands.user[0]!.id);
    expect(serialized).not.toContain(state.hands.right[0]!.id);
    expect("hands" in view).toBe(false);
  });

  it("reveals the public bottom cards after the landlord is chosen", () => {
    const bidding = createGame({
      gameId: "bottom",
      randomSeed: "bottom",
      now: NOW,
    });
    const playing = submitBid(bidding, "user", 3, NOW);

    expect(getBotGameView(playing, "right").bottomCards).toEqual(
      playing.bottomCards,
    );
  });
});

describe("simple bot", () => {
  it("returns a legal bid for its turn", () => {
    const state = createGame({
      gameId: "bid",
      randomSeed: "bid",
      now: NOW,
    });
    const view = getBotGameView(state, "user");
    const bid = chooseBotBid(view);

    expect([0, 1, 2, 3]).toContain(bid);
    expect(bid === 0 || bid > state.highestBid).toBe(true);
  });

  it("chooses only generated legal cards without mutating the hand", () => {
    const bidding = createGame({
      gameId: "action",
      randomSeed: "action",
      now: NOW,
    });
    const state = submitBid(bidding, "user", 3, NOW);
    const view = getBotGameView(state, "user");
    const originalIds = view.hand.map(({ id }) => id);
    const action = chooseBotAction(view);
    const legalKeys = new Set(
      generateLegalPlays(view.hand).map((play) =>
        play.cards
          .map(({ id }) => id)
          .sort()
          .join("|"),
      ),
    );

    expect(action.type).toBe("play");

    if (action.type === "play") {
      expect(legalKeys).toContain([...action.cardIds].sort().join("|"));
    }

    expect(view.hand.map(({ id }) => id)).toEqual(originalIds);
  });

  it("rejects actions outside the bot's phase or turn", () => {
    const state = createGame({
      gameId: "wrong-turn",
      randomSeed: "wrong-turn",
      now: NOW,
    });

    expect(() => chooseBotBid(getBotGameView(state, "left"))).toThrow(
      "not left's turn",
    );
    expect(() => chooseBotAction(getBotGameView(state, "user"))).toThrow(
      "playing phase",
    );
  });
});

describe("simulateGame", () => {
  it("completes a legal game within the action limit", () => {
    const result = simulateGame({ randomSeed: "complete-game" });

    expect(result.state.phase).toBe("finished");
    expect(["landlord", "farmers"]).toContain(result.state.winner);
    expect(result.actionCount).toBeLessThan(2_000);
    expect(result.state.history.length).toBeGreaterThan(0);
  });

  it("reproduces the same game for the same seed", () => {
    const first = simulateGame({ randomSeed: "repeatable" });
    const second = simulateGame({ randomSeed: "repeatable" });
    const summarize = (result: typeof first) => ({
      landlord: result.state.landlord,
      winner: result.state.winner,
      dealNumber: result.state.dealNumber,
      bids: result.state.biddingHistory.map(({ seat, bid }) => ({ seat, bid })),
      plays: result.state.history.map(({ seat, action, play }) => ({
        seat,
        action,
        cardIds: play?.cards.map(({ id }) => id) ?? [],
      })),
    });

    expect(summarize(first)).toEqual(summarize(second));
  });

  it("finishes a batch of seeded games without illegal transitions", () => {
    const results = Array.from({ length: 25 }, (_, index) =>
      simulateGame({
        randomSeed: `batch-${index}`,
        maxActions: 500,
      }),
    );

    expect(results.every(({ state }) => state.phase === "finished")).toBe(true);
    expect(results.every(({ actionCount }) => actionCount < 500)).toBe(true);
  });
});
