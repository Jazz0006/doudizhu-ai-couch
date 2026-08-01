import {
  RANK_ORDER,
  createSeededRandom,
  generateLegalPlays,
} from "@ai-doudizhu/game-core";
import type { Bid, Play, PlayType } from "@ai-doudizhu/game-core";

import type { BotGameView } from "./view.js";

export type BotAction =
  | { readonly type: "play"; readonly cardIds: string[] }
  | { readonly type: "pass" };

const EXPLOSIVE_TYPES: ReadonlySet<PlayType> = new Set(["bomb", "rocket"]);

export function chooseBotBid(view: BotGameView): Bid {
  assertBotTurn(view, "bidding");

  const counts = new Map<string, number>();

  for (const card of view.hand) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }

  const strength =
    (counts.get("big_joker") ?? 0) * 2 +
    (counts.get("small_joker") ?? 0) * 1.25 +
    (counts.get("2") ?? 0) * 0.8 +
    (counts.get("A") ?? 0) * 0.3 +
    [...counts.values()].filter((count) => count === 4).length * 2.5;
  const desiredBid: Bid =
    strength >= 5 ? 3 : strength >= 3 ? 2 : strength >= 1.5 ? 1 : 0;

  return desiredBid > view.highestBid ? desiredBid : 0;
}

export function chooseBotAction(view: BotGameView): BotAction {
  assertBotTurn(view, "playing");

  const legalPlays = generateLegalPlays(view.hand, view.currentWinningPlay);

  if (legalPlays.length === 0) {
    return { type: "pass" };
  }

  const sorted = [...legalPlays].sort((left, right) =>
    compareBotPreference(left, right, view.currentWinningPlay === null),
  );
  const best = sorted[0]!;
  const equallyPreferred = sorted.filter(
    (play) =>
      compareBotPreference(play, best, view.currentWinningPlay === null) === 0,
  );
  const random = createSeededRandom(
    `${view.randomSeed}:${view.seat}:${view.actionCount}`,
  );
  const selected =
    equallyPreferred[Math.floor(random() * equallyPreferred.length)]!;

  return {
    type: "play",
    cardIds: selected.cards.map(({ id }) => id),
  };
}

function compareBotPreference(
  left: Play,
  right: Play,
  leading: boolean,
): number {
  const explosiveDifference =
    Number(EXPLOSIVE_TYPES.has(left.type)) -
    Number(EXPLOSIVE_TYPES.has(right.type));

  if (explosiveDifference !== 0) {
    return explosiveDifference;
  }

  if (leading) {
    const cardCountDifference = right.cards.length - left.cards.length;

    if (cardCountDifference !== 0) {
      return cardCountDifference;
    }
  }

  return RANK_ORDER[left.primaryRank] - RANK_ORDER[right.primaryRank];
}

function assertBotTurn(view: BotGameView, phase: "bidding" | "playing"): void {
  if (view.phase !== phase) {
    throw new Error(`Bot action requires the ${phase} phase`);
  }

  if (view.currentTurn !== view.seat) {
    throw new Error(`It is not ${view.seat}'s turn`);
  }
}
