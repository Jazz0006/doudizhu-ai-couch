import {
  PLAYING_SEATS,
  RANKS,
  SUITS,
  canBeatPlay,
  recognizePlay,
} from "@ai-doudizhu/game-core";
import type {
  Card,
  GamePhase,
  Play,
  PlayRecord,
  Role,
  Seat,
} from "@ai-doudizhu/game-core";

import type { PlayerVisibleGameState } from "./visible-state.js";
import {
  createCoachStateSummary,
  createVisibleStateChecksum,
} from "./state-summary.js";
import type { CoachStateSummary } from "./state-summary.js";

export type CoachGameEvent =
  | { readonly type: "game_started"; readonly gameId: string }
  | {
      readonly type: "landlord_selected";
      readonly seat: Seat;
      readonly bottomCards: Card[];
    }
  | { readonly type: "cards_played"; readonly seat: Seat; readonly play: Play }
  | { readonly type: "player_passed"; readonly seat: Seat }
  | { readonly type: "turn_changed"; readonly seat: Seat }
  | {
      readonly type: "game_finished";
      readonly winner: "landlord" | "farmers";
    };

export interface CoachGameContextUpdate {
  readonly revision: number;
  readonly actionIndex: number;
  readonly stateChecksum: string;
  readonly generatedAt: string;
  readonly state: PlayerVisibleGameState;
  readonly summary: CoachStateSummary;
  readonly events: CoachGameEvent[];
}

export function createCoachGameContextUpdate(
  state: PlayerVisibleGameState,
  revision: number,
  events: readonly CoachGameEvent[],
  generatedAt = new Date().toISOString(),
): CoachGameContextUpdate {
  return {
    revision,
    actionIndex: state.publicHistory.length,
    stateChecksum: createVisibleStateChecksum(state),
    generatedAt,
    state,
    summary: createCoachStateSummary(state),
    events: [...events],
  };
}

export function deriveCoachGameEvents(
  previous: PlayerVisibleGameState | undefined,
  current: PlayerVisibleGameState,
): CoachGameEvent[] {
  if (!previous || previous.gameId !== current.gameId) {
    return [{ type: "game_started", gameId: current.gameId }];
  }

  const events: CoachGameEvent[] = [];
  if (previous.landlord === null && current.landlord !== null) {
    events.push({
      type: "landlord_selected",
      seat: current.landlord,
      bottomCards: current.bottomCards.map(cloneCard),
    });
  }
  for (const record of current.publicHistory.slice(
    previous.publicHistory.length,
  )) {
    if (record.action === "pass" || !record.play) {
      events.push({ type: "player_passed", seat: record.seat });
    } else {
      events.push({
        type: "cards_played",
        seat: record.seat,
        play: clonePlay(record.play),
      });
    }
  }
  if (previous.currentTurn !== current.currentTurn) {
    events.push({ type: "turn_changed", seat: current.currentTurn });
  }
  if (previous.phase !== "finished" && current.phase === "finished") {
    const winningSeat = PLAYING_SEATS.find(
      (seat) => current.remainingCardCounts[seat] === 0,
    );
    events.push({
      type: "game_finished",
      winner: winningSeat === current.landlord ? "landlord" : "farmers",
    });
  }
  return events;
}

export function parseCoachGameContextUpdate(
  value: unknown,
): CoachGameContextUpdate | null {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.revision) ||
    !isNonNegativeInteger(value.actionIndex) ||
    typeof value.stateChecksum !== "string" ||
    typeof value.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.generatedAt))
  ) {
    return null;
  }
  const state = parsePlayerVisibleGameState(value.state);
  if (!state || state.userSeat !== "user" || !Array.isArray(value.events)) {
    return null;
  }
  const events = value.events.map(parseCoachGameEvent);
  if (
    events.some((event) => event === null || !isEventConsistent(event, state))
  ) {
    return null;
  }
  const expected = createCoachGameContextUpdate(
    state,
    value.revision,
    events as CoachGameEvent[],
    value.generatedAt,
  );
  if (
    value.actionIndex !== expected.actionIndex ||
    value.stateChecksum !== expected.stateChecksum ||
    JSON.stringify(value.summary) !== JSON.stringify(expected.summary)
  ) {
    return null;
  }
  return expected;
}

function isEventConsistent(
  event: CoachGameEvent,
  state: PlayerVisibleGameState,
): boolean {
  if (event.type === "game_started") return event.gameId === state.gameId;
  if (event.type === "landlord_selected") {
    return (
      event.seat === state.landlord &&
      cardIds(event.bottomCards) === cardIds(state.bottomCards)
    );
  }
  if (event.type === "cards_played") {
    const signature = playSignature(event.play);
    return state.publicHistory.some(
      (record) =>
        record.seat === event.seat &&
        record.action === "play" &&
        record.play !== null &&
        playSignature(record.play) === signature,
    );
  }
  if (event.type === "player_passed") {
    return state.publicHistory.some(
      (record) => record.seat === event.seat && record.action === "pass",
    );
  }
  if (event.type === "turn_changed") return event.seat === state.currentTurn;
  if (state.phase !== "finished") return false;
  const winningSeat = PLAYING_SEATS.find(
    (seat) => state.remainingCardCounts[seat] === 0,
  );
  return (
    event.winner === (winningSeat === state.landlord ? "landlord" : "farmers")
  );
}

function cardIds(cards: readonly Card[]): string {
  return cards
    .map(({ id }) => id)
    .sort()
    .join("|");
}

function playSignature(play: Play): string {
  return `${play.type}:${cardIds(play.cards)}`;
}

export function parsePlayerVisibleGameState(
  value: unknown,
): PlayerVisibleGameState | null {
  if (!isRecord(value)) return null;
  const phase = parseEnum(value.phase, [
    "dealing",
    "bidding",
    "playing",
    "finished",
  ] as const);
  const userSeat = parseSeat(value.userSeat);
  const userRole =
    value.userRole === null
      ? null
      : parseEnum(value.userRole, ["landlord", "farmer"] as const);
  const landlord = value.landlord === null ? null : parseSeat(value.landlord);
  const currentTurn = parseSeat(value.currentTurn);
  const trickLeader =
    value.trickLeader === null ? null : parseSeat(value.trickLeader);
  const userHand = parseCards(value.userHand);
  const bottomCards = parseCards(value.bottomCards);
  const selectedCards = parseCards(value.selectedCards);
  const currentWinningPlay = parseNullablePlay(value.currentWinningPlay);
  const remainingCardCounts = parseRemainingCounts(value.remainingCardCounts);
  const publicHistory = parseHistory(value.publicHistory);
  if (
    typeof value.gameId !== "string" ||
    value.gameId.length === 0 ||
    value.gameId.length > 200 ||
    !phase ||
    !userSeat ||
    userRole === undefined ||
    landlord === undefined ||
    !currentTurn ||
    trickLeader === undefined ||
    !userHand ||
    !bottomCards ||
    !selectedCards ||
    currentWinningPlay === undefined ||
    !remainingCardCounts ||
    !publicHistory
  ) {
    return null;
  }
  const handIds = new Set(userHand.map(({ id }) => id));
  if (
    handIds.size !== userHand.length ||
    selectedCards.some(({ id }) => !handIds.has(id)) ||
    remainingCardCounts[userSeat] !== userHand.length
  ) {
    return null;
  }
  const selectedPlay = recognizePlay(selectedCards);
  const selectedPlayLegal =
    phase === "playing" &&
    currentTurn === userSeat &&
    selectedPlay !== null &&
    (currentWinningPlay === null ||
      canBeatPlay(selectedPlay, currentWinningPlay));
  return {
    gameId: value.gameId,
    phase: phase as GamePhase,
    userSeat,
    userRole: userRole as Role | null,
    userHand,
    landlord,
    bottomCards,
    currentTurn,
    trickLeader,
    currentWinningPlay,
    selectedCards,
    selectedPlay,
    selectedPlayLegal,
    remainingCardCounts,
    publicHistory,
  };
}

function parseCoachGameEvent(value: unknown): CoachGameEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "game_started") {
    return typeof value.gameId === "string" && value.gameId.length <= 200
      ? { type: "game_started", gameId: value.gameId }
      : null;
  }
  if (value.type === "landlord_selected") {
    const seat = parseSeat(value.seat);
    const bottomCards = parseCards(value.bottomCards);
    return seat && bottomCards
      ? { type: "landlord_selected", seat, bottomCards }
      : null;
  }
  if (value.type === "cards_played") {
    const seat = parseSeat(value.seat);
    const play = parsePlay(value.play);
    return seat && play ? { type: "cards_played", seat, play } : null;
  }
  if (value.type === "player_passed" || value.type === "turn_changed") {
    const seat = parseSeat(value.seat);
    return seat ? { type: value.type, seat } : null;
  }
  if (value.type === "game_finished") {
    return value.winner === "landlord" || value.winner === "farmers"
      ? { type: "game_finished", winner: value.winner }
      : null;
  }
  return null;
}

function parseCards(value: unknown): Card[] | null {
  if (!Array.isArray(value) || value.length > 54) return null;
  const cards = value.map(parseCard);
  return cards.every((card) => card !== null) ? (cards as Card[]) : null;
}

function parseCard(value: unknown): Card | null {
  if (!isRecord(value)) return null;
  const suit = parseEnum(value.suit, SUITS);
  const rank = parseEnum(value.rank, RANKS);
  return typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 100 &&
    suit &&
    rank &&
    typeof value.order === "number" &&
    Number.isInteger(value.order)
    ? { id: value.id, suit, rank, order: value.order }
    : null;
}

function parseNullablePlay(value: unknown): Play | null | undefined {
  return value === null ? null : (parsePlay(value) ?? undefined);
}

function parsePlay(value: unknown): Play | null {
  if (!isRecord(value)) return null;
  const cards = parseCards(value.cards);
  if (!cards) return null;
  const recognized = recognizePlay(cards);
  return recognized ? clonePlay(recognized) : null;
}

function parseHistory(value: unknown): PlayRecord[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null;
  const records: PlayRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const seat = parseSeat(item.seat);
    const play = parseNullablePlay(item.play);
    if (
      !isNonNegativeInteger(item.index) ||
      !seat ||
      (item.action !== "play" && item.action !== "pass") ||
      play === undefined ||
      (item.action === "play" && play === null) ||
      (item.action === "pass" && play !== null) ||
      typeof item.timestamp !== "string"
    ) {
      return null;
    }
    records.push({
      index: item.index,
      seat,
      action: item.action,
      play,
      timestamp: item.timestamp,
    });
  }
  return records;
}

function parseRemainingCounts(value: unknown): Record<Seat, number> | null {
  if (!isRecord(value)) return null;
  return PLAYING_SEATS.every((seat) => isNonNegativeInteger(value[seat]))
    ? {
        user: value.user as number,
        left: value.left as number,
        right: value.right as number,
      }
    : null;
}

function parseSeat(value: unknown): Seat | null {
  return parseEnum(value, PLAYING_SEATS);
}

function parseEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cloneCard(card: Card): Card {
  return { ...card };
}

function clonePlay(play: Play): Play {
  return { ...play, cards: play.cards.map(cloneCard) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
