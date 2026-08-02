import type {
  Bid,
  Card,
  FullGameState,
  GamePhase,
  Play,
  PlayRecord,
  Seat,
} from "@ai-doudizhu/game-core";

export interface BotGameView {
  readonly gameId: string;
  readonly phase: GamePhase;
  readonly seat: Seat;
  readonly hand: Card[];
  readonly bottomCards: Card[];
  readonly landlord: Seat | null;
  readonly currentTurn: Seat;
  readonly highestBid: Bid;
  readonly currentWinningPlay: Play | null;
  readonly trickLeader: Seat | null;
  readonly consecutivePasses: number;
  readonly remainingCardCounts: Record<Seat, number>;
  readonly publicHistory: PlayRecord[];
  readonly actionCount: number;
  readonly randomSeed: string;
}

export function getBotGameView(state: FullGameState, seat: Seat): BotGameView {
  return {
    gameId: state.gameId,
    phase: state.phase,
    seat,
    hand: [...state.hands[seat]],
    bottomCards: state.landlord ? [...state.bottomCards] : [],
    landlord: state.landlord,
    currentTurn: state.currentTurn,
    highestBid: state.highestBid,
    currentWinningPlay: state.currentWinningPlay,
    trickLeader: state.trickLeader,
    consecutivePasses: state.consecutivePasses,
    remainingCardCounts: {
      user: state.hands.user.length,
      left: state.hands.left.length,
      right: state.hands.right.length,
    },
    publicHistory: [...state.history],
    actionCount: state.history.length + state.biddingHistory.length,
    randomSeed: state.randomSeed,
  };
}
