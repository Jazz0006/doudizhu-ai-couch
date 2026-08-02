import type {
  CoachGameEvent,
  HighlightInstruction,
  PlayerVisibleGameState,
  PublicLegalAction,
} from "@ai-doudizhu/coach-protocol";
import {
  analyzeSelectedCards,
  createHighlightInstruction,
} from "@ai-doudizhu/coach-protocol";
import { RANK_ORDER, generateLegalPlays } from "@ai-doudizhu/game-core";

import type { CoachTextService } from "./coach-text.js";

const SYSTEM_PROMPT = `你是一名温暖、自然、有主见的斗地主教练。默认用中文回答 1 到 4 句话，先回应用户的想法，再给建议和一条核心理由。不要过度夸奖，不要声称存在唯一正确答案，不确定时要明确说明。
牌局上下文存在时，系统会用 get_current_visible_state 工具提供最新可见状态；询问“这样出可以吗”时会提供 analyze_selected_cards，推荐候选出牌时会提供 get_legal_actions。highlight_cards 的结果表示界面已高亮对应用户手牌，但绝不代表已经自动出牌。状态中的 bottomCards 是地主确定后已经公开的底牌，可以直接分析，不要说自己看不到；只有其他玩家仍在手中的牌是隐藏信息。工具只提供用户可见信息。绝对不要猜测、要求或声称知道电脑玩家的隐藏手牌。没有牌局上下文时，明确说明目前看不到牌局。`;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 120_000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_RECENT_GAME_EVENTS = 24;

interface OllamaToolCall {
  readonly function: {
    readonly name: CoachToolName;
    readonly arguments?: unknown;
  };
}

type CoachToolName =
  | "get_current_visible_state"
  | "get_legal_actions"
  | "analyze_selected_cards"
  | "highlight_cards";

interface OllamaMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly tool_name?: string;
  readonly tool_calls?: readonly OllamaToolCall[];
}

interface OllamaRequestResult {
  readonly text: string;
  readonly toolCalls: OllamaToolCall[];
}

export interface OllamaCoachOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly numCtx?: number;
  readonly keepAlive?: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

interface SessionGameContext {
  readonly revision: number;
  readonly state: PlayerVisibleGameState;
  readonly events: CoachGameEvent[];
}

interface SessionState {
  readonly history: OllamaMessage[];
  activeController: AbortController | undefined;
  gameContext: SessionGameContext | undefined;
}

export function createOllamaCoachService(
  options: OllamaCoachOptions = {},
): CoachTextService {
  const baseUrl = normalizeLocalOllamaUrl(
    options.baseUrl ?? "http://127.0.0.1:11434",
  );
  const model = options.model ?? "qwen3.5:9b";
  const numCtx = options.numCtx ?? 4096;
  const keepAlive = options.keepAlive ?? "30m";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(numCtx) || numCtx < 512) {
    throw new Error("OLLAMA_NUM_CTX must be an integer of at least 512");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("OLLAMA_TIMEOUT_MS must be at least 1000");
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sessions = new Map<string, SessionState>();

  const getSession = (sessionId: string): SessionState => {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const created: SessionState = {
      history: [],
      activeController: undefined,
      gameContext: undefined,
    };
    sessions.set(sessionId, created);
    return created;
  };

  const request = async (
    messages: readonly OllamaMessage[],
    controller: AbortController,
    onText: (text: string) => void,
    maxTokens: number,
    requestTimeoutMs = timeoutMs,
  ): Promise<OllamaRequestResult> => {
    const timeout = setTimeout(
      () => controller.abort("timeout"),
      requestTimeoutMs,
    );
    let text = "";
    const toolCalls: OllamaToolCall[] = [];
    try {
      const response = await fetchImplementation(`${baseUrl}/api/chat`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          think: false,
          keep_alive: keepAlive,
          options: {
            num_ctx: numCtx,
            temperature: 0.35,
            num_predict: maxTokens,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string): void => {
        const event = parseOllamaLine(line);
        text += event.text;
        if (event.text) onText(event.text);
        toolCalls.push(...event.toolCalls);
      };
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      return { text: text.trim(), toolCalls };
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    async warmup() {
      const controller = new AbortController();
      await request(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "只回复：准备好了。" },
        ],
        controller,
        () => undefined,
        8,
        Math.max(timeoutMs, DEFAULT_WARMUP_TIMEOUT_MS),
      );
    },
    updateGameContext(sessionId, update) {
      const session = getSession(sessionId);
      if (
        session.gameContext &&
        update.revision < session.gameContext.revision
      ) {
        return;
      }
      const sameGame =
        session.gameContext?.state.gameId === update.state.gameId;
      session.gameContext = {
        revision: update.revision,
        state: update.state,
        events: [
          ...(sameGame ? (session.gameContext?.events ?? []) : []),
          ...update.events,
        ].slice(-MAX_RECENT_GAME_EVENTS),
      };
    },
    async respond(sessionId, generationId, userText, onEvent) {
      const trimmedText = userText.trim();
      if (!trimmedText) return;
      const session = getSession(sessionId);
      session.activeController?.abort("replaced");
      const controller = new AbortController();
      session.activeController = controller;
      const userMessage = { role: "user", content: trimmedText } as const;
      const history = [...session.history, userMessage].slice(
        -MAX_HISTORY_MESSAGES,
      );
      onEvent({ type: "coach.response.started", generationId });

      try {
        const gameContext = session.gameContext;
        const systemPrompt = buildSystemPrompt(gameContext);
        let answer: string;
        if (!gameContext) {
          answer = (
            await request(
              [{ role: "system", content: systemPrompt }, ...history],
              controller,
              (delta) => emitDelta(onEvent, generationId, delta),
              220,
            )
          ).text;
        } else {
          onEvent({ type: "coach.highlight.clear", generationId });
          const toolCalls: OllamaToolCall[] = [
            {
              function: { name: "get_current_visible_state", arguments: {} },
            },
          ];
          if (needsLegalActions(trimmedText)) {
            toolCalls.push({
              function: { name: "get_legal_actions", arguments: { limit: 8 } },
            });
          }
          if (needsSelectionAnalysis(trimmedText)) {
            toolCalls.push({
              function: { name: "analyze_selected_cards", arguments: {} },
            });
          }
          const highlight = chooseHighlight(gameContext.state, trimmedText);
          if (highlight) {
            toolCalls.push({
              function: {
                name: "highlight_cards",
                arguments: highlight,
              },
            });
          }
          for (const call of toolCalls) {
            onEvent({
              type: "coach.tool.called",
              generationId,
              name: call.function.name,
            });
          }
          if (highlight) {
            onEvent({
              type: "coach.highlight",
              generationId,
              instruction: highlight,
            });
          }
          answer = (
            await request(
              [
                { role: "system", content: systemPrompt },
                ...history,
                {
                  role: "assistant",
                  content: "",
                  tool_calls: toolCalls,
                },
                ...toolCalls.map((call): OllamaMessage => ({
                  role: "tool",
                  tool_name: call.function.name,
                  content: executeGameTool(gameContext.state, call),
                })),
              ],
              controller,
              (delta) => emitDelta(onEvent, generationId, delta),
              220,
            )
          ).text;
        }
        if (
          session.activeController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        if (!answer) throw new Error("Ollama returned an empty response");
        session.history.splice(
          0,
          session.history.length,
          ...[
            ...history,
            { role: "assistant", content: answer } as const,
          ].slice(-MAX_HISTORY_MESSAGES),
        );
        onEvent({
          type: "coach.response.completed",
          generationId,
          text: answer,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          if (controller.signal.reason !== "timeout") return;
          onEvent({
            type: "coach.error",
            generationId,
            code: "COACH_TIMEOUT",
            message: "本地教练回答超时，请重试",
            recoverable: true,
          });
          return;
        }
        onEvent({
          type: "coach.error",
          generationId,
          code: "COACH_REQUEST_FAILED",
          message: error instanceof Error ? error.message : "本地教练回答失败",
          recoverable: true,
        });
      } finally {
        if (session.activeController === controller) {
          session.activeController = undefined;
        }
      }
    },
    cancel(sessionId) {
      const session = sessions.get(sessionId);
      session?.activeController?.abort("cancelled");
      if (session) session.activeController = undefined;
    },
    remove(sessionId) {
      const session = sessions.get(sessionId);
      session?.activeController?.abort("removed");
      sessions.delete(sessionId);
    },
    async close() {
      for (const session of sessions.values()) {
        session.activeController?.abort("closed");
      }
      sessions.clear();
    },
  };
}

export function normalizeLocalOllamaUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must use HTTP or HTTPS");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error("OLLAMA_BASE_URL must point to the local computer");
  }
  return url.href.replace(/\/$/, "");
}

function buildSystemPrompt(context?: SessionGameContext): string {
  if (!context) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n当前牌局 ID：${context.state.gameId}，上下文修订号：${context.revision}。最近公开事件：${JSON.stringify(context.events)}。`;
}

function executeGameTool(
  state: PlayerVisibleGameState,
  call: OllamaToolCall,
): string {
  if (call.function.name === "get_current_visible_state") {
    return JSON.stringify(state);
  }
  if (call.function.name === "get_legal_actions") {
    const limit = parseToolLimit(call.function.arguments);
    return JSON.stringify(getLegalActions(state).slice(0, limit));
  }
  if (call.function.name === "analyze_selected_cards") {
    return JSON.stringify(analyzeSelectedCards(state));
  }
  if (call.function.name === "highlight_cards") {
    const requested = parseHighlightArguments(call.function.arguments);
    return JSON.stringify(
      createHighlightInstruction(
        state,
        requested.cardIds,
        requested.reason,
        requested.expiresInMs,
      ),
    );
  }
  return JSON.stringify({ error: "unsupported_tool" });
}

function getLegalActions(state: PlayerVisibleGameState): PublicLegalAction[] {
  if (state.phase !== "playing" || state.currentTurn !== state.userSeat) {
    return [];
  }
  const actions: PublicLegalAction[] = generateLegalPlays(
    state.userHand,
    state.currentWinningPlay,
  ).map((play) => ({
    actionId: `play:${play.cards
      .map(({ id }) => id)
      .sort()
      .join(",")}`,
    action: "play" as const,
    cards: play.cards.map((card) => ({ ...card })),
    play: { ...play, cards: play.cards.map((card) => ({ ...card })) },
  }));
  if (state.currentWinningPlay !== null) {
    actions.push({ actionId: "pass", action: "pass", cards: [], play: null });
  }
  return actions;
}

function parseToolLimit(value: unknown): number {
  if (!isRecord(value)) return 8;
  const limit = value.limit;
  return typeof limit === "number" && Number.isInteger(limit)
    ? Math.min(20, Math.max(1, limit))
    : 8;
}

function needsLegalActions(userText: string): boolean {
  return /怎么出|出什么|出哪|该出|能出|可以出|建议|候选|合法|压过|要不要出/.test(
    userText,
  );
}

function needsSelectionAnalysis(userText: string): boolean {
  return /这样|这么出|这些牌|选的|选牌|这手|这几张|行吗|可以吗/.test(userText);
}

function chooseHighlight(
  state: PlayerVisibleGameState,
  userText: string,
): HighlightInstruction | null {
  if (needsSelectionAnalysis(userText) && state.selectedCards.length > 0) {
    return createHighlightInstruction(
      state,
      state.selectedCards.map(({ id }) => id),
      state.selectedPlayLegal ? "正在分析你选中的牌" : "这组牌需要调整",
    );
  }
  if (!needsLegalActions(userText)) return null;
  const preferred = getLegalActions(state)
    .filter((action) => action.action === "play")
    .sort(
      (left, right) =>
        Number(left.play.type === "bomb" || left.play.type === "rocket") -
          Number(right.play.type === "bomb" || right.play.type === "rocket") ||
        right.cards.length - left.cards.length ||
        RANK_ORDER[left.play.primaryRank] - RANK_ORDER[right.play.primaryRank],
    )[0];
  return preferred
    ? createHighlightInstruction(
        state,
        preferred.cards.map(({ id }) => id),
        "教练建议优先考虑这组牌",
      )
    : null;
}

function parseHighlightArguments(value: unknown): {
  cardIds: string[];
  reason: string;
  expiresInMs: number;
} {
  if (!isRecord(value)) {
    return {
      cardIds: [],
      reason: "教练建议关注这些牌",
      expiresInMs: 8_000,
    };
  }
  return {
    cardIds: Array.isArray(value.cardIds)
      ? value.cardIds.filter((id): id is string => typeof id === "string")
      : [],
    reason:
      typeof value.reason === "string" ? value.reason : "教练建议关注这些牌",
    expiresInMs:
      typeof value.expiresInMs === "number" ? value.expiresInMs : 8_000,
  };
}

function emitDelta(
  onEvent: Parameters<CoachTextService["respond"]>[3],
  generationId: number,
  delta: string,
): void {
  onEvent({ type: "coach.response.delta", generationId, delta });
}

function parseOllamaLine(line: string): OllamaRequestResult {
  if (!line.trim()) return { text: "", toolCalls: [] };
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) throw new Error("Ollama returned an invalid event");
  const message = value.message;
  if (!isRecord(message)) return { text: "", toolCalls: [] };
  const text = typeof message.content === "string" ? message.content : "";
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map(parseToolCall).filter(isToolCall)
    : [];
  return { text, toolCalls };
}

function parseToolCall(value: unknown): OllamaToolCall | null {
  if (!isRecord(value) || !isRecord(value.function)) return null;
  return isCoachToolName(value.function.name)
    ? {
        function: {
          name: value.function.name,
          ...(value.function.arguments === undefined
            ? {}
            : { arguments: value.function.arguments }),
        },
      }
    : null;
}

function isCoachToolName(value: unknown): value is CoachToolName {
  return (
    value === "get_current_visible_state" ||
    value === "get_legal_actions" ||
    value === "analyze_selected_cards" ||
    value === "highlight_cards"
  );
}

function isToolCall(value: OllamaToolCall | null): value is OllamaToolCall {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
