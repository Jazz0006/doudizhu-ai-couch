import { describe, expect, it } from "vitest";

import {
  canBeatPlay,
  createDeck,
  generateLegalPlays,
  recognizePlay,
} from "./index.js";
import type { Card, Play, Rank } from "./index.js";

const deck = createDeck();

function take(rank: Rank, count: number): Card[] {
  return deck.filter((card) => card.rank === rank).slice(0, count);
}

function play(cards: Card[]): Play {
  const recognized = recognizePlay(cards);

  if (!recognized) {
    throw new Error("Test fixture is not a play");
  }

  return recognized;
}

describe("generateLegalPlays", () => {
  it("generates valid, unique actions that only use cards from the hand", () => {
    const hand = [
      ...take("3", 4),
      ...take("4", 3),
      ...take("5", 2),
      ...take("6", 2),
      ...take("7", 1),
      ...take("8", 1),
      ...take("small_joker", 1),
      ...take("big_joker", 1),
    ];
    const originalIds = hand.map(({ id }) => id);
    const actions = generateLegalPlays(hand);
    const handIds = new Set(originalIds);
    const actionKeys = actions.map((action) =>
      action.cards
        .map(({ id }) => id)
        .sort()
        .join("|"),
    );

    expect(new Set(actionKeys).size).toBe(actions.length);
    expect(
      actions.every(
        (action) =>
          recognizePlay(action.cards)?.type === action.type &&
          action.cards.every(({ id }) => handIds.has(id)),
      ),
    ).toBe(true);
    expect(new Set(actions.map(({ type }) => type))).toEqual(
      new Set([
        "single",
        "pair",
        "triple",
        "triple_with_single",
        "triple_with_pair",
        "straight",
        "pair_straight",
        "airplane",
        "airplane_with_singles",
        "airplane_with_pairs",
        "four_with_two_singles",
        "four_with_two_pairs",
        "bomb",
        "rocket",
      ]),
    );
    expect(hand.map(({ id }) => id)).toEqual(originalIds);
  });

  it("generates every physical pair available from four cards", () => {
    const actions = generateLegalPlays(take("9", 4));
    const pairs = actions.filter(({ type }) => type === "pair");

    expect(pairs).toHaveLength(6);
  });

  it("only returns actions that beat the current play", () => {
    const hand = [
      ...take("3", 2),
      ...take("J", 2),
      ...take("Q", 4),
      ...take("small_joker", 1),
      ...take("big_joker", 1),
    ];
    const current = play(take("10", 2));
    const actions = generateLegalPlays(hand, current);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => canBeatPlay(action, current))).toBe(true);
    expect(new Set(actions.map(({ type }) => type))).toEqual(
      new Set(["pair", "bomb", "rocket"]),
    );
  });

  it("returns no response to a rocket", () => {
    const current = play([...take("small_joker", 1), ...take("big_joker", 1)]);

    expect(generateLegalPlays(take("A", 4), current)).toEqual([]);
  });

  it("rejects duplicate, invalid, and oversized hands", () => {
    const card = take("3", 1)[0]!;

    expect(() => generateLegalPlays([card, card])).toThrow(
      "unique, valid cards",
    );
    expect(() =>
      generateLegalPlays([{ ...card, order: card.order + 1 }]),
    ).toThrow("unique, valid cards");
    expect(() => generateLegalPlays(deck.slice(0, 21))).toThrow(RangeError);
  });
});
