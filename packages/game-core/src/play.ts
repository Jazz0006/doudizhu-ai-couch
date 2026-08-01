import { RANK_ORDER, STANDARD_RANKS, sortCards } from "./card.js";
import type { Card, Rank } from "./card.js";

export const PLAY_TYPES = [
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
] as const;

export type PlayType = (typeof PLAY_TYPES)[number];

export const BASIC_PLAY_TYPES = [
  "single",
  "pair",
  "triple",
  "bomb",
  "rocket",
] as const satisfies readonly PlayType[];

export type BasicPlayType = (typeof BASIC_PLAY_TYPES)[number];

export interface Play {
  readonly cards: Card[];
  readonly type: PlayType;
  readonly primaryRank: Rank;
  readonly length: number;
}

export type BasicPlay = Play & { readonly type: BasicPlayType };

interface RankGroup {
  readonly rank: Rank;
  readonly cards: Card[];
}

const STANDARD_RANK_SET: ReadonlySet<Rank> = new Set(STANDARD_RANKS);
const HIGHEST_SEQUENCE_ORDER = RANK_ORDER.A;

export function recognizePlay(cards: readonly Card[]): Play | null {
  if (cards.length === 0 || !hasUniquePhysicalCards(cards)) {
    return null;
  }

  const sortedCards = sortCards(cards);
  const groups = groupCardsByRank(sortedCards);

  if (sortedCards.length === 1) {
    return createPlay(sortedCards, "single", sortedCards[0]!.rank);
  }

  if (isRocket(sortedCards)) {
    return createPlay(sortedCards, "rocket", "big_joker");
  }

  if (groups.length === 1 && STANDARD_RANK_SET.has(groups[0]!.rank)) {
    const primaryRank = groups[0]!.rank;

    switch (sortedCards.length) {
      case 2:
        return createPlay(sortedCards, "pair", primaryRank);
      case 3:
        return createPlay(sortedCards, "triple", primaryRank);
      case 4:
        return createPlay(sortedCards, "bomb", primaryRank);
    }
  }

  return (
    recognizeTripleWithSingle(sortedCards, groups) ??
    recognizeTripleWithPair(sortedCards, groups) ??
    recognizeStraight(sortedCards, groups) ??
    recognizePairStraight(sortedCards, groups) ??
    recognizeAirplane(sortedCards, groups) ??
    recognizeAirplaneWithSingles(sortedCards, groups) ??
    recognizeAirplaneWithPairs(sortedCards, groups) ??
    recognizeFourWithTwoSingles(sortedCards, groups) ??
    recognizeFourWithTwoPairs(sortedCards, groups)
  );
}

function recognizeTripleWithSingle(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (cards.length !== 4 || !hasGroupSizes(groups, [1, 3])) {
    return null;
  }

  return createPlay(cards, "triple_with_single", groupOfSize(groups, 3)!.rank);
}

function recognizeTripleWithPair(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (cards.length !== 5 || !hasGroupSizes(groups, [2, 3])) {
    return null;
  }

  return createPlay(cards, "triple_with_pair", groupOfSize(groups, 3)!.rank);
}

function recognizeStraight(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (
    cards.length < 5 ||
    groups.length !== cards.length ||
    !groups.every((group) => group.cards.length === 1) ||
    !hasConsecutiveRanks(groups)
  ) {
    return null;
  }

  return createPlay(cards, "straight", highestRank(groups));
}

function recognizePairStraight(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (
    groups.length < 3 ||
    cards.length !== groups.length * 2 ||
    !groups.every((group) => group.cards.length === 2) ||
    !hasConsecutiveRanks(groups)
  ) {
    return null;
  }

  return createPlay(cards, "pair_straight", highestRank(groups));
}

function recognizeAirplane(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (
    groups.length < 2 ||
    cards.length !== groups.length * 3 ||
    !groups.every((group) => group.cards.length === 3) ||
    !hasConsecutiveRanks(groups)
  ) {
    return null;
  }

  return createPlay(cards, "airplane", highestRank(groups));
}

function recognizeAirplaneWithSingles(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (cards.length < 8 || cards.length % 4 !== 0) {
    return null;
  }

  const sequenceLength = cards.length / 4;
  const body = groupsOfSize(groups, 3);
  const wings = groupsOfSize(groups, 1);

  if (
    body.length !== sequenceLength ||
    wings.length !== sequenceLength ||
    groups.length !== body.length + wings.length ||
    !hasConsecutiveRanks(body)
  ) {
    return null;
  }

  return createPlay(cards, "airplane_with_singles", highestRank(body));
}

function recognizeAirplaneWithPairs(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (cards.length < 10 || cards.length % 5 !== 0) {
    return null;
  }

  const sequenceLength = cards.length / 5;
  const body = groupsOfSize(groups, 3);
  const wings = groupsOfSize(groups, 2);

  if (
    body.length !== sequenceLength ||
    wings.length !== sequenceLength ||
    groups.length !== body.length + wings.length ||
    !hasConsecutiveRanks(body)
  ) {
    return null;
  }

  return createPlay(cards, "airplane_with_pairs", highestRank(body));
}

function recognizeFourWithTwoSingles(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (cards.length !== 6 || !hasGroupSizes(groups, [1, 1, 4])) {
    return null;
  }

  return createPlay(
    cards,
    "four_with_two_singles",
    groupOfSize(groups, 4)!.rank,
  );
}

function recognizeFourWithTwoPairs(
  cards: Card[],
  groups: readonly RankGroup[],
): Play | null {
  if (cards.length !== 8 || !hasGroupSizes(groups, [2, 2, 4])) {
    return null;
  }

  return createPlay(cards, "four_with_two_pairs", groupOfSize(groups, 4)!.rank);
}

function createPlay(cards: Card[], type: PlayType, primaryRank: Rank): Play {
  return {
    cards,
    type,
    primaryRank,
    length: cards.length,
  };
}

function groupCardsByRank(cards: readonly Card[]): RankGroup[] {
  const groups = new Map<Rank, Card[]>();

  for (const card of cards) {
    const group = groups.get(card.rank);

    if (group) {
      group.push(card);
    } else {
      groups.set(card.rank, [card]);
    }
  }

  return [...groups].map(([rank, groupedCards]) => ({
    rank,
    cards: groupedCards,
  }));
}

function hasGroupSizes(
  groups: readonly RankGroup[],
  expectedSizes: readonly number[],
): boolean {
  const actualSizes = groups
    .map((group) => group.cards.length)
    .sort((left, right) => left - right);

  return (
    actualSizes.length === expectedSizes.length &&
    actualSizes.every((size, index) => size === expectedSizes[index])
  );
}

function groupOfSize(
  groups: readonly RankGroup[],
  size: number,
): RankGroup | undefined {
  return groups.find((group) => group.cards.length === size);
}

function groupsOfSize(groups: readonly RankGroup[], size: number): RankGroup[] {
  return groups.filter((group) => group.cards.length === size);
}

function hasConsecutiveRanks(groups: readonly RankGroup[]): boolean {
  if (
    groups.length === 0 ||
    groups.some(({ rank }) => RANK_ORDER[rank] > HIGHEST_SEQUENCE_ORDER)
  ) {
    return false;
  }

  return groups.every(
    ({ rank }, index) =>
      index === 0 ||
      RANK_ORDER[rank] === RANK_ORDER[groups[index - 1]!.rank] + 1,
  );
}

function highestRank(groups: readonly RankGroup[]): Rank {
  return groups[groups.length - 1]!.rank;
}

function hasUniquePhysicalCards(cards: readonly Card[]): boolean {
  const ids = new Set<string>();
  const physicalCards = new Set<string>();

  for (const card of cards) {
    const physicalCard = `${card.suit}:${card.rank}`;

    if (
      ids.has(card.id) ||
      physicalCards.has(physicalCard) ||
      card.order !== RANK_ORDER[card.rank] ||
      !hasCanonicalSuit(card)
    ) {
      return false;
    }

    ids.add(card.id);
    physicalCards.add(physicalCard);
  }

  return true;
}

function hasCanonicalSuit(card: Card): boolean {
  const jokerRank = card.rank === "small_joker" || card.rank === "big_joker";

  return jokerRank ? card.suit === "joker" : card.suit !== "joker";
}

function isRocket(cards: readonly Card[]): boolean {
  return (
    cards.length === 2 &&
    cards[0]?.rank === "small_joker" &&
    cards[1]?.rank === "big_joker"
  );
}
