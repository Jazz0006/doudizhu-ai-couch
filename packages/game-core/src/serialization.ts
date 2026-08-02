import { createGame, passTurn, playCards, submitBid } from "./game-state.js";
import type { Seat } from "./card.js";
import type { Bid, FullGameState, GamePhase, Winner } from "./game-state.js";

export const GAME_STATE_SCHEMA_VERSION = 1 as const;

export interface SerializedBidAction {
  readonly seat: Seat;
  readonly bid: Bid;
  readonly timestamp: string;
}

export type SerializedPlayAction =
  | {
      readonly type: "play";
      readonly seat: Seat;
      readonly cardIds: string[];
      readonly timestamp: string;
    }
  | {
      readonly type: "pass";
      readonly seat: Seat;
      readonly timestamp: string;
    };

export interface SerializedGameState {
  readonly schemaVersion: typeof GAME_STATE_SCHEMA_VERSION;
  readonly gameId: string;
  readonly randomSeed: string;
  readonly firstBidder: Seat;
  readonly createdAt: string;
  readonly bids: SerializedBidAction[];
  readonly actions: SerializedPlayAction[];
  readonly expected: {
    readonly phase: GamePhase;
    readonly currentTurn: Seat;
    readonly dealNumber: number;
    readonly historyLength: number;
    readonly updatedAt: string;
    readonly winner: Winner | null;
  };
}

export interface ReplayedGameAction {
  readonly index: number;
  readonly before: FullGameState;
  readonly action: SerializedPlayAction;
  readonly after: FullGameState;
}

export function serializeGameState(state: FullGameState): SerializedGameState {
  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    gameId: state.gameId,
    randomSeed: state.randomSeed,
    firstBidder: state.biddingHistory[0]?.seat ?? state.firstBidder,
    createdAt: state.createdAt,
    bids: state.biddingHistory.map(({ seat, bid, timestamp }) => ({
      seat,
      bid,
      timestamp,
    })),
    actions: state.history.map((record) =>
      record.action === "pass"
        ? { type: "pass", seat: record.seat, timestamp: record.timestamp }
        : {
            type: "play",
            seat: record.seat,
            cardIds: record.play!.cards.map(({ id }) => id),
            timestamp: record.timestamp,
          },
    ),
    expected: {
      phase: state.phase,
      currentTurn: state.currentTurn,
      dealNumber: state.dealNumber,
      historyLength: state.history.length,
      updatedAt: state.updatedAt,
      winner: state.winner,
    },
  };
}

export function restoreGameState(value: unknown): FullGameState {
  const serialized = parseSerializedGameState(value);
  let state = createGame({
    gameId: serialized.gameId,
    randomSeed: serialized.randomSeed,
    firstBidder: serialized.firstBidder,
    now: serialized.createdAt,
  });
  for (const action of serialized.bids) {
    state = submitBid(state, action.seat, action.bid, action.timestamp);
  }
  for (const action of serialized.actions) {
    state = applySerializedAction(state, action);
  }
  assertExpectedState(state, serialized);
  return state;
}

export function replayGameActions(state: FullGameState): ReplayedGameAction[] {
  const serialized = serializeGameState(state);
  let replayed = createGame({
    gameId: serialized.gameId,
    randomSeed: serialized.randomSeed,
    firstBidder: serialized.firstBidder,
    now: serialized.createdAt,
  });
  for (const bid of serialized.bids) {
    replayed = submitBid(replayed, bid.seat, bid.bid, bid.timestamp);
  }
  const timeline: ReplayedGameAction[] = [];
  for (const [index, action] of serialized.actions.entries()) {
    const before = replayed;
    replayed = applySerializedAction(replayed, action);
    timeline.push({ index, before, action, after: replayed });
  }
  assertExpectedState(replayed, serialized);
  return timeline;
}

function applySerializedAction(
  state: FullGameState,
  action: SerializedPlayAction,
): FullGameState {
  return action.type === "pass"
    ? passTurn(state, action.seat, action.timestamp)
    : playCards(state, action.seat, action.cardIds, action.timestamp);
}

function parseSerializedGameState(value: unknown): SerializedGameState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== GAME_STATE_SCHEMA_VERSION ||
    typeof value.gameId !== "string" ||
    value.gameId.length === 0 ||
    value.gameId.length > 200 ||
    typeof value.randomSeed !== "string" ||
    value.randomSeed.length > 500 ||
    !isSeat(value.firstBidder) ||
    !isTimestamp(value.createdAt) ||
    !Array.isArray(value.bids) ||
    !Array.isArray(value.actions) ||
    !isRecord(value.expected)
  ) {
    throw new Error("Saved game has an invalid schema");
  }
  if (value.bids.length > 100 || value.actions.length > 1_000) {
    throw new Error("Saved game history is too large");
  }
  const bids = value.bids.map(parseBidAction);
  const actions = value.actions.map(parsePlayAction);
  const expected = value.expected;
  if (
    !isPhase(expected.phase) ||
    !isSeat(expected.currentTurn) ||
    !isPositiveInteger(expected.dealNumber) ||
    !isNonNegativeInteger(expected.historyLength) ||
    !isTimestamp(expected.updatedAt) ||
    (expected.winner !== null &&
      expected.winner !== "landlord" &&
      expected.winner !== "farmers")
  ) {
    throw new Error("Saved game expectation is invalid");
  }
  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    gameId: value.gameId,
    randomSeed: value.randomSeed,
    firstBidder: value.firstBidder,
    createdAt: value.createdAt,
    bids,
    actions,
    expected: {
      phase: expected.phase,
      currentTurn: expected.currentTurn,
      dealNumber: expected.dealNumber,
      historyLength: expected.historyLength,
      updatedAt: expected.updatedAt,
      winner: expected.winner,
    },
  };
}

function parseBidAction(value: unknown): SerializedBidAction {
  if (
    !isRecord(value) ||
    !isSeat(value.seat) ||
    !isBid(value.bid) ||
    !isTimestamp(value.timestamp)
  ) {
    throw new Error("Saved bid action is invalid");
  }
  return { seat: value.seat, bid: value.bid, timestamp: value.timestamp };
}

function parsePlayAction(value: unknown): SerializedPlayAction {
  if (
    !isRecord(value) ||
    !isSeat(value.seat) ||
    !isTimestamp(value.timestamp)
  ) {
    throw new Error("Saved play action is invalid");
  }
  if (value.type === "pass") {
    return { type: "pass", seat: value.seat, timestamp: value.timestamp };
  }
  if (
    value.type !== "play" ||
    !Array.isArray(value.cardIds) ||
    value.cardIds.length === 0 ||
    value.cardIds.length > 20 ||
    !value.cardIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Saved play action is invalid");
  }
  return {
    type: "play",
    seat: value.seat,
    cardIds: [...value.cardIds],
    timestamp: value.timestamp,
  };
}

function assertExpectedState(
  state: FullGameState,
  serialized: SerializedGameState,
): void {
  const expected = serialized.expected;
  if (
    state.phase !== expected.phase ||
    state.currentTurn !== expected.currentTurn ||
    state.dealNumber !== expected.dealNumber ||
    state.history.length !== expected.historyLength ||
    state.updatedAt !== expected.updatedAt ||
    state.winner !== expected.winner
  ) {
    throw new Error("Saved game does not match its replayed state");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeat(value: unknown): value is Seat {
  return value === "user" || value === "left" || value === "right";
}

function isBid(value: unknown): value is Bid {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isPhase(value: unknown): value is GamePhase {
  return (
    value === "dealing" ||
    value === "bidding" ||
    value === "playing" ||
    value === "finished"
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
