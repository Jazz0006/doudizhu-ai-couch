import {
  RANK_ORDER,
  generateLegalPlays,
  replayGameActions,
} from "@ai-doudizhu/game-core";
import type {
  Card,
  FullGameState,
  Play,
  Seat,
  Winner,
} from "@ai-doudizhu/game-core";

export type LearningTag =
  | "too_many_singletons"
  | "uses_control_cards_too_early"
  | "breaks_pairs_unnecessarily"
  | "weak_farmer_coordination"
  | "misses_endgame_threat"
  | "overuses_bombs"
  | "bids_too_aggressively"
  | "bids_too_passively";

export interface GameReviewAlternative {
  readonly cardIds: string[];
  readonly play: Play;
}

export interface GameReviewItem {
  readonly actionIndex: number;
  readonly seat: Seat;
  readonly title: string;
  readonly userHandBefore: Card[];
  readonly tablePlayBefore: Play | null;
  readonly action: "play" | "pass";
  readonly playedCards: Card[];
  readonly alternatives: GameReviewAlternative[];
  readonly evaluation: string;
  readonly impact: "观察" | "中等" | "重要";
}

export interface GameReview {
  readonly gameId: string;
  readonly winner: Winner;
  readonly items: GameReviewItem[];
  readonly learningTags: LearningTag[];
}

export function createGameReview(state: FullGameState): GameReview {
  if (state.phase !== "finished" || !state.winner) {
    throw new Error("Game review is only available after the game finishes");
  }
  const timeline = replayGameActions(state);
  const scored = timeline.map(({ index, before, action, after }) => {
    const play =
      action.type === "play" ? (after.history.at(-1)?.play ?? null) : null;
    const opponentDanger = Math.min(
      before.hands.left.length,
      before.hands.right.length,
    );
    const usesControl =
      play?.type === "bomb" ||
      play?.type === "rocket" ||
      play?.cards.some(
        ({ rank }) =>
          rank === "2" || rank === "small_joker" || rank === "big_joker",
      );
    const isFinalAction = index >= timeline.length - 3;
    const score =
      (action.seat === "user" ? 3 : 0) +
      (play?.type === "bomb" || play?.type === "rocket" ? 8 : 0) +
      (usesControl ? 4 : 0) +
      (opponentDanger <= 2 ? 7 : 0) +
      (isFinalAction ? 6 : 0) +
      (action.type === "pass" && action.seat === "user" ? 2 : 0);
    const tags: LearningTag[] = [];
    if (
      action.seat === "user" &&
      usesControl &&
      before.hands.user.length > 10
    ) {
      tags.push("uses_control_cards_too_early");
    }
    if (
      action.seat === "user" &&
      action.type === "pass" &&
      opponentDanger <= 2
    ) {
      tags.push("misses_endgame_threat");
    }
    return {
      score,
      tags,
      item: createReviewItem(
        index,
        before,
        action.type,
        action.seat,
        play,
        opponentDanger,
        isFinalAction,
      ),
    };
  });
  const selected = [...scored]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.actionIndex - right.item.actionIndex,
    )
    .slice(0, Math.min(5, Math.max(3, scored.length)))
    .sort((left, right) => left.item.actionIndex - right.item.actionIndex);
  const userBombs = state.history.filter(
    (record) =>
      record.seat === "user" &&
      (record.play?.type === "bomb" || record.play?.type === "rocket"),
  ).length;
  const learningTags = new Set(selected.flatMap(({ tags }) => tags));
  if (userBombs >= 2) learningTags.add("overuses_bombs");
  return {
    gameId: state.gameId,
    winner: state.winner,
    items: selected.map(({ item }) => item),
    learningTags: [...learningTags],
  };
}

function createReviewItem(
  actionIndex: number,
  before: FullGameState,
  action: "play" | "pass",
  seat: Seat,
  play: Play | null,
  opponentDanger: number,
  isFinalAction: boolean,
): GameReviewItem {
  const alternatives =
    seat === "user" && before.currentTurn === "user"
      ? generateLegalPlays(before.hands.user, before.currentWinningPlay)
          .filter(
            (candidate) =>
              !play || playSignature(candidate) !== playSignature(play),
          )
          .sort(compareReviewAlternatives)
          .slice(0, 2)
          .map((candidate) => ({
            cardIds: candidate.cards.map(({ id }) => id),
            play: clonePlay(candidate),
          }))
      : [];
  const important =
    opponentDanger <= 2 ||
    play?.type === "bomb" ||
    play?.type === "rocket" ||
    isFinalAction;
  return {
    actionIndex,
    seat,
    title: reviewTitle(seat, action, play, opponentDanger, isFinalAction),
    userHandBefore: before.hands.user.map((card) => ({ ...card })),
    tablePlayBefore: before.currentWinningPlay
      ? clonePlay(before.currentWinningPlay)
      : null,
    action,
    playedCards: play?.cards.map((card) => ({ ...card })) ?? [],
    alternatives,
    evaluation: reviewEvaluation(
      seat,
      action,
      play,
      before.hands.user.length,
      opponentDanger,
    ),
    impact: important ? "重要" : seat === "user" ? "中等" : "观察",
  };
}

function reviewTitle(
  seat: Seat,
  action: "play" | "pass",
  play: Play | null,
  opponentDanger: number,
  isFinalAction: boolean,
): string {
  if (isFinalAction) return "胜负前的关键动作";
  if (opponentDanger <= 2) return "对手进入收尾阶段";
  if (play?.type === "bomb" || play?.type === "rocket") return "控制牌使用时机";
  if (seat !== "user") return "观察对手节奏";
  return action === "pass" ? "一次过牌决定" : "你的出牌选择";
}

function reviewEvaluation(
  seat: Seat,
  action: "play" | "pass",
  play: Play | null,
  handSize: number,
  opponentDanger: number,
): string {
  if (seat !== "user") {
    return opponentDanger <= 2
      ? "对手手牌已经很少，这一刻应优先考虑阻止其走完。"
      : "这一步用于观察公开节奏，不评价对手的隐藏牌。";
  }
  if (action === "pass") {
    return opponentDanger <= 2
      ? "对手接近走完时选择过牌风险较高，应检查是否有可控的拦截动作。"
      : "过牌本身不一定错误，关键是是否在保存控制牌并等待更合适的牌权。";
  }
  if (play?.type === "bomb" || play?.type === "rocket") {
    return handSize > 10
      ? "较早使用炸弹会失去后程控制力；只有能明显改善出牌结构时才值得。"
      : "残局使用控制牌通常更容易把牌权转化为实际收尾机会。";
  }
  if (
    play?.cards.some(
      ({ rank }) =>
        rank === "2" || rank === "small_joker" || rank === "big_joker",
    )
  ) {
    return "这一步消耗了高控制牌，需要确认换来的牌权能够改善后续出牌结构。";
  }
  return "这一步是合法选择；复盘重点是它是否减少了难处理的小组，而不只看最终输赢。";
}

function compareReviewAlternatives(left: Play, right: Play): number {
  return (
    Number(left.type === "bomb" || left.type === "rocket") -
      Number(right.type === "bomb" || right.type === "rocket") ||
    right.cards.length - left.cards.length ||
    RANK_ORDER[left.primaryRank] - RANK_ORDER[right.primaryRank]
  );
}

function playSignature(play: Play): string {
  return play.cards
    .map(({ id }) => id)
    .sort()
    .join("|");
}

function clonePlay(play: Play): Play {
  return { ...play, cards: play.cards.map((card) => ({ ...card })) };
}
