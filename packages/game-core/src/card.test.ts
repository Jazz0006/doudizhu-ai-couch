import { describe, expect, it } from "vitest";

import { RANK_ORDER, compareCards, createDeck, sortCards } from "./index.js";

describe("card model", () => {
  it("orders ranks from 3 through the big joker", () => {
    expect(RANK_ORDER["3"]).toBe(0);
    expect(RANK_ORDER["2"]).toBe(12);
    expect(RANK_ORDER.small_joker).toBe(13);
    expect(RANK_ORDER.big_joker).toBe(14);
  });

  it("sorts by rank and then by a stable suit order", () => {
    const deck = createDeck();
    const selected = [
      deck.find(({ id }) => id === "joker-big"),
      deck.find(({ id }) => id === "heart-3"),
      deck.find(({ id }) => id === "spade-3"),
      deck.find(({ id }) => id === "diamond-2"),
    ];

    expect(selected.every((card) => card !== undefined)).toBe(true);

    const cards = selected.filter((card) => card !== undefined);
    const sorted = sortCards(cards);

    expect(sorted.map(({ id }) => id)).toEqual([
      "spade-3",
      "heart-3",
      "diamond-2",
      "joker-big",
    ]);
    expect(cards.map(({ id }) => id)).toEqual([
      "joker-big",
      "heart-3",
      "spade-3",
      "diamond-2",
    ]);
  });

  it("compares equal-rank cards deterministically", () => {
    const [spade, heart] = createDeck().filter(({ rank }) => rank === "A");

    expect(spade).toBeDefined();
    expect(heart).toBeDefined();
    expect(compareCards(spade!, heart!)).toBeLessThan(0);
  });
});
