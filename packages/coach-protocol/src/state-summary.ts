import { RANKS } from "@ai-doudizhu/game-core";
import type { PlayRecord, Rank } from "@ai-doudizhu/game-core";

import type { PlayerVisibleGameState } from "./visible-state.js";

export interface CoachStateSummary {
  readonly currentTurn: PlayerVisibleGameState["currentTurn"];
  readonly trickLeader: PlayerVisibleGameState["trickLeader"];
  readonly freeToPlay: boolean;
  readonly currentWinningPlay: PlayerVisibleGameState["currentWinningPlay"];
  readonly consecutivePasses: number;
  readonly lastAction: PlayRecord | null;
  readonly recentActions: PlayRecord[];
  readonly playedRankCounts: Record<Rank, number>;
  readonly remainingCardCounts: PlayerVisibleGameState["remainingCardCounts"];
}

export function createCoachStateSummary(
  state: PlayerVisibleGameState,
): CoachStateSummary {
  const playedRankCounts = Object.fromEntries(
    RANKS.map((rank) => [rank, 0]),
  ) as Record<Rank, number>;
  for (const record of state.publicHistory) {
    for (const card of record.play?.cards ?? []) {
      playedRankCounts[card.rank] += 1;
    }
  }

  return {
    currentTurn: state.currentTurn,
    trickLeader: state.trickLeader,
    freeToPlay: state.phase === "playing" && state.currentWinningPlay === null,
    currentWinningPlay: clonePlay(state.currentWinningPlay),
    consecutivePasses:
      state.currentWinningPlay === null
        ? 0
        : countTrailingPasses(state.publicHistory),
    lastAction: cloneRecord(state.publicHistory.at(-1) ?? null),
    recentActions: state.publicHistory
      .slice(-6)
      .map((record) => cloneRecord(record)),
    playedRankCounts,
    remainingCardCounts: { ...state.remainingCardCounts },
  };
}

export function createVisibleStateChecksum(
  state: PlayerVisibleGameState,
): string {
  const serialized = JSON.stringify(state);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function countTrailingPasses(history: readonly PlayRecord[]): number {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.action !== "pass") break;
    count += 1;
  }
  return count;
}

function cloneRecord(record: PlayRecord): PlayRecord;
function cloneRecord(record: PlayRecord | null): PlayRecord | null;
function cloneRecord(record: PlayRecord | null): PlayRecord | null {
  return record ? { ...record, play: clonePlay(record.play) } : null;
}

function clonePlay<T extends PlayerVisibleGameState["currentWinningPlay"]>(
  play: T,
): T {
  return (
    play ? { ...play, cards: play.cards.map((card) => ({ ...card })) } : null
  ) as T;
}
