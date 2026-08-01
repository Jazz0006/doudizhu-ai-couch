import type { Card } from "@ai-doudizhu/game-core";

interface PlayingCardProps {
  readonly card: Card;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onClick?: () => void;
}

export function PlayingCard({
  card,
  selected = false,
  disabled = false,
  compact = false,
  onClick,
}: PlayingCardProps) {
  const red = card.suit === "heart" || card.suit === "diamond";
  const joker = card.suit === "joker";
  const label = joker
    ? card.rank === "big_joker"
      ? "大王"
      : "小王"
    : `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;
  const className = [
    "playing-card",
    red ? "is-red" : "",
    joker ? "is-joker" : "",
    selected ? "is-selected" : "",
    compact ? "is-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!onClick) {
    return (
      <span className={className} aria-label={label}>
        <span className="card-rank">{rankLabel(card.rank)}</span>
        <span className="card-suit">{suitSymbol(card.suit)}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={`${selected ? "取消选择" : "选择"}${label}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="card-rank">{rankLabel(card.rank)}</span>
      <span className="card-suit">{suitSymbol(card.suit)}</span>
    </button>
  );
}

function rankLabel(rank: Card["rank"]): string {
  if (rank === "small_joker") return "小";
  if (rank === "big_joker") return "大";
  return rank;
}

function suitSymbol(suit: Card["suit"]): string {
  const symbols: Record<Card["suit"], string> = {
    spade: "♠",
    heart: "♥",
    club: "♣",
    diamond: "♦",
    joker: "王",
  };
  return symbols[suit];
}
