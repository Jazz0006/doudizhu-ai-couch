import { describe, expect, it } from "vitest";

import { createDeck, recognizePlay } from "./index.js";
import type { Card, PlayType, Rank } from "./index.js";

const deck = createDeck();

function take(rank: Rank, count: number): Card[] {
  return deck.filter((card) => card.rank === rank).slice(0, count);
}

function expectPlay(cards: Card[], type: PlayType, primaryRank: Rank): void {
  expect(recognizePlay(cards)).toMatchObject({
    type,
    primaryRank,
    length: cards.length,
  });
}

describe("attached triple combinations", () => {
  it("recognizes a triple with one single", () => {
    expectPlay(
      [...take("7", 3), ...take("small_joker", 1)],
      "triple_with_single",
      "7",
    );
  });

  it("recognizes a triple with one pair", () => {
    expectPlay([...take("9", 3), ...take("K", 2)], "triple_with_pair", "9");
  });

  it("does not confuse a bomb or unrelated cards with an attached triple", () => {
    expect(recognizePlay([...take("8", 4), ...take("9", 1)])).toBeNull();
    expect(
      recognizePlay([...take("8", 2), ...take("9", 2), ...take("10", 1)]),
    ).toBeNull();
  });
});

describe("straight", () => {
  it("recognizes the minimum and maximum valid boundaries", () => {
    expectPlay(
      ["3", "4", "5", "6", "7"].flatMap((rank) => take(rank as Rank, 1)),
      "straight",
      "7",
    );
    expectPlay(
      ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].flatMap(
        (rank) => take(rank as Rank, 1),
      ),
      "straight",
      "A",
    );
  });

  it("rejects short, gapped, duplicated, or rank-2 straights", () => {
    expect(
      recognizePlay(
        ["3", "4", "5", "6"].flatMap((rank) => take(rank as Rank, 1)),
      ),
    ).toBeNull();
    expect(
      recognizePlay(
        ["3", "4", "6", "7", "8"].flatMap((rank) => take(rank as Rank, 1)),
      ),
    ).toBeNull();
    expect(
      recognizePlay([
        ...take("3", 2),
        ...take("4", 1),
        ...take("5", 1),
        ...take("6", 1),
      ]),
    ).toBeNull();
    expect(
      recognizePlay(
        ["10", "J", "Q", "K", "A", "2"].flatMap((rank) =>
          take(rank as Rank, 1),
        ),
      ),
    ).toBeNull();
  });
});

describe("pair straight", () => {
  it("recognizes three or more consecutive pairs", () => {
    expectPlay(
      ["4", "5", "6"].flatMap((rank) => take(rank as Rank, 2)),
      "pair_straight",
      "6",
    );
  });

  it("rejects two pairs, gaps, and sequences containing 2", () => {
    expect(
      recognizePlay(["3", "4"].flatMap((rank) => take(rank as Rank, 2))),
    ).toBeNull();
    expect(
      recognizePlay(["3", "5", "6"].flatMap((rank) => take(rank as Rank, 2))),
    ).toBeNull();
    expect(
      recognizePlay(
        ["Q", "K", "A", "2"].flatMap((rank) => take(rank as Rank, 2)),
      ),
    ).toBeNull();
  });
});

describe("airplane", () => {
  it("recognizes consecutive triples without wings", () => {
    expectPlay(
      [...take("6", 3), ...take("7", 3), ...take("8", 3)],
      "airplane",
      "8",
    );
  });

  it("recognizes an airplane with distinct single wings", () => {
    expectPlay(
      [...take("6", 3), ...take("7", 3), ...take("K", 1), ...take("A", 1)],
      "airplane_with_singles",
      "7",
    );
  });

  it("recognizes an airplane with distinct pair wings", () => {
    expectPlay(
      [...take("9", 3), ...take("10", 3), ...take("3", 2), ...take("4", 2)],
      "airplane_with_pairs",
      "10",
    );
  });

  it("rejects a body containing 2 and malformed wings", () => {
    expect(recognizePlay([...take("A", 3), ...take("2", 3)])).toBeNull();
    expect(
      recognizePlay([...take("6", 3), ...take("7", 3), ...take("K", 2)]),
    ).toBeNull();
    expect(
      recognizePlay([
        ...take("6", 3),
        ...take("7", 3),
        ...take("K", 2),
        ...take("A", 1),
        ...take("2", 1),
      ]),
    ).toBeNull();
  });
});

describe("four with two", () => {
  it("recognizes four with two distinct singles", () => {
    expectPlay(
      [...take("J", 4), ...take("3", 1), ...take("big_joker", 1)],
      "four_with_two_singles",
      "J",
    );
  });

  it("recognizes four with two distinct pairs", () => {
    expectPlay(
      [...take("Q", 4), ...take("3", 2), ...take("4", 2)],
      "four_with_two_pairs",
      "Q",
    );
  });

  it("rejects a pair as two single wings and malformed pair wings", () => {
    expect(recognizePlay([...take("J", 4), ...take("3", 2)])).toBeNull();
    expect(
      recognizePlay([
        ...take("Q", 4),
        ...take("3", 2),
        ...take("4", 1),
        ...take("5", 1),
      ]),
    ).toBeNull();
  });
});
