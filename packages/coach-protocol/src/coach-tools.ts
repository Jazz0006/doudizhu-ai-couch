import type { Card, Play } from "@ai-doudizhu/game-core";

import type { PlayerVisibleGameState } from "./visible-state.js";

export interface SelectedCardsAnalysis {
  readonly selectedCards: Card[];
  readonly legal: boolean;
  readonly play: Play | null;
  readonly warnings: string[];
}

export interface HighlightInstruction {
  readonly cardIds: string[];
  readonly reason: string;
  readonly expiresInMs: number;
}

export function analyzeSelectedCards(
  state: PlayerVisibleGameState,
): SelectedCardsAnalysis {
  const warnings: string[] = [];
  if (state.selectedCards.length === 0) {
    warnings.push("你还没有选牌");
  } else if (state.phase !== "playing") {
    warnings.push("当前还不能出牌");
  } else if (state.currentTurn !== state.userSeat) {
    warnings.push("现在还没轮到你出牌");
  } else if (!state.selectedPlay) {
    warnings.push("这些牌不能组成合法牌型");
  } else if (!state.selectedPlayLegal) {
    warnings.push("这组牌压不过当前牌面");
  }
  if (
    state.selectedPlay?.type === "bomb" ||
    state.selectedPlay?.type === "rocket"
  ) {
    warnings.push("这是高价值控制牌，出之前要确认收益");
  }
  return {
    selectedCards: state.selectedCards.map((card) => ({ ...card })),
    legal: state.selectedPlayLegal,
    play: state.selectedPlay
      ? {
          ...state.selectedPlay,
          cards: state.selectedPlay.cards.map((card) => ({ ...card })),
        }
      : null,
    warnings,
  };
}

export function createHighlightInstruction(
  state: PlayerVisibleGameState,
  requestedCardIds: readonly string[],
  reason = "教练建议关注这些牌",
  expiresInMs = 8_000,
): HighlightInstruction | null {
  const handIds = new Set(state.userHand.map(({ id }) => id));
  const cardIds = [...new Set(requestedCardIds)].filter((id) =>
    handIds.has(id),
  );
  if (cardIds.length === 0) return null;
  return {
    cardIds,
    reason: reason.trim().slice(0, 120) || "教练建议关注这些牌",
    expiresInMs: Math.min(10_000, Math.max(5_000, Math.round(expiresInMs))),
  };
}
