import { describe, expect, it } from "vitest";

import {
  canBeatPlay,
  comparePlays,
  createDeck,
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

describe("comparePlays", () => {
  it("compares matching basic types by their primary rank", () => {
    const low = play(take("9", 2));
    const high = play(take("J", 2));

    expect(comparePlays(high, low)).toBe(1);
    expect(comparePlays(low, high)).toBe(-1);
    expect(canBeatPlay(high, low)).toBe(true);
  });

  it("requires matching types and lengths for ordinary plays", () => {
    const pair = play(take("9", 2));
    const triple = play(take("10", 3));
    const shortStraight = play(
      ["3", "4", "5", "6", "7"].flatMap((rank) => take(rank as Rank, 1)),
    );
    const longStraight = play(
      ["4", "5", "6", "7", "8", "9"].flatMap((rank) => take(rank as Rank, 1)),
    );

    expect(comparePlays(triple, pair)).toBeNull();
    expect(comparePlays(longStraight, shortStraight)).toBeNull();
  });

  it("compares equal-length sequences by the highest body rank", () => {
    const low = play(
      ["3", "4", "5", "6", "7"].flatMap((rank) => take(rank as Rank, 1)),
    );
    const high = play(
      ["4", "5", "6", "7", "8"].flatMap((rank) => take(rank as Rank, 1)),
    );

    expect(comparePlays(high, low)).toBe(1);
  });

  it("applies bomb and rocket overrides", () => {
    const straight = play(
      ["8", "9", "10", "J", "Q"].flatMap((rank) => take(rank as Rank, 1)),
    );
    const lowBomb = play(take("4", 4));
    const highBomb = play(take("A", 4));
    const rocket = play([...take("small_joker", 1), ...take("big_joker", 1)]);

    expect(canBeatPlay(lowBomb, straight)).toBe(true);
    expect(canBeatPlay(highBomb, lowBomb)).toBe(true);
    expect(canBeatPlay(rocket, highBomb)).toBe(true);
    expect(canBeatPlay(highBomb, rocket)).toBe(false);
    expect(comparePlays(rocket, rocket)).toBe(0);
  });
});
