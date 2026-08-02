import type { Card } from "@ai-doudizhu/game-core";

interface PlayingCardProps {
  readonly card: Card;
  readonly selected?: boolean;
  readonly highlighted?: boolean;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onClick?: () => void;
  readonly cardIndex?: number;
}

export function PlayingCard({
  card,
  selected = false,
  highlighted = false,
  disabled = false,
  compact = false,
  onClick,
  cardIndex,
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
    highlighted ? "is-coach-highlighted" : "",
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
      aria-label={`${selected ? "取消选择" : "选择"}${label}${highlighted ? "，教练高亮" : ""}`}
      aria-pressed={selected}
      disabled={disabled}
      data-card-id={card.id}
      data-card-index={cardIndex}
      onClick={onClick}
      style={cardIndex === undefined ? undefined : { zIndex: cardIndex + 1 }}
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
