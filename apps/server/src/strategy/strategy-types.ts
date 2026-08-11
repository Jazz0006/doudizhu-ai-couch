import type {
  PlayerVisibleGameState,
  PublicLegalAction,
} from "@ai-doudizhu/coach-protocol";

import type { CoachResponseContext } from "../coach-text.js";

export type StrategyStateRef = CoachResponseContext;
export type StrategyPosition = "landlord" | "landlord_up" | "landlord_down";
export type StrategySource = "douzero" | "heuristic" | "test";

export interface StrategyRankRequest {
  readonly state: PlayerVisibleGameState;
  readonly legalActions: readonly PublicLegalAction[];
  readonly stateRef: StrategyStateRef;
  readonly topK?: number;
}

export interface RankedStrategyAction {
  readonly rank: number;
  readonly actionId: string;
  readonly equivalentActionIds: readonly string[];
  readonly signature: string;
  readonly modelScore: number | null;
  readonly deltaFromBest: number | null;
}

export interface StrategyRankResult {
  readonly stateRef: StrategyStateRef;
  readonly position: StrategyPosition;
  readonly modelVersion: string;
  readonly objective: "adp" | "wp";
  readonly source: StrategySource;
  readonly actions: readonly RankedStrategyAction[];
  readonly latencyMs: number;
  readonly cacheHit: boolean;
  readonly degradedReason?: string;
}

export interface StrategyProvider {
  warmup(): Promise<void>;
  rankActions(request: StrategyRankRequest): Promise<StrategyRankResult>;
  close(): Promise<void>;
}
