export const STANDARD_SUITS = ["spade", "heart", "club", "diamond"] as const;
export const SUITS = [...STANDARD_SUITS, "joker"] as const;

export type Suit = (typeof SUITS)[number];

export const STANDARD_RANKS = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
] as const;

export const RANKS = [...STANDARD_RANKS, "small_joker", "big_joker"] as const;

export type Rank = (typeof RANKS)[number];

export const PLAYING_SEATS = ["user", "left", "right"] as const;

export type Seat = (typeof PLAYING_SEATS)[number];

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
  readonly order: number;
}

export const RANK_ORDER: Readonly<Record<Rank, number>> = Object.freeze(
  Object.fromEntries(RANKS.map((rank, index) => [rank, index])) as Record<
    Rank,
    number
  >,
);

const SUIT_ORDER: Readonly<Record<Suit, number>> = Object.freeze(
  Object.fromEntries(SUITS.map((suit, index) => [suit, index])) as Record<
    Suit,
    number
  >,
);

export function compareCards(left: Card, right: Card): number {
  const rankDifference = left.order - right.order;

  if (rankDifference !== 0) {
    return rankDifference;
  }

  return SUIT_ORDER[left.suit] - SUIT_ORDER[right.suit];
}

export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}
