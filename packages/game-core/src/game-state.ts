import { PLAYING_SEATS, sortCards } from "./card.js";
import type { Card, Seat } from "./card.js";
import { createDeck, dealCards, shuffleDeck } from "./deck.js";
import { canBeatPlay } from "./play-comparison.js";
import { recognizePlay } from "./play.js";
import type { Play } from "./play.js";
import { createSeededRandom } from "./random.js";

export type GamePhase = "dealing" | "bidding" | "playing" | "finished";
export type Role = "landlord" | "farmer";
export type Winner = "landlord" | "farmers";
export type Bid = 0 | 1 | 2 | 3;

export interface BidRecord {
  readonly dealNumber: number;
  readonly seat: Seat;
  readonly bid: Bid;
  readonly timestamp: string;
}

export interface PlayRecord {
  readonly index: number;
  readonly seat: Seat;
  readonly action: "play" | "pass";
  readonly play: Play | null;
  readonly timestamp: string;
}

export interface FullGameState {
  readonly gameId: string;
  readonly phase: GamePhase;
  readonly hands: Record<Seat, Card[]>;
  readonly bottomCards: Card[];
  readonly landlord: Seat | null;
  readonly roles: Record<Seat, Role | null>;
  readonly currentTurn: Seat;
  readonly firstBidder: Seat;
  readonly highestBid: Bid;
  readonly highestBidder: Seat | null;
  readonly biddingHistory: BidRecord[];
  readonly dealNumber: number;
  readonly trickLeader: Seat | null;
  readonly currentWinningPlay: Play | null;
  readonly consecutivePasses: number;
  readonly history: PlayRecord[];
  readonly winner: Winner | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly randomSeed: string;
}

export interface StartGameOptions {
  readonly gameId: string;
  readonly randomSeed?: string | number;
  readonly firstBidder?: Seat;
  readonly now?: string;
}

export type GameRuleErrorCode =
  | "INVALID_PHASE"
  | "NOT_CURRENT_TURN"
  | "INVALID_BID"
  | "DUPLICATE_CARD_SELECTION"
  | "CARD_NOT_IN_HAND"
  | "INVALID_PLAY"
  | "PLAY_DOES_NOT_BEAT"
  | "CANNOT_PASS";

export class GameRuleError extends Error {
  readonly code: GameRuleErrorCode;

  constructor(code: GameRuleErrorCode, message: string) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}

const VALID_BIDS: readonly Bid[] = [0, 1, 2, 3];

export function createGame(options: StartGameOptions): FullGameState {
  if (options.gameId.trim().length === 0) {
    throw new Error("gameId cannot be empty");
  }

  const timestamp = resolveTimestamp(options.now);
  const randomSeed = String(
    options.randomSeed ?? `${Date.now()}-${Math.random()}`,
  );
  const firstBidder = options.firstBidder ?? "user";
  const { hands, bottomCards } = createDeal(randomSeed, 1);

  return {
    gameId: options.gameId,
    phase: "bidding",
    hands,
    bottomCards,
    landlord: null,
    roles: emptyRoles(),
    currentTurn: firstBidder,
    firstBidder,
    highestBid: 0,
    highestBidder: null,
    biddingHistory: [],
    dealNumber: 1,
    trickLeader: null,
    currentWinningPlay: null,
    consecutivePasses: 0,
    history: [],
    winner: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    randomSeed,
  };
}

export function submitBid(
  state: FullGameState,
  seat: Seat,
  bid: Bid,
  now?: string,
): FullGameState {
  assertPhase(state, "bidding");
  assertCurrentTurn(state, seat);

  if (!VALID_BIDS.includes(bid) || (bid !== 0 && bid <= state.highestBid)) {
    throw new GameRuleError(
      "INVALID_BID",
      "A bid must be pass or higher than the current highest bid",
    );
  }

  const timestamp = resolveTimestamp(now);
  const biddingHistory = [
    ...state.biddingHistory,
    { dealNumber: state.dealNumber, seat, bid, timestamp },
  ];
  const highestBid = bid > state.highestBid ? bid : state.highestBid;
  const highestBidder = bid > state.highestBid ? seat : state.highestBidder;
  const bidsThisDeal = biddingHistory.filter(
    (record) => record.dealNumber === state.dealNumber,
  ).length;

  if (bid === 3 || bidsThisDeal === PLAYING_SEATS.length) {
    if (highestBidder) {
      return assignLandlord(
        {
          ...state,
          highestBid,
          highestBidder,
          biddingHistory,
          updatedAt: timestamp,
        },
        highestBidder,
      );
    }

    return redealAfterAllPasses(
      { ...state, biddingHistory, updatedAt: timestamp },
      timestamp,
    );
  }

  return {
    ...state,
    currentTurn: nextSeat(seat),
    highestBid,
    highestBidder,
    biddingHistory,
    updatedAt: timestamp,
  };
}

export function playCards(
  state: FullGameState,
  seat: Seat,
  cardIds: readonly string[],
  now?: string,
): FullGameState {
  assertPhase(state, "playing");
  assertCurrentTurn(state, seat);

  if (cardIds.length === 0) {
    throw new GameRuleError("INVALID_PLAY", "At least one card is required");
  }

  const selectedIds = new Set(cardIds);

  if (selectedIds.size !== cardIds.length) {
    throw new GameRuleError(
      "DUPLICATE_CARD_SELECTION",
      "A card cannot be selected more than once",
    );
  }

  const hand = state.hands[seat];
  const selectedCards = hand.filter(({ id }) => selectedIds.has(id));

  if (selectedCards.length !== cardIds.length) {
    throw new GameRuleError(
      "CARD_NOT_IN_HAND",
      "Every selected card must belong to the current player",
    );
  }

  const play = recognizePlay(selectedCards);

  if (!play) {
    throw new GameRuleError(
      "INVALID_PLAY",
      "Selected cards are not a legal play",
    );
  }

  if (
    state.currentWinningPlay &&
    !canBeatPlay(play, state.currentWinningPlay)
  ) {
    throw new GameRuleError(
      "PLAY_DOES_NOT_BEAT",
      "Selected cards do not beat the current winning play",
    );
  }

  const timestamp = resolveTimestamp(now);
  const remainingHand = hand.filter(({ id }) => !selectedIds.has(id));
  const hands = { ...state.hands, [seat]: remainingHand };
  const history = appendPlayRecord(state, seat, "play", play, timestamp);

  if (remainingHand.length === 0) {
    return {
      ...state,
      phase: "finished",
      hands,
      currentWinningPlay: play,
      trickLeader: seat,
      consecutivePasses: 0,
      history,
      winner: seat === state.landlord ? "landlord" : "farmers",
      updatedAt: timestamp,
    };
  }

  return {
    ...state,
    hands,
    currentTurn: nextSeat(seat),
    currentWinningPlay: play,
    trickLeader: seat,
    consecutivePasses: 0,
    history,
    updatedAt: timestamp,
  };
}

export function passTurn(
  state: FullGameState,
  seat: Seat,
  now?: string,
): FullGameState {
  assertPhase(state, "playing");
  assertCurrentTurn(state, seat);

  if (!state.currentWinningPlay || !state.trickLeader) {
    throw new GameRuleError(
      "CANNOT_PASS",
      "The leading player must play at least one card",
    );
  }

  const timestamp = resolveTimestamp(now);
  const history = appendPlayRecord(state, seat, "pass", null, timestamp);
  const consecutivePasses = state.consecutivePasses + 1;

  if (consecutivePasses === 2) {
    return {
      ...state,
      currentTurn: state.trickLeader,
      currentWinningPlay: null,
      consecutivePasses: 0,
      history,
      updatedAt: timestamp,
    };
  }

  return {
    ...state,
    currentTurn: nextSeat(seat),
    consecutivePasses,
    history,
    updatedAt: timestamp,
  };
}

export function nextSeat(seat: Seat): Seat {
  const index = PLAYING_SEATS.indexOf(seat);
  return PLAYING_SEATS[(index + 1) % PLAYING_SEATS.length]!;
}

function assignLandlord(state: FullGameState, landlord: Seat): FullGameState {
  const hands = {
    ...state.hands,
    [landlord]: sortCards([...state.hands[landlord], ...state.bottomCards]),
  };
  const roles: Record<Seat, Role> = {
    user: landlord === "user" ? "landlord" : "farmer",
    left: landlord === "left" ? "landlord" : "farmer",
    right: landlord === "right" ? "landlord" : "farmer",
  };

  return {
    ...state,
    phase: "playing",
    hands,
    landlord,
    roles,
    currentTurn: landlord,
    trickLeader: landlord,
    currentWinningPlay: null,
    consecutivePasses: 0,
  };
}

function redealAfterAllPasses(
  state: FullGameState,
  timestamp: string,
): FullGameState {
  const dealNumber = state.dealNumber + 1;
  const firstBidder = nextSeat(state.firstBidder);
  const { hands, bottomCards } = createDeal(state.randomSeed, dealNumber);

  return {
    ...state,
    hands,
    bottomCards,
    currentTurn: firstBidder,
    firstBidder,
    highestBid: 0,
    highestBidder: null,
    dealNumber,
    updatedAt: timestamp,
  };
}

function createDeal(
  randomSeed: string,
  dealNumber: number,
): Pick<FullGameState, "hands" | "bottomCards"> {
  const deck = shuffleDeck(
    createDeck(),
    createSeededRandom(`${randomSeed}:deal:${dealNumber}`),
  );
  const { hands, bottomCards } = dealCards(deck);

  return {
    hands: {
      user: sortCards(hands.user),
      left: sortCards(hands.left),
      right: sortCards(hands.right),
    },
    bottomCards: [...bottomCards],
  };
}

function emptyRoles(): Record<Seat, null> {
  return { user: null, left: null, right: null };
}

function appendPlayRecord(
  state: FullGameState,
  seat: Seat,
  action: PlayRecord["action"],
  play: Play | null,
  timestamp: string,
): PlayRecord[] {
  return [
    ...state.history,
    {
      index: state.history.length,
      seat,
      action,
      play,
      timestamp,
    },
  ];
}

function assertPhase(state: FullGameState, phase: GamePhase): void {
  if (state.phase !== phase) {
    throw new GameRuleError(
      "INVALID_PHASE",
      `Action requires the ${phase} phase`,
    );
  }
}

function assertCurrentTurn(state: FullGameState, seat: Seat): void {
  if (state.currentTurn !== seat) {
    throw new GameRuleError(
      "NOT_CURRENT_TURN",
      `It is ${state.currentTurn}'s turn`,
    );
  }
}

function resolveTimestamp(timestamp?: string): string {
  return timestamp ?? new Date().toISOString();
}
