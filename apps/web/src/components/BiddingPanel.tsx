import type { Bid, Seat } from "@ai-doudizhu/game-core";

interface BiddingPanelProps {
  readonly currentTurn: Seat;
  readonly highestBid: Bid;
  readonly disabled: boolean;
  readonly onBid: (bid: Bid) => void;
}

export function BiddingPanel({
  currentTurn,
  highestBid,
  disabled,
  onBid,
}: BiddingPanelProps) {
  return (
    <div className="bidding-panel">
      <div>
        <strong>{disabled ? "等待其他玩家叫分" : "要叫地主吗？"}</strong>
        <span>
          {highestBid === 0 ? "目前无人叫分" : `当前最高 ${highestBid} 分`}
          {currentTurn !== "user" ? " · 对手正在考虑" : ""}
        </span>
      </div>
      <div className="bid-buttons">
        <button disabled={disabled} onClick={() => onBid(0)} type="button">
          不叫
        </button>
        {([1, 2, 3] as const).map((bid) => (
          <button
            className="bid-score"
            disabled={disabled || bid <= highestBid}
            key={bid}
            onClick={() => onBid(bid)}
            type="button"
          >
            {bid} 分
          </button>
        ))}
      </div>
    </div>
  );
}
