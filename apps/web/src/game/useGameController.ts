import { useCallback, useEffect, useMemo, useState } from "react";

import {
  GameRuleError,
  RANK_ORDER,
  canBeatPlay,
  createGame,
  generateLegalPlays,
  passTurn,
  playCards,
  recognizePlay,
  submitBid,
} from "@ai-doudizhu/game-core";
import type { Bid, FullGameState, Play } from "@ai-doudizhu/game-core";
import {
  chooseBotAction,
  chooseBotBid,
  getBotGameView,
} from "@ai-doudizhu/bot-engine";
import type { Difficulty } from "@ai-doudizhu/bot-engine";

const BOT_DELAY_MS = 560;

export interface GameController {
  readonly state: FullGameState;
  readonly selectedCardIds: string[];
  readonly notice: string;
  readonly botThinking: boolean;
  readonly difficulty: Difficulty;
  readonly canUserBid: boolean;
  readonly canUserPlay: boolean;
  readonly canUserPass: boolean;
  readonly canSubmitSelection: boolean;
  readonly bid: (bid: Bid) => void;
  readonly changeSelection: (cardIds: readonly string[]) => void;
  readonly clearSelection: () => void;
  readonly play: () => void;
  readonly pass: () => void;
  readonly hint: () => void;
  readonly restart: () => void;
  readonly changeDifficulty: (difficulty: Difficulty) => void;
  readonly recognizeSelection: () => Play | null;
}

export function useGameController(): GameController {
  const [state, setState] = useState(createBrowserGame);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("请叫分，看看这手牌值不值得当地主。");
  const [botThinking, setBotThinking] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  const canUserBid = state.phase === "bidding" && state.currentTurn === "user";
  const canUserPlay = state.phase === "playing" && state.currentTurn === "user";
  const canUserPass = canUserPlay && state.currentWinningPlay !== null;

  const selectedCards = useMemo(() => {
    const selected = new Set(selectedCardIds);
    return state.hands.user.filter(({ id }) => selected.has(id));
  }, [selectedCardIds, state.hands.user]);
  const selectedPlay = useMemo(
    () => recognizePlay(selectedCards),
    [selectedCards],
  );
  const canSubmitSelection =
    canUserPlay &&
    selectedPlay !== null &&
    (state.currentWinningPlay === null ||
      canBeatPlay(selectedPlay, state.currentWinningPlay));

  useEffect(() => {
    setSelectedCardIds([]);
  }, [state.currentTurn, state.phase]);

  useEffect(() => {
    if (
      state.phase === "finished" ||
      state.currentTurn === "user" ||
      (state.phase !== "bidding" && state.phase !== "playing")
    ) {
      setBotThinking(false);
      return;
    }

    setBotThinking(true);
    const expectedPhase = state.phase;
    const expectedSeat = state.currentTurn;
    const expectedActionCount =
      state.history.length + state.biddingHistory.length;
    const timer = window.setTimeout(() => {
      const currentActionCount =
        state.history.length + state.biddingHistory.length;

      if (
        state.phase !== expectedPhase ||
        state.currentTurn !== expectedSeat ||
        currentActionCount !== expectedActionCount
      ) {
        return;
      }

      const view = getBotGameView(state, expectedSeat);

      if (state.phase === "bidding") {
        const bid = chooseBotBid(view, difficulty);
        setNotice(
          `${seatLabel(expectedSeat)}${bid === 0 ? "不叫" : `叫 ${bid} 分`}。`,
        );
        setState(submitBid(state, expectedSeat, bid));
        setBotThinking(false);
        return;
      }

      const action = chooseBotAction(view, difficulty);

      if (action.type === "pass") {
        setNotice(`${seatLabel(expectedSeat)}选择不出。`);
        setState(passTurn(state, expectedSeat));
      } else {
        setNotice(
          `${seatLabel(expectedSeat)}打出了 ${action.cardIds.length} 张牌。`,
        );
        setState(playCards(state, expectedSeat, action.cardIds));
      }

      setBotThinking(false);
    }, BOT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [difficulty, state]);

  const bid = useCallback(
    (value: Bid) => {
      try {
        setState(submitBid(state, "user", value));
        setNotice(value === 0 ? "你选择不叫。" : `你叫了 ${value} 分。`);
      } catch (error) {
        setNotice(errorMessage(error));
      }
    },
    [state],
  );

  const changeSelection = useCallback(
    (cardIds: readonly string[]) => {
      if (!canUserPlay) return;

      const handIds = new Set(state.hands.user.map(({ id }) => id));
      setSelectedCardIds(
        [...new Set(cardIds)].filter((cardId) => handIds.has(cardId)),
      );
    },
    [canUserPlay, state.hands.user],
  );

  const clearSelection = useCallback(() => {
    setSelectedCardIds([]);
    setNotice("已清空选牌。");
  }, []);

  const play = useCallback(() => {
    try {
      setState(playCards(state, "user", selectedCardIds));
      setSelectedCardIds([]);
      setNotice("出牌成功，看看对手怎么接。");
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [selectedCardIds, state]);

  const pass = useCallback(() => {
    try {
      setState(passTurn(state, "user"));
      setSelectedCardIds([]);
      setNotice("你选择不出。");
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [state]);

  const hint = useCallback(() => {
    if (!canUserPlay) return;

    const actions = generateLegalPlays(
      state.hands.user,
      state.currentWinningPlay,
    );
    const preferred = [...actions].sort(
      (left, right) =>
        Number(left.type === "bomb" || left.type === "rocket") -
          Number(right.type === "bomb" || right.type === "rocket") ||
        right.cards.length - left.cards.length ||
        RANK_ORDER[left.primaryRank] - RANK_ORDER[right.primaryRank],
    )[0];

    if (!preferred) {
      setNotice("没有能压过当前牌面的出法，可以选择不出。");
      return;
    }

    setSelectedCardIds(preferred.cards.map(({ id }) => id));
    setNotice("已为你选中一个合法出法，是否采用由你决定。");
  }, [canUserPlay, state.currentWinningPlay, state.hands.user]);

  const restart = useCallback(() => {
    setState(createBrowserGame());
    setSelectedCardIds([]);
    setNotice("新的一局开始了，请叫分。");
  }, []);

  const changeDifficulty = useCallback((nextDifficulty: Difficulty) => {
    setDifficulty(nextDifficulty);
    setState(createBrowserGame());
    setSelectedCardIds([]);
    setNotice(
      `已切换为${difficultyLabel(nextDifficulty)}难度，并开启新的一局。`,
    );
  }, []);

  const recognizeSelection = useCallback(() => selectedPlay, [selectedPlay]);

  return {
    state,
    selectedCardIds,
    notice,
    botThinking,
    difficulty,
    canUserBid,
    canUserPlay,
    canUserPass,
    canSubmitSelection,
    bid,
    changeSelection,
    clearSelection,
    play,
    pass,
    hint,
    restart,
    changeDifficulty,
    recognizeSelection,
  };
}

function difficultyLabel(difficulty: Difficulty): string {
  if (difficulty === "easy") return "简单";
  return difficulty === "hard" ? "困难" : "中等";
}

function createBrowserGame(): FullGameState {
  const randomSeed = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  return createGame({
    gameId: `game-${randomSeed}`,
    randomSeed,
  });
}

function seatLabel(seat: "user" | "left" | "right"): string {
  if (seat === "left") return "左侧玩家";
  if (seat === "right") return "右侧玩家";
  return "你";
}

function errorMessage(error: unknown): string {
  if (!(error instanceof GameRuleError)) {
    return "操作没有完成，请再试一次。";
  }

  const messages: Record<GameRuleError["code"], string> = {
    INVALID_PHASE: "当前阶段不能进行这个操作。",
    NOT_CURRENT_TURN: "还没轮到你。",
    INVALID_BID: "叫分必须高于当前最高分。",
    DUPLICATE_CARD_SELECTION: "同一张牌不能重复选择。",
    CARD_NOT_IN_HAND: "选中的牌已经不在手中。",
    INVALID_PLAY: "这些牌暂时不能组成合法牌型。",
    PLAY_DOES_NOT_BEAT: "这个出法压不过当前牌面。",
    CANNOT_PASS: "你拥有本轮牌权，必须先出牌。",
  };

  return messages[error.code];
}
