import {
  createGame,
  passTurn,
  playCards,
  submitBid,
} from "@ai-doudizhu/game-core";
import type { FullGameState } from "@ai-doudizhu/game-core";

import { chooseBotAction, chooseBotBid } from "./simple-bot.js";
import { getBotGameView } from "./view.js";

export interface SimulationOptions {
  readonly gameId?: string;
  readonly randomSeed?: string | number;
  readonly maxActions?: number;
  readonly startTime?: string;
}

export interface SimulationResult {
  readonly state: FullGameState;
  readonly actionCount: number;
}

export function simulateGame(
  options: SimulationOptions = {},
): SimulationResult {
  const maxActions = options.maxActions ?? 2_000;
  const startTime = options.startTime ?? "2026-01-01T00:00:00.000Z";
  const startMilliseconds = Date.parse(startTime);

  if (!Number.isFinite(startMilliseconds)) {
    throw new Error("startTime must be a valid ISO timestamp");
  }

  let actionCount = 0;
  let state = createGame({
    gameId: options.gameId ?? "simulation",
    randomSeed: options.randomSeed ?? "simulation",
    now: startTime,
  });
  const nextTimestamp = (): string =>
    new Date(startMilliseconds + actionCount * 1_000).toISOString();

  while (state.phase !== "finished") {
    if (actionCount >= maxActions) {
      throw new Error(`Simulation exceeded ${maxActions} actions`);
    }

    const seat = state.currentTurn;
    const view = getBotGameView(state, seat);
    actionCount += 1;

    if (state.phase === "bidding") {
      state = submitBid(state, seat, chooseBotBid(view), nextTimestamp());
      continue;
    }

    if (state.phase !== "playing") {
      throw new Error(`Unsupported simulation phase: ${state.phase}`);
    }

    const action = chooseBotAction(view);
    state =
      action.type === "pass"
        ? passTurn(state, seat, nextTimestamp())
        : playCards(state, seat, action.cardIds, nextTimestamp());
  }

  return { state, actionCount };
}
