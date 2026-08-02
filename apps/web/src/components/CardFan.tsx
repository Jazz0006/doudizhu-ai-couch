import { useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import type { Card } from "@ai-doudizhu/game-core";

import { PlayingCard } from "./PlayingCard";

interface CardFanProps {
  readonly cards: readonly Card[];
  readonly selectedCardIds: readonly string[];
  readonly disabled: boolean;
  readonly onSelectionChange: (cardIds: readonly string[]) => void;
}

interface SelectionGesture {
  readonly pointerId: number;
  readonly startIndex: number;
  readonly startX: number;
  readonly startY: number;
  readonly baseline: ReadonlySet<string>;
  readonly selecting: boolean;
  moved: boolean;
}

const DRAG_THRESHOLD_PX = 7;

export function CardFan({
  cards,
  selectedCardIds,
  disabled,
  onSelectionChange,
}: CardFanProps) {
  const selected = new Set(selectedCardIds);
  const gesture = useRef<SelectionGesture | null>(null);
  const suppressClickUntil = useRef(0);
  const style = {
    "--card-count": Math.max(cards.length, 1),
  } as CSSProperties;

  const toggleCard = (cardId: string) => {
    if (disabled || Date.now() < suppressClickUntil.current) {
      return;
    }

    const next = new Set(selectedCardIds);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    onSelectionChange([...next]);
  };

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-card-index]",
    );
    const startIndex = Number(target?.dataset.cardIndex);
    const cardId = target?.dataset.cardId;

    if (!cardId || !Number.isInteger(startIndex)) return;

    gesture.current = {
      pointerId: event.pointerId,
      startIndex,
      startX: event.clientX,
      startY: event.clientY,
      baseline: new Set(selectedCardIds),
      selecting: !selected.has(cardId),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;

    if (!current.moved) {
      const horizontalDistance = Math.abs(event.clientX - current.startX);
      const verticalDistance = Math.abs(event.clientY - current.startY);
      if (
        horizontalDistance < DRAG_THRESHOLD_PX ||
        horizontalDistance <= verticalDistance
      ) {
        return;
      }
    }

    current.moved = true;
    event.preventDefault();
    const endIndex = cardIndexAtPoint(event.currentTarget, event.clientX);
    onSelectionChange(
      selectionForRange(
        cards,
        current.baseline,
        current.startIndex,
        endIndex,
        current.selecting,
      ),
    );
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;

    suppressClickUntil.current = current.moved ? Date.now() + 250 : 0;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;

    if (current.moved) onSelectionChange([...current.baseline]);
    suppressClickUntil.current = current.moved ? Date.now() + 250 : 0;
    gesture.current = null;
  };

  return (
    <div
      className="card-fan"
      style={style}
      aria-label={`你的手牌，共 ${cards.length} 张`}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={cancelGesture}
    >
      {cards.map((card, index) => (
        <PlayingCard
          key={card.id}
          card={card}
          cardIndex={index}
          selected={selected.has(card.id)}
          disabled={disabled}
          onClick={() => toggleCard(card.id)}
        />
      ))}
    </div>
  );
}

export function selectionForRange(
  cards: readonly Card[],
  baseline: ReadonlySet<string>,
  startIndex: number,
  endIndex: number,
  selecting: boolean,
): string[] {
  const next = new Set(baseline);
  const lower = Math.max(0, Math.min(startIndex, endIndex));
  const upper = Math.min(cards.length - 1, Math.max(startIndex, endIndex));

  for (let index = lower; index <= upper; index += 1) {
    const cardId = cards[index]?.id;
    if (!cardId) continue;
    if (selecting) next.add(cardId);
    else next.delete(cardId);
  }

  return cards.filter(({ id }) => next.has(id)).map(({ id }) => id);
}

function cardIndexAtPoint(container: HTMLDivElement, clientX: number): number {
  const elements = [
    ...container.querySelectorAll<HTMLElement>("[data-card-index]"),
  ];
  if (elements.length === 0) return 0;

  let index = 0;
  for (const element of elements) {
    const candidate = Number(element.dataset.cardIndex);
    if (element.getBoundingClientRect().left <= clientX) index = candidate;
    else break;
  }

  return Math.max(0, Math.min(index, elements.length - 1));
}
