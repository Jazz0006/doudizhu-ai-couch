import type { CSSProperties } from "react";

import type { Card } from "@ai-doudizhu/game-core";

import { PlayingCard } from "./PlayingCard";

interface CardFanProps {
  readonly cards: readonly Card[];
  readonly selectedCardIds: readonly string[];
  readonly disabled: boolean;
  readonly onToggle: (cardId: string) => void;
}

export function CardFan({
  cards,
  selectedCardIds,
  disabled,
  onToggle,
}: CardFanProps) {
  const selected = new Set(selectedCardIds);
  const style = {
    "--card-count": Math.max(cards.length, 1),
  } as CSSProperties;

  return (
    <div
      className="card-fan"
      style={style}
      aria-label={`你的手牌，共 ${cards.length} 张`}
    >
      {cards.map((card) => (
        <PlayingCard
          key={card.id}
          card={card}
          selected={selected.has(card.id)}
          disabled={disabled}
          onClick={() => onToggle(card.id)}
        />
      ))}
    </div>
  );
}
