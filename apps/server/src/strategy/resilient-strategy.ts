import { RANK_ORDER } from "@ai-doudizhu/game-core";
import type { Rank } from "@ai-doudizhu/game-core";
import { createVisibleStateChecksum } from "@ai-doudizhu/coach-protocol";
import type { PublicLegalAction } from "@ai-doudizhu/coach-protocol";

import { DouZeroWorkerError } from "./douzero-worker-client.js";
import type {
  RankedStrategyAction,
  StrategyProvider,
  StrategyRankRequest,
  StrategyRankResult,
} from "./strategy-types.js";

export interface ResilientStrategyOptions {
  readonly primary: StrategyProvider;
  readonly onFallback?: (reason: string) => void;
}

export function createResilientStrategy(
  options: ResilientStrategyOptions,
): StrategyProvider {
  return {
    async warmup() {
      try {
        await options.primary.warmup();
      } catch (error) {
        options.onFallback?.(fallbackReason(error));
      }
    },
    async rankActions(request) {
      assertStrategyRequest(request);
      try {
        return await options.primary.rankActions(request);
      } catch (error) {
        if (!shouldFallback(error)) throw error;
        const reason = fallbackReason(error);
        options.onFallback?.(reason);
        return createHeuristicRankResult(request, reason);
      }
    },
    async close() {
      await options.primary.close();
    },
  };
}

function assertStrategyRequest(request: StrategyRankRequest): void {
  const topK = request.topK ?? 5;
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new RangeError("topK must be an integer between 1 and 20");
  }
  if (
    request.stateRef.gameId !== request.state.gameId ||
    request.stateRef.actionIndex !== request.state.publicHistory.length ||
    request.stateRef.stateChecksum !== createVisibleStateChecksum(request.state)
  ) {
    throw new Error("Strategy state reference does not match visible state");
  }
  if (request.state.currentTurn !== request.state.userSeat) {
    throw new Error("Strategy ranking requires the visible player's turn");
  }
  if (request.legalActions.length === 0) {
    throw new Error("Strategy ranking requires at least one legal action");
  }
}

export function createHeuristicRankResult(
  request: StrategyRankRequest,
  degradedReason = "strategy_unavailable",
): StrategyRankResult {
  const topK = request.topK ?? 5;
  const canonical = canonicalProjectActions(request.legalActions);
  const scored = canonical
    .map((action) => ({ action, score: heuristicScore(action) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.action.actionId.localeCompare(right.action.actionId),
    );
  const bestScore = scored[0]?.score ?? null;
  const actions: RankedStrategyAction[] = scored
    .slice(0, topK)
    .map(({ action, score }, index) => ({
      rank: index + 1,
      actionId: action.actionId,
      equivalentActionIds: action.equivalentActionIds,
      signature: action.signature,
      modelScore: score,
      deltaFromBest: bestScore === null ? null : score - bestScore,
    }));
  return {
    stateRef: request.stateRef,
    position: relativePosition(request.state.userSeat, request.state.landlord),
    modelVersion: "heuristic-v1",
    objective: "adp",
    source: "heuristic",
    actions,
    latencyMs: 0,
    cacheHit: false,
    degradedReason,
  };
}

interface CanonicalProjectAction {
  readonly action: PublicLegalAction;
  readonly actionId: string;
  readonly equivalentActionIds: readonly string[];
  readonly signature: string;
}

function canonicalProjectActions(
  actions: readonly PublicLegalAction[],
): CanonicalProjectAction[] {
  const groups = new Map<string, PublicLegalAction[]>();
  for (const action of actions) {
    const signature = actionSignature(action);
    const group = groups.get(signature);
    if (group) group.push(action);
    else groups.set(signature, [action]);
  }
  return [...groups.entries()].map(([signature, equivalents]) => {
    const sorted = [...equivalents].sort((left, right) =>
      left.actionId.localeCompare(right.actionId),
    );
    return {
      action: sorted[0]!,
      actionId: sorted[0]!.actionId,
      equivalentActionIds: sorted.map(({ actionId }) => actionId),
      signature,
    };
  });
}

function actionSignature(action: PublicLegalAction): string {
  if (action.action === "pass") return "pass";
  const counts = new Map<Rank, number>();
  for (const { rank } of action.cards) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  return `play:${[...counts.entries()]
    .sort(([left], [right]) => RANK_ORDER[left] - RANK_ORDER[right])
    .map(([rank, count]) => `${rank}x${count}`)
    .join(",")}`;
}

function heuristicScore(action: CanonicalProjectAction): number {
  if (action.action.action === "pass") return -10_000;
  const play = action.action.play;
  const explosive = play.type === "bomb" || play.type === "rocket";
  return (
    action.action.cards.length * 100 -
    RANK_ORDER[play.primaryRank] -
    Number(explosive) * 10_000
  );
}

function relativePosition(
  viewer: "user" | "left" | "right",
  landlord: "user" | "left" | "right" | null,
): "landlord" | "landlord_up" | "landlord_down" {
  if (!landlord) throw new Error("Strategy requires a selected landlord");
  const seats = ["user", "left", "right"] as const;
  if (viewer === landlord) return "landlord";
  const landlordIndex = seats.indexOf(landlord);
  return seats[(landlordIndex + 1) % seats.length] === viewer
    ? "landlord_down"
    : "landlord_up";
}

function fallbackReason(error: unknown): string {
  return error instanceof DouZeroWorkerError
    ? error.code
    : "strategy_unavailable";
}

function shouldFallback(error: unknown): boolean {
  return !(
    error instanceof DouZeroWorkerError &&
    ["invalid_request", "state_mismatch", "not_applicable"].includes(error.code)
  );
}
