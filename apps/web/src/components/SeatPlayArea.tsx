import type { PlayRecord } from "@ai-doudizhu/game-core";

import { PlayingCard } from "./PlayingCard";

interface SeatPlayAreaProps {
  readonly action: PlayRecord | undefined;
  readonly label: string;
  readonly compact?: boolean;
}

export function SeatPlayArea({
  action,
  label,
  compact = false,
}: SeatPlayAreaProps) {
  return (
    <div
      className={`seat-play-area ${compact ? "is-compact" : ""}`}
      aria-label={`${label}本轮动作`}
    >
      {!action ? (
        <span className="seat-action-placeholder" aria-hidden="true" />
      ) : action.action === "pass" ? (
        <span className="pass-label">不出</span>
      ) : (
        <div className="seat-play-cards">
          {action.play?.cards.map((card) => (
            <PlayingCard key={card.id} card={card} compact />
          ))}
        </div>
      )}
    </div>
  );
}
