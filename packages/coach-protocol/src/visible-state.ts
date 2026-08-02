import {
  canBeatPlay,
  generateLegalPlays,
  recognizePlay,
} from "@ai-doudizhu/game-core";
import type {
  Card,
  FullGameState,
  GamePhase,
  Play,
  PlayRecord,
  Role,
  Seat,
} from "@ai-doudizhu/game-core";

export interface PlayLegalAction {
  readonly actionId: string;
  readonly action: "play";
  readonly cards: Card[];
  readonly play: Play;
}

export interface PassLegalAction {
  readonly actionId: "pass";
  readonly action: "pass";
  readonly cards: [];
  readonly play: null;
}

export type PublicLegalAction = PlayLegalAction | PassLegalAction;

export interface PlayerVisibleGameState {
  readonly gameId: string;
  readonly phase: GamePhase;
  readonly userSeat: Seat;
  readonly userRole: Role | null;
  readonly userHand: Card[];
  readonly landlord: Seat | null;
  readonly bottomCards: Card[];
  readonly currentTurn: Seat;
  readonly trickLeader: Seat | null;
  readonly currentWinningPlay: Play | null;
  readonly selectedCards: Card[];
  readonly selectedPlay: Play | null;
  readonly selectedPlayLegal: boolean;
  readonly remainingCardCounts: Record<Seat, number>;
  readonly publicHistory: PlayRecord[];
  readonly legalActions?: PublicLegalAction[];
}

export interface VisibleStateOptions {
  readonly selectedCardIds?: readonly string[];
  readonly includeLegalActions?: boolean;
}

export function getPlayerVisibleState(
  fullState: FullGameState,
  viewer: Seat,
  options: VisibleStateOptions = {},
): PlayerVisibleGameState {
  const selectedIds = new Set(options.selectedCardIds ?? []);
  const selectedCards = fullState.hands[viewer]
    .filter(({ id }) => selectedIds.has(id))
    .map(cloneCard);
  const selectedPlay = recognizePlay(selectedCards);
  const selectedPlayLegal = isSelectedPlayLegal(
    fullState,
    viewer,
    selectedPlay,
  );
  const visibleState: PlayerVisibleGameState = {
    gameId: fullState.gameId,
    phase: fullState.phase,
    userSeat: viewer,
    userRole: fullState.roles[viewer],
    userHand: fullState.hands[viewer].map(cloneCard),
    landlord: fullState.landlord,
    bottomCards: fullState.landlord ? fullState.bottomCards.map(cloneCard) : [],
    currentTurn: fullState.currentTurn,
    trickLeader: fullState.trickLeader,
    currentWinningPlay: clonePlay(fullState.currentWinningPlay),
    selectedCards,
    selectedPlay: clonePlay(selectedPlay),
    selectedPlayLegal,
    remainingCardCounts: {
      user: fullState.hands.user.length,
      left: fullState.hands.left.length,
      right: fullState.hands.right.length,
    },
    publicHistory: fullState.history.map(clonePlayRecord),
  };

  if (!options.includeLegalActions) return visibleState;

  return {
    ...visibleState,
    legalActions: createPublicLegalActions(fullState, viewer),
  };
}

function createPublicLegalActions(
  state: FullGameState,
  viewer: Seat,
): PublicLegalAction[] {
  if (state.phase !== "playing" || state.currentTurn !== viewer) return [];

  const actions: PublicLegalAction[] = generateLegalPlays(
    state.hands[viewer],
    state.currentWinningPlay,
  ).map((play) => {
    const clonedPlay = clonePlay(play)!;
    const cardIds = clonedPlay.cards.map(({ id }) => id).sort();

    return {
      actionId: `play:${cardIds.join(",")}`,
      action: "play",
      cards: clonedPlay.cards.map(cloneCard),
      play: clonedPlay,
    };
  });

  if (state.currentWinningPlay !== null) {
    actions.push({ actionId: "pass", action: "pass", cards: [], play: null });
  }

  return actions;
}

function isSelectedPlayLegal(
  state: FullGameState,
  viewer: Seat,
  selectedPlay: Play | null,
): boolean {
  if (
    state.phase !== "playing" ||
    state.currentTurn !== viewer ||
    selectedPlay === null
  ) {
    return false;
  }

  return (
    state.currentWinningPlay === null ||
    canBeatPlay(selectedPlay, state.currentWinningPlay)
  );
}

function cloneCard(card: Card): Card {
  return { ...card };
}

function clonePlay(play: Play | null): Play | null {
  if (!play) return null;
  return { ...play, cards: play.cards.map(cloneCard) };
}

function clonePlayRecord(record: PlayRecord): PlayRecord {
  return { ...record, play: clonePlay(record.play) };
}
