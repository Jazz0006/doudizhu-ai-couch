import {
  RANK_ORDER,
  createSeededRandom,
  generateLegalPlays,
} from "@ai-doudizhu/game-core";
import type { Bid, Card, Play, PlayType, Rank } from "@ai-doudizhu/game-core";

import type { BotGameView } from "./view.js";

export const BOT_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof BOT_DIFFICULTIES)[number];

export type BotAction =
  | { readonly type: "play"; readonly cardIds: string[] }
  | { readonly type: "pass" };

interface HandShape {
  readonly groups: number;
  readonly singles: number;
  readonly pairs: number;
  readonly triples: number;
  readonly bombs: number;
  readonly controlCards: number;
  readonly estimatedTurns: number;
}

interface ScoredPlay {
  readonly play: Play;
  readonly score: number;
  readonly stableKey: string;
}

const EXPLOSIVE_TYPES: ReadonlySet<PlayType> = new Set(["bomb", "rocket"]);
const CONTROL_RANKS: ReadonlySet<Rank> = new Set([
  "A",
  "2",
  "small_joker",
  "big_joker",
]);

export function chooseBotBid(
  view: BotGameView,
  difficulty: Difficulty = "medium",
): Bid {
  assertBotTurn(view, "bidding");
  assertDifficulty(difficulty);

  const counts = countRanks(view.hand);
  const shape = inspectHand(view.hand);
  const jokerStrength =
    (counts.get("big_joker") ?? 0) * 2.2 +
    (counts.get("small_joker") ?? 0) * 1.5;
  const highCardStrength =
    (counts.get("2") ?? 0) * 0.9 + (counts.get("A") ?? 0) * 0.35;
  const baseStrength =
    jokerStrength +
    highCardStrength +
    shape.bombs * 2.6 +
    shape.triples * 0.45 -
    shape.singles * 0.12 -
    shape.estimatedTurns * 0.08;
  const random = decisionRandom(view, difficulty, "bid");

  let desiredBid: Bid;

  if (difficulty === "easy") {
    const simpleStrength = jokerStrength + highCardStrength + shape.bombs * 2.5;
    const noisyStrength = simpleStrength + (random() - 0.5) * 1.8;
    desiredBid =
      noisyStrength >= 5
        ? 3
        : noisyStrength >= 3
          ? 2
          : noisyStrength >= 1.4
            ? 1
            : 0;
  } else if (difficulty === "hard") {
    desiredBid =
      baseStrength >= 5.1
        ? 3
        : baseStrength >= 3.35
          ? 2
          : baseStrength >= 1.75
            ? 1
            : 0;
  } else {
    const noisyStrength = baseStrength + (random() - 0.5) * 0.45;
    desiredBid =
      noisyStrength >= 5.4
        ? 3
        : noisyStrength >= 3.6
          ? 2
          : noisyStrength >= 1.9
            ? 1
            : 0;
  }

  return desiredBid > view.highestBid ? desiredBid : 0;
}

export function chooseBotAction(
  view: BotGameView,
  difficulty: Difficulty = "medium",
): BotAction {
  assertBotTurn(view, "playing");
  assertDifficulty(difficulty);

  const legalPlays = generateLegalPlays(view.hand, view.currentWinningPlay);

  if (legalPlays.length === 0) {
    return { type: "pass" };
  }

  const random = decisionRandom(view, difficulty, "play");

  if (shouldYieldToFarmerTeammate(view, difficulty, random)) {
    return { type: "pass" };
  }

  const scored = legalPlays
    .map((play) => scorePlay(view, play, difficulty))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.stableKey.localeCompare(right.stableKey),
    );
  const selected = selectRankedPlay(scored, difficulty, random);

  return {
    type: "play",
    cardIds: selected.cards.map(({ id }) => id),
  };
}

function scorePlay(
  view: BotGameView,
  play: Play,
  difficulty: Difficulty,
): ScoredPlay {
  const remaining = removeCards(view.hand, play.cards);
  const before = inspectHand(view.hand);
  const after = inspectHand(remaining);
  const splitPenalty = calculateSplitPenalty(view.hand, play.cards);
  const explosive = EXPLOSIVE_TYPES.has(play.type);
  const finishesGame = remaining.length === 0;
  const nextOpponent = nextSeat(view.seat);
  const nextOpponentCards = view.remainingCardCounts[nextOpponent];
  const lowestOpponentCount = Math.min(
    ...Object.entries(view.remainingCardCounts)
      .filter(([seat]) => seat !== view.seat)
      .map(([, count]) => count),
  );
  const rankCost = RANK_ORDER[play.primaryRank];
  const controlCardsSpent = play.cards.filter(({ rank }) =>
    CONTROL_RANKS.has(rank),
  ).length;

  let score = play.cards.length * 4 - rankCost * 0.25;

  if (difficulty === "easy") {
    score += play.cards.length * 4;
    score -= explosive ? 7 : 0;
    score -= splitPenalty * 0.8;
    score -= after.groups * 0.4;
    score += controlCardsSpent * 0.7;
  } else {
    score += (before.estimatedTurns - after.estimatedTurns) * 12;
    score += (before.singles - after.singles) * 3.2;
    score -= splitPenalty * (difficulty === "hard" ? 4.2 : 2.8);
    score -= controlCardsSpent * (lowestOpponentCount <= 2 ? 0.4 : 2.2);
    score -= explosive && lowestOpponentCount > 2 ? 15 : 2;
    score += after.pairs * 0.7 + after.triples * 1.2;

    if (nextOpponentCards <= 2 && view.currentWinningPlay !== null) {
      score += rankCost * (difficulty === "hard" ? 1.8 : 0.8);
    }

    if (difficulty === "hard") {
      score += remaining.length <= 10 ? endgameScore(remaining) : 0;
      score += publicControlKnowledgeScore(view, play);
      score -= after.controlCards * 0.15;
    }
  }

  if (finishesGame) score += 10_000;

  return {
    play,
    score,
    stableKey: play.cards
      .map(({ id }) => id)
      .sort()
      .join("|"),
  };
}

function selectRankedPlay(
  scored: readonly ScoredPlay[],
  difficulty: Difficulty,
  random: () => number,
): Play {
  const errorRate =
    difficulty === "easy" ? 0.22 : difficulty === "medium" ? 0.07 : 0.015;
  const candidateCount = Math.min(3, scored.length);

  if (candidateCount > 1 && random() < errorRate) {
    const alternativeIndex = 1 + Math.floor(random() * (candidateCount - 1));
    return scored[alternativeIndex]!.play;
  }

  return scored[0]!.play;
}

function shouldYieldToFarmerTeammate(
  view: BotGameView,
  difficulty: Difficulty,
  random: () => number,
): boolean {
  if (
    view.currentWinningPlay === null ||
    view.landlord === null ||
    view.seat === view.landlord ||
    view.trickLeader === null ||
    view.trickLeader === view.landlord ||
    view.trickLeader === view.seat
  ) {
    return false;
  }

  const teammateCards = view.remainingCardCounts[view.trickLeader];
  const landlordCards = view.remainingCardCounts[view.landlord];

  if (landlordCards <= 1 || view.hand.length <= 2) return false;
  if (difficulty === "hard") return true;
  if (difficulty === "medium") return teammateCards <= 5 || random() < 0.78;
  return teammateCards <= 2 ? random() < 0.5 : random() < 0.28;
}

function inspectHand(cards: readonly Card[]): HandShape {
  const counts = [...countRanks(cards).values()];
  const singles = counts.filter((count) => count === 1).length;
  const pairs = counts.filter((count) => count === 2).length;
  const triples = counts.filter((count) => count === 3).length;
  const bombs = counts.filter((count) => count === 4).length;
  const groups = counts.length;
  const controlCards = cards.filter(({ rank }) =>
    CONTROL_RANKS.has(rank),
  ).length;
  const longPlaySaving = estimateSequenceSaving(cards);

  return {
    groups,
    singles,
    pairs,
    triples,
    bombs,
    controlCards,
    estimatedTurns: Math.max(1, groups - triples - bombs - longPlaySaving),
  };
}

function estimateSequenceSaving(cards: readonly Card[]): number {
  const counts = countRanks(cards);
  const eligibleRanks = Object.keys(RANK_ORDER)
    .filter((rank) => rank !== "2" && !rank.includes("joker"))
    .sort(
      (left, right) => RANK_ORDER[left as Rank] - RANK_ORDER[right as Rank],
    ) as Rank[];
  let singleRun = 0;
  let pairRun = 0;
  let saving = 0;

  for (const rank of eligibleRanks) {
    const count = counts.get(rank) ?? 0;
    singleRun = count >= 1 ? singleRun + 1 : 0;
    pairRun = count >= 2 ? pairRun + 1 : 0;
    if (singleRun === 5) saving += 3;
    else if (singleRun > 5) saving += 1;
    if (pairRun === 3) saving += 2;
    else if (pairRun > 3) saving += 1;
  }

  return saving;
}

function calculateSplitPenalty(
  hand: readonly Card[],
  playedCards: readonly Card[],
): number {
  const before = countRanks(hand);
  const removed = countRanks(playedCards);
  let penalty = 0;

  for (const [rank, removedCount] of removed) {
    const originalCount = before.get(rank) ?? 0;
    const remainingCount = originalCount - removedCount;
    if (remainingCount === 0) continue;
    if (originalCount === 4) penalty += 4;
    else if (originalCount === 3) penalty += 2.5;
    else if (originalCount === 2) penalty += 1.5;
  }

  return penalty;
}

function endgameScore(remaining: readonly Card[]): number {
  if (remaining.length === 0) return 500;

  const finishingPlays = generateLegalPlays(remaining, null);
  if (finishingPlays.some((play) => play.cards.length === remaining.length)) {
    return 90;
  }

  const largestFollowUp = finishingPlays.reduce(
    (largest, play) => Math.max(largest, play.cards.length),
    0,
  );
  return largestFollowUp * 1.6;
}

function publicControlKnowledgeScore(view: BotGameView, play: Play): number {
  const publiclySeenRanks = new Set(
    view.publicHistory.flatMap(
      (record) => record.play?.cards.map(({ rank }) => rank) ?? [],
    ),
  );
  const highestRankSeen = [...publiclySeenRanks].reduce(
    (highest, rank) => Math.max(highest, RANK_ORDER[rank]),
    -1,
  );

  return RANK_ORDER[play.primaryRank] > highestRankSeen ? 0.8 : 0;
}

function removeCards(
  hand: readonly Card[],
  playedCards: readonly Card[],
): Card[] {
  const ids = new Set(playedCards.map(({ id }) => id));
  return hand.filter(({ id }) => !ids.has(id));
}

function countRanks(cards: readonly Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of cards)
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return counts;
}

function decisionRandom(
  view: BotGameView,
  difficulty: Difficulty,
  purpose: "bid" | "play",
): () => number {
  return createSeededRandom(
    `${view.randomSeed}:${view.seat}:${view.actionCount}:${difficulty}:${purpose}`,
  );
}

function nextSeat(seat: BotGameView["seat"]): BotGameView["seat"] {
  if (seat === "user") return "left";
  return seat === "left" ? "right" : "user";
}

function assertDifficulty(
  difficulty: string,
): asserts difficulty is Difficulty {
  if (!(BOT_DIFFICULTIES as readonly string[]).includes(difficulty)) {
    throw new Error(`Unsupported bot difficulty: ${difficulty}`);
  }
}

function assertBotTurn(view: BotGameView, phase: "bidding" | "playing"): void {
  if (view.phase !== phase) {
    throw new Error(`Bot action requires the ${phase} phase`);
  }

  if (view.currentTurn !== view.seat) {
    throw new Error(`It is not ${view.seat}'s turn`);
  }
}
