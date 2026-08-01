import type { FullGameState, PlayRecord } from "@ai-doudizhu/game-core";

import { OpponentBadge } from "./OpponentBadge";
import { PlayingCard } from "./PlayingCard";
import { SeatPlayArea } from "./SeatPlayArea";

interface GameTableProps {
  readonly state: FullGameState;
  readonly botThinking: boolean;
  readonly leftAction: PlayRecord | undefined;
  readonly rightAction: PlayRecord | undefined;
}

export function GameTable({
  state,
  botThinking,
  leftAction,
  rightAction,
}: GameTableProps) {
  return (
    <div className="table-surface">
      <div className="opponents-row">
        <div className="opponent-seat opponent-seat-left">
          <OpponentBadge
            seat="left"
            role={state.roles.left}
            remainingCards={state.hands.left.length}
            active={state.currentTurn === "left"}
            thinking={botThinking && state.currentTurn === "left"}
          />
          <SeatPlayArea action={leftAction} label="左侧玩家" compact />
        </div>
        <div className="opponent-seat opponent-seat-right">
          <OpponentBadge
            seat="right"
            role={state.roles.right}
            remainingCards={state.hands.right.length}
            active={state.currentTurn === "right"}
            thinking={botThinking && state.currentTurn === "right"}
          />
          <SeatPlayArea action={rightAction} label="右侧玩家" compact />
        </div>
      </div>

      <div className="bottom-cards" aria-label="地主底牌">
        <span>底牌</span>
        <div>
          {state.landlord
            ? state.bottomCards.map((card) => (
                <PlayingCard key={card.id} card={card} compact />
              ))
            : Array.from({ length: 3 }, (_, index) => (
                <span
                  className="card-back"
                  key={index}
                  aria-label="未公开底牌"
                />
              ))}
        </div>
      </div>

      <div className="table-status">
        <div className="turn-pill">{turnLabel(state, botThinking)}</div>
        <p>{winningPlayLabel(state)}</p>
      </div>
    </div>
  );
}

function turnLabel(state: FullGameState, botThinking: boolean): string {
  if (state.phase === "finished") return "本局结束";
  const actor = seatLabel(state.currentTurn);
  if (state.phase === "bidding") return `${actor}叫分`;
  if (botThinking && state.currentTurn !== "user") return `${actor}思考中…`;
  return `${actor}的回合`;
}

function winningPlayLabel(state: FullGameState): string {
  if (state.phase === "bidding") {
    return state.highestBid === 0
      ? "等待第一位玩家叫分"
      : `当前最高 ${state.highestBid} 分`;
  }

  if (!state.currentWinningPlay) return "新一轮，自由出牌";
  return `当前需压过 ${state.currentWinningPlay.cards.length} 张牌`;
}

function seatLabel(seat: FullGameState["currentTurn"]): string {
  if (seat === "user") return "你";
  return seat === "left" ? "左侧" : "右侧";
}
