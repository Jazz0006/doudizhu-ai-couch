import { describe, expect, it } from "vitest";

import {
  GameRuleError,
  createDeck,
  createGame,
  nextSeat,
  passTurn,
  playCards,
  submitBid,
} from "./index.js";
import type { Card, FullGameState, Play, Rank, Seat } from "./index.js";

const deck = createDeck();
const NOW = "2026-08-01T00:00:00.000Z";

function take(rank: Rank, count: number): Card[] {
  return deck.filter((card) => card.rank === rank).slice(0, count);
}

function playingState(options: {
  hands: Record<Seat, Card[]>;
  landlord?: Seat;
  currentTurn?: Seat;
  currentWinningPlay?: Play | null;
  trickLeader?: Seat | null;
  consecutivePasses?: number;
}): FullGameState {
  const landlord = options.landlord ?? "user";
  const base = createGame({
    gameId: "state-test",
    randomSeed: "state-test",
    now: NOW,
  });

  return {
    ...base,
    phase: "playing",
    hands: options.hands,
    landlord,
    roles: {
      user: landlord === "user" ? "landlord" : "farmer",
      left: landlord === "left" ? "landlord" : "farmer",
      right: landlord === "right" ? "landlord" : "farmer",
    },
    currentTurn: options.currentTurn ?? "user",
    trickLeader: options.trickLeader ?? null,
    currentWinningPlay: options.currentWinningPlay ?? null,
    consecutivePasses: options.consecutivePasses ?? 0,
  };
}

function expectRuleError(
  action: () => unknown,
  code: GameRuleError["code"],
): void {
  try {
    action();
    throw new Error("Expected a GameRuleError");
  } catch (error) {
    expect(error).toBeInstanceOf(GameRuleError);
    expect((error as GameRuleError).code).toBe(code);
  }
}

describe("createGame", () => {
  it("creates a reproducible, complete deal in the bidding phase", () => {
    const first = createGame({
      gameId: "game-1",
      randomSeed: "seed-1",
      firstBidder: "left",
      now: NOW,
    });
    const second = createGame({
      gameId: "game-2",
      randomSeed: "seed-1",
      firstBidder: "left",
      now: NOW,
    });
    const allCards = [
      ...first.hands.user,
      ...first.hands.left,
      ...first.hands.right,
      ...first.bottomCards,
    ];

    expect(first.phase).toBe("bidding");
    expect(first.currentTurn).toBe("left");
    expect(first.hands.user).toHaveLength(17);
    expect(first.hands.left).toHaveLength(17);
    expect(first.hands.right).toHaveLength(17);
    expect(first.bottomCards).toHaveLength(3);
    expect(new Set(allCards.map(({ id }) => id)).size).toBe(54);
    expect(second.hands).toEqual(first.hands);
    expect(second.bottomCards).toEqual(first.bottomCards);
  });
});

describe("bidding", () => {
  it("awards the landlord role to the highest bidder after one round", () => {
    let state = createGame({ gameId: "bid", randomSeed: "bid", now: NOW });

    state = submitBid(state, "user", 1, NOW);
    state = submitBid(state, "left", 2, NOW);
    state = submitBid(state, "right", 0, NOW);

    expect(state.phase).toBe("playing");
    expect(state.landlord).toBe("left");
    expect(state.currentTurn).toBe("left");
    expect(state.hands.left).toHaveLength(20);
    expect(state.roles).toEqual({
      user: "farmer",
      left: "landlord",
      right: "farmer",
    });
  });

  it("immediately awards the landlord role for a bid of three", () => {
    const initial = createGame({
      gameId: "bid-three",
      randomSeed: "bid-three",
      now: NOW,
    });
    const state = submitBid(initial, "user", 3, NOW);

    expect(state.phase).toBe("playing");
    expect(state.landlord).toBe("user");
    expect(state.biddingHistory).toHaveLength(1);
  });

  it("rejects out-of-turn and non-increasing bids", () => {
    const initial = createGame({
      gameId: "invalid-bid",
      randomSeed: "invalid-bid",
      now: NOW,
    });

    expectRuleError(
      () => submitBid(initial, "left", 1, NOW),
      "NOT_CURRENT_TURN",
    );

    const afterUser = submitBid(initial, "user", 2, NOW);
    expectRuleError(() => submitBid(afterUser, "left", 1, NOW), "INVALID_BID");
  });

  it("redeals deterministically and rotates the first bidder after all pass", () => {
    let state = createGame({
      gameId: "all-pass",
      randomSeed: "all-pass",
      now: NOW,
    });
    const originalHands = state.hands;

    state = submitBid(state, "user", 0, NOW);
    state = submitBid(state, "left", 0, NOW);
    state = submitBid(state, "right", 0, NOW);

    expect(state.phase).toBe("bidding");
    expect(state.dealNumber).toBe(2);
    expect(state.firstBidder).toBe("left");
    expect(state.currentTurn).toBe("left");
    expect(state.highestBid).toBe(0);
    expect(state.hands).not.toEqual(originalHands);
    expect(state.biddingHistory).toHaveLength(3);
  });
});

describe("playing turns", () => {
  it("removes played cards, advances the turn, and records history", () => {
    const state = playingState({
      hands: {
        user: [...take("3", 1), ...take("4", 1)],
        left: take("5", 1),
        right: take("7", 1),
      },
    });
    const next = playCards(state, "user", [state.hands.user[0]!.id], NOW);

    expect(next.hands.user).toHaveLength(1);
    expect(next.currentTurn).toBe("left");
    expect(next.currentWinningPlay?.type).toBe("single");
    expect(next.trickLeader).toBe("user");
    expect(next.history).toEqual([
      expect.objectContaining({
        index: 0,
        seat: "user",
        action: "play",
      }),
    ]);
    expect(state.hands.user).toHaveLength(2);
  });

  it("rejects out-of-turn, absent, duplicate, invalid, and losing cards", () => {
    const state = playingState({
      hands: {
        user: [...take("3", 2), ...take("4", 1)],
        left: [...take("5", 1), ...take("6", 1)],
        right: take("7", 1),
      },
    });

    expectRuleError(
      () => playCards(state, "left", [state.hands.left[0]!.id], NOW),
      "NOT_CURRENT_TURN",
    );
    expectRuleError(
      () => playCards(state, "user", [state.hands.left[0]!.id], NOW),
      "CARD_NOT_IN_HAND",
    );
    expectRuleError(
      () =>
        playCards(
          state,
          "user",
          [state.hands.user[0]!.id, state.hands.user[0]!.id],
          NOW,
        ),
      "DUPLICATE_CARD_SELECTION",
    );
    expectRuleError(
      () =>
        playCards(
          state,
          "user",
          [state.hands.user[0]!.id, state.hands.user[2]!.id],
          NOW,
        ),
      "INVALID_PLAY",
    );

    const currentPlay = playCards(
      { ...state, currentTurn: "left" },
      "left",
      [state.hands.left[0]!.id],
      NOW,
    );
    expectRuleError(
      () =>
        playCards(
          {
            ...currentPlay,
            currentTurn: "user",
            hands: state.hands,
          },
          "user",
          [state.hands.user[0]!.id],
          NOW,
        ),
      "PLAY_DOES_NOT_BEAT",
    );
  });

  it("returns the lead after two consecutive passes", () => {
    const initial = playingState({
      hands: {
        user: [...take("3", 1), ...take("4", 1)],
        left: [...take("5", 1), ...take("6", 1)],
        right: [...take("7", 1), ...take("8", 1)],
      },
    });
    const afterPlay = playCards(
      initial,
      "user",
      [initial.hands.user[0]!.id],
      NOW,
    );
    const afterFirstPass = passTurn(afterPlay, "left", NOW);
    const afterSecondPass = passTurn(afterFirstPass, "right", NOW);

    expect(afterFirstPass.consecutivePasses).toBe(1);
    expect(afterSecondPass.currentTurn).toBe("user");
    expect(afterSecondPass.currentWinningPlay).toBeNull();
    expect(afterSecondPass.consecutivePasses).toBe(0);
    expect(afterSecondPass.history.map(({ action }) => action)).toEqual([
      "play",
      "pass",
      "pass",
    ]);
  });

  it("does not allow the leading player to pass", () => {
    const state = playingState({
      hands: {
        user: take("3", 1),
        left: take("4", 1),
        right: take("5", 1),
      },
    });

    expectRuleError(() => passTurn(state, "user", NOW), "CANNOT_PASS");
  });

  it("finishes with the correct landlord or farmer-team winner", () => {
    const landlordState = playingState({
      hands: {
        user: take("A", 1),
        left: take("3", 1),
        right: take("4", 1),
      },
      landlord: "user",
    });
    const landlordWin = playCards(
      landlordState,
      "user",
      [landlordState.hands.user[0]!.id],
      NOW,
    );

    expect(landlordWin.phase).toBe("finished");
    expect(landlordWin.winner).toBe("landlord");

    const farmerState = playingState({
      hands: {
        user: take("3", 1),
        left: take("A", 1),
        right: take("4", 1),
      },
      landlord: "left",
    });
    const farmerWin = playCards(
      farmerState,
      "user",
      [farmerState.hands.user[0]!.id],
      NOW,
    );

    expect(farmerWin.winner).toBe("farmers");
  });

  it("cycles seats in user-left-right order", () => {
    expect(nextSeat("user")).toBe("left");
    expect(nextSeat("left")).toBe("right");
    expect(nextSeat("right")).toBe("user");
  });
});
