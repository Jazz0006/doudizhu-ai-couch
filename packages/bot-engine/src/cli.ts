import { BOT_DIFFICULTIES } from "./simple-bot.js";
import type { Difficulty } from "./simple-bot.js";
import { simulateGame } from "./simulate-game.js";

const randomSeed = process.argv[2] ?? "demo-game";
const difficultyArgument = process.argv[3] ?? "medium";
const gameCount = Number(process.argv[4] ?? "1");

if (
  difficultyArgument !== "all" &&
  !(BOT_DIFFICULTIES as readonly string[]).includes(difficultyArgument)
) {
  throw new Error("Difficulty must be easy, medium, hard, or all");
}

if (!Number.isInteger(gameCount) || gameCount < 1) {
  throw new Error("Game count must be a positive integer");
}

if (gameCount === 1) {
  const difficulty = resolveDifficulty(difficultyArgument, 0);
  const result = simulateGame({ randomSeed, difficulty });

  process.stdout.write(
    `${JSON.stringify(
      {
        gameId: result.state.gameId,
        randomSeed: result.state.randomSeed,
        difficulty,
        landlord: result.state.landlord,
        winner: result.state.winner,
        deals: result.state.dealNumber,
        bids: result.state.biddingHistory.length,
        turns: result.state.history.length,
        actions: result.actionCount,
      },
      null,
      2,
    )}\n`,
  );
} else {
  const startedAt = Date.now();
  const totals = Object.fromEntries(
    BOT_DIFFICULTIES.map((difficulty) => [
      difficulty,
      { games: 0, landlordWins: 0, actions: 0 },
    ]),
  ) as Record<
    Difficulty,
    { games: number; landlordWins: number; actions: number }
  >;

  for (let index = 0; index < gameCount; index += 1) {
    const difficulty = resolveDifficulty(difficultyArgument, index);
    const result = simulateGame({
      randomSeed: `${randomSeed}-${index}`,
      difficulty,
      maxActions: 1_000,
    });
    const total = totals[difficulty];
    total.games += 1;
    total.actions += result.actionCount;
    if (result.state.winner === "landlord") total.landlordWins += 1;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        randomSeed,
        requestedDifficulty: difficultyArgument,
        games: gameCount,
        completedGames: Object.values(totals).reduce(
          (sum, total) => sum + total.games,
          0,
        ),
        totals,
        elapsedMilliseconds: Date.now() - startedAt,
      },
      null,
      2,
    )}\n`,
  );
}

function resolveDifficulty(argument: string, index: number): Difficulty {
  if (argument === "all") {
    return BOT_DIFFICULTIES[index % BOT_DIFFICULTIES.length]!;
  }

  return argument as Difficulty;
}
