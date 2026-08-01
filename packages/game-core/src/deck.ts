import {
  PLAYING_SEATS,
  RANK_ORDER,
  STANDARD_RANKS,
  STANDARD_SUITS,
} from "./card.js";
import type { Card, Seat } from "./card.js";
import type { RandomSource } from "./random.js";

export const DECK_SIZE = 54;
export const HAND_SIZE = 17;
export const BOTTOM_CARD_COUNT = 3;

export interface DealResult {
  readonly hands: Record<Seat, Card[]>;
  readonly bottomCards: Card[];
}

export function createDeck(): Card[] {
  const standardCards = STANDARD_RANKS.flatMap((rank) =>
    STANDARD_SUITS.map((suit): Card => ({
      id: `${suit}-${rank}`,
      suit,
      rank,
      order: RANK_ORDER[rank],
    })),
  );

  return [
    ...standardCards,
    {
      id: "joker-small",
      suit: "joker",
      rank: "small_joker",
      order: RANK_ORDER.small_joker,
    },
    {
      id: "joker-big",
      suit: "joker",
      rank: "big_joker",
      order: RANK_ORDER.big_joker,
    },
  ];
}

export function shuffleDeck(
  cards: readonly Card[],
  random: RandomSource = Math.random,
): Card[] {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomValue = random();

    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError("Random source must return a value in [0, 1)");
    }

    const randomIndex = Math.floor(randomValue * (index + 1));

    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex] as Card,
      shuffled[index] as Card,
    ];
  }

  return shuffled;
}

export function dealCards(deck: readonly Card[]): DealResult {
  assertValidDeck(deck);

  const hands: Record<Seat, Card[]> = {
    user: [],
    left: [],
    right: [],
  };
  const dealtCardCount = DECK_SIZE - BOTTOM_CARD_COUNT;

  for (let index = 0; index < dealtCardCount; index += 1) {
    const seat = PLAYING_SEATS[index % PLAYING_SEATS.length] as Seat;
    hands[seat].push(deck[index] as Card);
  }

  return {
    hands,
    bottomCards: deck.slice(dealtCardCount),
  };
}

function assertValidDeck(deck: readonly Card[]): void {
  if (deck.length !== DECK_SIZE) {
    throw new RangeError(`A deck must contain exactly ${DECK_SIZE} cards`);
  }

  const uniqueIds = new Set(deck.map(({ id }) => id));

  if (uniqueIds.size !== DECK_SIZE) {
    throw new Error("A deck cannot contain duplicate card IDs");
  }
}
