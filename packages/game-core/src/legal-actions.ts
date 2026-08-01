import { RANK_ORDER, STANDARD_RANKS, compareCards, sortCards } from "./card.js";
import type { Card, Rank } from "./card.js";
import { canBeatPlay } from "./play-comparison.js";
import { PLAY_TYPES, recognizePlay } from "./play.js";
import type { Play, PlayType } from "./play.js";

const MAX_HAND_SIZE = 20;
const SEQUENCE_RANKS = STANDARD_RANKS.filter(
  (rank) => RANK_ORDER[rank] <= RANK_ORDER.A,
);
const PLAY_TYPE_ORDER = new Map(
  PLAY_TYPES.map((type, index) => [type, index] as const),
);

type RankGroups = ReadonlyMap<Rank, readonly Card[]>;

export function generateLegalPlays(
  hand: readonly Card[],
  currentPlay: Play | null = null,
): Play[] {
  assertValidHand(hand);

  if (hand.length === 0) {
    return [];
  }

  const groups = groupHandByRank(hand);
  const plays = new Map<string, Play>();
  const add = (cards: readonly Card[], expectedType: PlayType): void => {
    const play = recognizePlay(cards);

    if (play?.type !== expectedType) {
      return;
    }

    if (currentPlay !== null && !canBeatPlay(play, currentPlay)) {
      return;
    }

    plays.set(
      play.cards
        .map(({ id }) => id)
        .sort()
        .join("|"),
      play,
    );
  };

  generateSingles(groups, add);
  generateSameRankPlays(groups, 2, "pair", add);
  generateSameRankPlays(groups, 3, "triple", add);
  generateSameRankPlays(groups, 4, "bomb", add);
  generateRocket(groups, add);
  generateAttachedTriples(groups, add);
  generateSequences(groups, 1, 5, "straight", add);
  generateSequences(groups, 2, 3, "pair_straight", add);
  generateAirplanes(groups, add);
  generateFourWithTwo(groups, add);

  return [...plays.values()].sort(compareGeneratedPlays);
}

type AddPlay = (cards: readonly Card[], expectedType: PlayType) => void;

function generateSingles(groups: RankGroups, add: AddPlay): void {
  for (const cards of groups.values()) {
    for (const card of cards) {
      add([card], "single");
    }
  }
}

function generateSameRankPlays(
  groups: RankGroups,
  size: number,
  type: "pair" | "triple" | "bomb",
  add: AddPlay,
): void {
  for (const cards of groups.values()) {
    for (const selection of combinations(cards, size)) {
      add(selection, type);
    }
  }
}

function generateRocket(groups: RankGroups, add: AddPlay): void {
  const smallJoker = groups.get("small_joker")?.[0];
  const bigJoker = groups.get("big_joker")?.[0];

  if (smallJoker && bigJoker) {
    add([smallJoker, bigJoker], "rocket");
  }
}

function generateAttachedTriples(groups: RankGroups, add: AddPlay): void {
  for (const [tripleRank, cards] of groups) {
    for (const triple of combinations(cards, 3)) {
      for (const [wingRank, wingCards] of groups) {
        if (wingRank === tripleRank) {
          continue;
        }

        for (const single of wingCards) {
          add([...triple, single], "triple_with_single");
        }

        for (const pair of combinations(wingCards, 2)) {
          add([...triple, ...pair], "triple_with_pair");
        }
      }
    }
  }
}

function generateSequences(
  groups: RankGroups,
  cardsPerRank: number,
  minimumRanks: number,
  type: "straight" | "pair_straight",
  add: AddPlay,
): void {
  for (const ranks of consecutiveRankWindows(
    groups,
    cardsPerRank,
    minimumRanks,
  )) {
    for (const selection of selectCardsAcrossRanks(
      groups,
      ranks,
      cardsPerRank,
    )) {
      add(selection, type);
    }
  }
}

function generateAirplanes(groups: RankGroups, add: AddPlay): void {
  for (const bodyRanks of consecutiveRankWindows(groups, 3, 2)) {
    const bodySelections = selectCardsAcrossRanks(groups, bodyRanks, 3);
    const wingRanks = [...groups.keys()].filter(
      (rank) => !bodyRanks.includes(rank),
    );

    for (const body of bodySelections) {
      add(body, "airplane");
    }

    for (const selectedWingRanks of combinations(
      wingRanks.filter((rank) => (groups.get(rank)?.length ?? 0) >= 1),
      bodyRanks.length,
    )) {
      const wingSelections = selectCardsAcrossRanks(
        groups,
        selectedWingRanks,
        1,
      );

      for (const body of bodySelections) {
        for (const wings of wingSelections) {
          add([...body, ...wings], "airplane_with_singles");
        }
      }
    }

    for (const selectedWingRanks of combinations(
      wingRanks.filter((rank) => (groups.get(rank)?.length ?? 0) >= 2),
      bodyRanks.length,
    )) {
      const wingSelections = selectCardsAcrossRanks(
        groups,
        selectedWingRanks,
        2,
      );

      for (const body of bodySelections) {
        for (const wings of wingSelections) {
          add([...body, ...wings], "airplane_with_pairs");
        }
      }
    }
  }
}

function generateFourWithTwo(groups: RankGroups, add: AddPlay): void {
  for (const [fourRank, cards] of groups) {
    for (const fourCards of combinations(cards, 4)) {
      const otherRanks = [...groups.keys()].filter((rank) => rank !== fourRank);

      for (const singleRanks of combinations(
        otherRanks.filter((rank) => (groups.get(rank)?.length ?? 0) >= 1),
        2,
      )) {
        for (const wings of selectCardsAcrossRanks(groups, singleRanks, 1)) {
          add([...fourCards, ...wings], "four_with_two_singles");
        }
      }

      for (const pairRanks of combinations(
        otherRanks.filter((rank) => (groups.get(rank)?.length ?? 0) >= 2),
        2,
      )) {
        for (const wings of selectCardsAcrossRanks(groups, pairRanks, 2)) {
          add([...fourCards, ...wings], "four_with_two_pairs");
        }
      }
    }
  }
}

function consecutiveRankWindows(
  groups: RankGroups,
  cardsPerRank: number,
  minimumRanks: number,
): Rank[][] {
  const windows: Rank[][] = [];

  for (let start = 0; start < SEQUENCE_RANKS.length; start += 1) {
    const ranks: Rank[] = [];

    for (let end = start; end < SEQUENCE_RANKS.length; end += 1) {
      const rank = SEQUENCE_RANKS[end]!;

      if ((groups.get(rank)?.length ?? 0) < cardsPerRank) {
        break;
      }

      ranks.push(rank);

      if (ranks.length >= minimumRanks) {
        windows.push([...ranks]);
      }
    }
  }

  return windows;
}

function selectCardsAcrossRanks(
  groups: RankGroups,
  ranks: readonly Rank[],
  cardsPerRank: number,
): Card[][] {
  const selectionsByRank = ranks.map((rank) =>
    combinations(groups.get(rank) ?? [], cardsPerRank),
  );

  return cartesianProduct(selectionsByRank).map((selection) =>
    selection.flat(),
  );
}

function combinations<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) {
    return [[]];
  }

  if (size < 0 || size > values.length) {
    return [];
  }

  const results: T[][] = [];

  function visit(start: number, selected: T[]): void {
    if (selected.length === size) {
      results.push([...selected]);
      return;
    }

    const remainingNeeded = size - selected.length;

    for (
      let index = start;
      index <= values.length - remainingNeeded;
      index += 1
    ) {
      selected.push(values[index]!);
      visit(index + 1, selected);
      selected.pop();
    }
  }

  visit(0, []);
  return results;
}

function cartesianProduct<T>(groups: readonly (readonly T[])[]): T[][] {
  return groups.reduce<T[][]>(
    (products, group) =>
      products.flatMap((product) => group.map((value) => [...product, value])),
    [[]],
  );
}

function groupHandByRank(hand: readonly Card[]): RankGroups {
  const groups = new Map<Rank, Card[]>();

  for (const card of sortCards(hand)) {
    const group = groups.get(card.rank);

    if (group) {
      group.push(card);
    } else {
      groups.set(card.rank, [card]);
    }
  }

  return groups;
}

function assertValidHand(hand: readonly Card[]): void {
  if (hand.length > MAX_HAND_SIZE) {
    throw new RangeError(
      `A hand cannot contain more than ${MAX_HAND_SIZE} cards`,
    );
  }

  const ids = new Set<string>();
  const physicalCards = new Set<string>();

  for (const card of hand) {
    const physicalCard = `${card.suit}:${card.rank}`;

    if (
      ids.has(card.id) ||
      physicalCards.has(physicalCard) ||
      recognizePlay([card]) === null
    ) {
      throw new Error("A hand must contain unique, valid cards");
    }

    ids.add(card.id);
    physicalCards.add(physicalCard);
  }
}

function compareGeneratedPlays(left: Play, right: Play): number {
  return (
    PLAY_TYPE_ORDER.get(left.type)! - PLAY_TYPE_ORDER.get(right.type)! ||
    left.length - right.length ||
    RANK_ORDER[left.primaryRank] - RANK_ORDER[right.primaryRank] ||
    compareCardIds(left.cards, right.cards)
  );
}

function compareCardIds(left: readonly Card[], right: readonly Card[]): number {
  const leftCards = [...left].sort(compareCards);
  const rightCards = [...right].sort(compareCards);

  return leftCards
    .map(({ id }) => id)
    .join("|")
    .localeCompare(rightCards.map(({ id }) => id).join("|"));
}
