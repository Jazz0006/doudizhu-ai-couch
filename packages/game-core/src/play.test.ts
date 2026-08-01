import { describe, expect, it } from "vitest";

import { createDeck, recognizePlay } from "./index.js";
import type { Card, Rank } from "./index.js";

const deck = createDeck();

function cardsOfRank(rank: Rank): Card[] {
  return deck.filter((card) => card.rank === rank);
}

describe("recognizePlay", () => {
  it("recognizes a standard card or joker as a single", () => {
    expect(recognizePlay(cardsOfRank("3").slice(0, 1))).toMatchObject({
      type: "single",
      primaryRank: "3",
      length: 1,
    });
    expect(recognizePlay(cardsOfRank("big_joker"))).toMatchObject({
      type: "single",
      primaryRank: "big_joker",
      length: 1,
    });
  });

  it("recognizes two standard cards of the same rank as a pair", () => {
    expect(recognizePlay(cardsOfRank("A").slice(0, 2))).toMatchObject({
      type: "pair",
      primaryRank: "A",
      length: 2,
    });
  });

  it("recognizes three standard cards of the same rank as a triple", () => {
    expect(recognizePlay(cardsOfRank("7").slice(0, 3))).toMatchObject({
      type: "triple",
      primaryRank: "7",
      length: 3,
    });
  });

  it("recognizes all four standard cards of one rank as a bomb", () => {
    expect(recognizePlay(cardsOfRank("2"))).toMatchObject({
      type: "bomb",
      primaryRank: "2",
      length: 4,
    });
  });

  it("recognizes the two differently ordered jokers as a rocket", () => {
    const jokers = [...cardsOfRank("big_joker"), ...cardsOfRank("small_joker")];
    const play = recognizePlay(jokers);

    expect(play).toMatchObject({
      type: "rocket",
      primaryRank: "big_joker",
      length: 2,
    });
    expect(play?.cards.map(({ rank }) => rank)).toEqual([
      "small_joker",
      "big_joker",
    ]);
  });

  it("rejects empty, mixed-rank, and malformed combinations", () => {
    expect(recognizePlay([])).toBeNull();
    expect(
      recognizePlay([cardsOfRank("3")[0]!, cardsOfRank("4")[0]!]),
    ).toBeNull();
    expect(
      recognizePlay([
        cardsOfRank("3")[0]!,
        cardsOfRank("4")[0]!,
        cardsOfRank("5")[0]!,
        cardsOfRank("6")[0]!,
        cardsOfRank("8")[0]!,
      ]),
    ).toBeNull();
  });

  it("rejects duplicate physical cards", () => {
    const card = cardsOfRank("K")[0]!;
    const duplicateWithAnotherId = { ...card, id: "duplicate-id" };

    expect(recognizePlay([card, card])).toBeNull();
    expect(recognizePlay([card, duplicateWithAnotherId])).toBeNull();
  });

  it("rejects cards whose stored order disagrees with their rank", () => {
    const card = cardsOfRank("Q")[0]!;

    expect(recognizePlay([{ ...card, order: card.order + 1 }])).toBeNull();
  });

  it("rejects cards whose suit and rank describe an impossible card", () => {
    const card = cardsOfRank("Q")[0]!;
    const joker = cardsOfRank("small_joker")[0]!;

    expect(recognizePlay([{ ...card, suit: "joker" }])).toBeNull();
    expect(recognizePlay([{ ...joker, suit: "spade" }])).toBeNull();
  });
});
