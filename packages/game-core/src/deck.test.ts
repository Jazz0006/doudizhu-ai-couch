import { describe, expect, it } from "vitest";

import {
  BOTTOM_CARD_COUNT,
  DECK_SIZE,
  HAND_SIZE,
  STANDARD_RANKS,
  STANDARD_SUITS,
  createDeck,
  createSeededRandom,
  dealCards,
  shuffleDeck,
} from "./index.js";

describe("createDeck", () => {
  it("creates every standard card plus both jokers exactly once", () => {
    const deck = createDeck();

    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map(({ id }) => id))).toHaveLength(DECK_SIZE);

    for (const rank of STANDARD_RANKS) {
      expect(deck.filter((card) => card.rank === rank)).toHaveLength(
        STANDARD_SUITS.length,
      );
    }

    expect(deck.filter(({ suit }) => suit === "joker")).toEqual([
      expect.objectContaining({ rank: "small_joker" }),
      expect.objectContaining({ rank: "big_joker" }),
    ]);
  });
});

describe("shuffleDeck", () => {
  it("is reproducible with a seed and does not mutate its input", () => {
    const deck = createDeck();
    const originalIds = deck.map(({ id }) => id);
    const first = shuffleDeck(deck, createSeededRandom("game-42"));
    const second = shuffleDeck(deck, createSeededRandom("game-42"));

    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
    expect(first.map(({ id }) => id)).not.toEqual(originalIds);
    expect(deck.map(({ id }) => id)).toEqual(originalIds);
    expect(new Set(first.map(({ id }) => id))).toEqual(new Set(originalIds));
  });

  it("produces different orders for different seeds", () => {
    const deck = createDeck();
    const first = shuffleDeck(deck, createSeededRandom("game-1"));
    const second = shuffleDeck(deck, createSeededRandom("game-2"));

    expect(first.map(({ id }) => id)).not.toEqual(second.map(({ id }) => id));
  });

  it("rejects random sources outside the expected range", () => {
    expect(() => shuffleDeck(createDeck(), () => 1)).toThrow(RangeError);
    expect(() => shuffleDeck(createDeck(), () => -0.1)).toThrow(RangeError);
    expect(() => shuffleDeck(createDeck(), () => Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("dealCards", () => {
  it("deals 17 cards to each seat and leaves three bottom cards", () => {
    const deck = shuffleDeck(createDeck(), createSeededRandom("deal"));
    const deal = dealCards(deck);

    expect(deal.hands.user).toHaveLength(HAND_SIZE);
    expect(deal.hands.left).toHaveLength(HAND_SIZE);
    expect(deal.hands.right).toHaveLength(HAND_SIZE);
    expect(deal.bottomCards).toHaveLength(BOTTOM_CARD_COUNT);

    const dealtCards = [
      ...deal.hands.user,
      ...deal.hands.left,
      ...deal.hands.right,
      ...deal.bottomCards,
    ];

    expect(dealtCards).toHaveLength(DECK_SIZE);
    expect(new Set(dealtCards.map(({ id }) => id))).toHaveLength(DECK_SIZE);
    expect(new Set(dealtCards.map(({ id }) => id))).toEqual(
      new Set(deck.map(({ id }) => id)),
    );
  });

  it("deals round-robin and reserves the final three cards", () => {
    const deck = createDeck();
    const deal = dealCards(deck);

    expect(deal.hands.user[0]).toBe(deck[0]);
    expect(deal.hands.left[0]).toBe(deck[1]);
    expect(deal.hands.right[0]).toBe(deck[2]);
    expect(deal.hands.user[1]).toBe(deck[3]);
    expect(deal.bottomCards).toEqual(deck.slice(-BOTTOM_CARD_COUNT));
  });

  it("rejects incomplete decks and duplicate card IDs", () => {
    const deck = createDeck();

    expect(() => dealCards(deck.slice(0, -1))).toThrow(RangeError);
    expect(() => dealCards([...deck.slice(0, -1), deck[0]!])).toThrow(
      "duplicate card IDs",
    );
  });
});
