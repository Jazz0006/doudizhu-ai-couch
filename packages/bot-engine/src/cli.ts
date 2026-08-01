import { simulateGame } from "./simulate-game.js";

const randomSeed = process.argv[2] ?? "demo-game";
const result = simulateGame({ randomSeed });

process.stdout.write(
  `${JSON.stringify(
    {
      gameId: result.state.gameId,
      randomSeed: result.state.randomSeed,
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
