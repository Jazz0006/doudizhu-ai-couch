import { describe, expect, it } from "vitest";

import { createDeck } from "@ai-doudizhu/game-core";

import { selectionForRange } from "./CardFan";

const cards = createDeck().slice(0, 6);

describe("selectionForRange", () => {
  it("selects a continuous range in either direction", () => {
    expect(selectionForRange(cards, new Set(), 1, 4, true)).toEqual(
      cards.slice(1, 5).map(({ id }) => id),
    );
    expect(selectionForRange(cards, new Set(), 4, 1, true)).toEqual(
      cards.slice(1, 5).map(({ id }) => id),
    );
  });

  it("removes a range while preserving selection outside it", () => {
    const allSelected = new Set(cards.map(({ id }) => id));

    expect(selectionForRange(cards, allSelected, 1, 4, false)).toEqual([
      cards[0]!.id,
      cards[5]!.id,
    ]);
  });

  it("preserves existing cards when adding another range", () => {
    const baseline = new Set([cards[0]!.id, cards[5]!.id]);

    expect(selectionForRange(cards, baseline, 2, 3, true)).toEqual([
      cards[0]!.id,
      cards[2]!.id,
      cards[3]!.id,
      cards[5]!.id,
    ]);
  });
});
