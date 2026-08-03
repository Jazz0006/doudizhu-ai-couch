import type {
  CoachGameEvent,
  CoachStyle,
  HighlightInstruction,
  PlayerVisibleGameState,
  PublicLegalAction,
} from "@ai-doudizhu/coach-protocol";
import {
  DEFAULT_COACH_STYLE,
  analyzeSelectedCards,
  createHighlightInstruction,
} from "@ai-doudizhu/coach-protocol";
import { RANK_ORDER, generateLegalPlays } from "@ai-doudizhu/game-core";

import type { CoachResponseContext, CoachTextService } from "./coach-text.js";
import {
  assessCoachResponseQuality,
  type CoachResponseQuality,
} from "./coach-quality.js";

const BASE_SYSTEM_PROMPT = `你是一名直接、可靠、具体的斗地主教练。
回答纪律：
1. 先判断用户是在问事实、合法性还是策略，并严格服从用户要求的回答格式。
2. 事实题只回答所问事实，不主动追加策略；数量题回答数量而不是牌点。
3. 合法性题第一词必须是“可以”或“不可以”，随后最多补一条规则理由。
4. 策略题第一句直接给建议，不寒暄、不复述问题；每条建议至少引用一个当前可见事实，例如当前压制牌、剩余牌数、已出控制牌、手牌结构或牌权。
5. 禁止没有新增信息的套话，包括“根据场上形势判断”“灵活应对”“具体情况具体分析”“还要观察”“继续观察”“保持警惕”“视情况而定”“要看后续”。
6. 信息不足时，明确指出缺少什么，并给出“如果……那么……”的条件建议。
7. 不重复最近回答已经说过的结论或理由，除非相关牌局事实发生变化。
8. 不过度夸奖，不声称存在唯一正确答案；合法性始终以规则工具结果为准。
9. 斗地主的顺子只看连续点数，不看花色；不存在“同花顺”，不得用花色评价策略。
牌局上下文存在时，系统会用 get_current_visible_state 提供最新可见状态；选牌问题使用 analyze_selected_cards，候选动作问题使用 get_legal_actions。highlight_cards 只表示界面高亮，绝不代表已经出牌。bottomCards 是地主确定后公开的底牌；只有其他玩家仍在手中的牌是隐藏信息。绝不猜测或声称知道隐藏手牌。没有牌局上下文时，明确说明目前看不到牌局。`;
const STYLE_PROMPTS: Record<CoachStyle, string> = {
  direct:
    "当前风格是直接型：只能回答 1–2 句话，目标 40–60 个汉字，硬上限 70 个汉字。先给结论，再给一条最关键且具体的理由，写完立即停止。可以明确指出用户的错误。",
  warm: "当前风格是陪练型：语气友好但不客套，默认 2–3 句话、110 个汉字以内。先给结论，再解释风险和一个可执行替代方案。",
  analytical:
    "当前风格是分析型：默认 3–5 句话、220 个汉字以内。比较最多三个候选，说明牌权、剩余手数和控制牌代价；不要为了显得详细而重复。",
};
const STYLE_GENERATION: Record<
  CoachStyle,
  { temperature: number; maxTokens: number }
> = {
  direct: { temperature: 0.2, maxTokens: 110 },
  warm: { temperature: 0.3, maxTokens: 190 },
  analytical: { temperature: 0.25, maxTokens: 300 },
};
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 120_000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_RECENT_GAME_EVENTS = 24;
const PROMPT_VERSION = "coach-personality-v1";

export interface CoachDiagnosticEvent {
  readonly generationId: number;
  readonly gameId?: string;
  readonly contextRevision?: number;
  readonly actionIndex?: number;
  readonly model: string;
  readonly promptVersion: typeof PROMPT_VERSION;
  readonly toolNames: CoachToolName[];
  readonly style: CoachStyle;
  readonly quality?: CoachResponseQuality;
  readonly latencyMs: number;
  readonly result: "success" | "timeout" | "cancelled" | "error";
}

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
  readonly onDiagnostic?: (event: CoachDiagnosticEvent) => void;
}

interface SessionGameContext {
  readonly revision: number;
  readonly actionIndex: number;
  readonly stateChecksum: string;
  readonly generatedAt: string;
  readonly state: PlayerVisibleGameState;
  readonly summary: import("@ai-doudizhu/coach-protocol").CoachStateSummary;
  readonly events: CoachGameEvent[];
}

interface SessionState {
  readonly history: OllamaMessage[];
  activeController: AbortController | undefined;
  gameContext: SessionGameContext | undefined;
  style: CoachStyle;
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
  const onDiagnostic = options.onDiagnostic;
  const sessions = new Map<string, SessionState>();

  const getSession = (sessionId: string): SessionState => {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const created: SessionState = {
      history: [],
      activeController: undefined,
      gameContext: undefined,
      style: DEFAULT_COACH_STYLE,
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
    temperature = STYLE_GENERATION.direct.temperature,
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
            temperature,
            top_p: 0.85,
            repeat_penalty: 1.12,
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
          {
            role: "system",
            content: buildSystemPrompt(undefined, DEFAULT_COACH_STYLE),
          },
          { role: "user", content: "只回复：准备好了。" },
        ],
        controller,
        () => undefined,
        8,
        Math.max(timeoutMs, DEFAULT_WARMUP_TIMEOUT_MS),
      );
    },
    updateStyle(sessionId, style) {
      getSession(sessionId).style = style;
    },
    updateGameContext(sessionId, update) {
      const session = getSession(sessionId);
      const current = session.gameContext;
      if (current?.state.gameId === update.state.gameId) {
        if (update.revision < current.revision) {
          return {
            status: "stale",
            gameId: current.state.gameId,
            revision: current.revision,
            stateChecksum: current.stateChecksum,
          };
        }
        if (update.revision === current.revision) {
          if (update.stateChecksum !== current.stateChecksum) {
            return {
              status: "conflict",
              gameId: current.state.gameId,
              revision: current.revision,
              stateChecksum: current.stateChecksum,
            };
          }
          return {
            status: "idempotent",
            gameId: current.state.gameId,
            revision: current.revision,
            actionIndex: current.actionIndex,
            stateChecksum: current.stateChecksum,
          };
        }
      }
      const sameGame = current?.state.gameId === update.state.gameId;
      session.gameContext = {
        ...update,
        events: [
          ...(sameGame ? (current?.events ?? []) : []),
          ...update.events,
        ].slice(-MAX_RECENT_GAME_EVENTS),
      };
      return {
        status: "accepted",
        gameId: update.state.gameId,
        revision: update.revision,
        actionIndex: update.actionIndex,
        stateChecksum: update.stateChecksum,
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
      const startedAt = performance.now();
      let diagnosticToolNames: CoachToolName[] = [];
      const gameContext = session.gameContext;
      const responseContext = createResponseContext(gameContext);
      const style = session.style;
      const generation = STYLE_GENERATION[style];
      const previousResponses = session.history
        .filter((message) => message.role === "assistant" && message.content)
        .map((message) => message.content)
        .slice(-3);
      try {
        onEvent({
          type: "coach.response.started",
          generationId,
          ...(responseContext ? { context: responseContext } : {}),
        });
        const systemPrompt = buildSystemPrompt(gameContext, style);
        let answer: string;
        if (!gameContext) {
          answer = (
            await request(
              [{ role: "system", content: systemPrompt }, ...history],
              controller,
              (delta) => emitDelta(onEvent, generationId, delta),
              generation.maxTokens,
              timeoutMs,
              generation.temperature,
            )
          ).text;
        } else if (isCurrentTurnQuestion(trimmedText)) {
          onEvent({ type: "coach.highlight.clear", generationId });
          diagnosticToolNames = ["get_current_visible_state"];
          onEvent({
            type: "coach.tool.called",
            generationId,
            name: "get_current_visible_state",
          });
          answer = `${seatName(gameContext.state.currentTurn)}。`;
          emitDelta(onEvent, generationId, answer);
        } else if (isStrictLegalityQuestion(trimmedText)) {
          onEvent({ type: "coach.highlight.clear", generationId });
          diagnosticToolNames = ["analyze_selected_cards"];
          onEvent({
            type: "coach.tool.called",
            generationId,
            name: "analyze_selected_cards",
          });
          const analysis = analyzeSelectedCards(gameContext.state);
          const highlight = createHighlightInstruction(
            gameContext.state,
            gameContext.state.selectedCards.map(({ id }) => id),
            analysis.legal ? "这组牌符合出牌规则" : "这组牌当前不能出",
          );
          if (highlight) {
            diagnosticToolNames.push("highlight_cards");
            onEvent({
              type: "coach.tool.called",
              generationId,
              name: "highlight_cards",
            });
            onEvent({
              type: "coach.highlight",
              generationId,
              instruction: highlight,
            });
          }
          answer = createLegalityAnswer(analysis);
          emitDelta(onEvent, generationId, answer);
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
          diagnosticToolNames = toolCalls.map((call) => call.function.name);
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
              generation.maxTokens,
              timeoutMs,
              generation.temperature,
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
          ...(responseContext ? { context: responseContext } : {}),
        });
        emitDiagnostic(onDiagnostic, {
          generationId,
          context: responseContext,
          model,
          style,
          toolNames: diagnosticToolNames,
          quality: assessCoachResponseQuality(answer, style, previousResponses),
          latencyMs: performance.now() - startedAt,
          result: "success",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          if (controller.signal.reason !== "timeout") {
            emitDiagnostic(onDiagnostic, {
              generationId,
              context: responseContext,
              model,
              style,
              toolNames: diagnosticToolNames,
              latencyMs: performance.now() - startedAt,
              result: "cancelled",
            });
            return;
          }
          onEvent({
            type: "coach.error",
            generationId,
            code: "COACH_TIMEOUT",
            message: "本地教练回答超时，请重试",
            recoverable: true,
          });
          emitDiagnostic(onDiagnostic, {
            generationId,
            context: responseContext,
            model,
            style,
            toolNames: diagnosticToolNames,
            latencyMs: performance.now() - startedAt,
            result: "timeout",
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
        emitDiagnostic(onDiagnostic, {
          generationId,
          context: responseContext,
          model,
          style,
          toolNames: diagnosticToolNames,
          latencyMs: performance.now() - startedAt,
          result: "error",
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

function buildSystemPrompt(
  context: SessionGameContext | undefined,
  style: CoachStyle,
): string {
  const prompt = `${BASE_SYSTEM_PROMPT}\n${STYLE_PROMPTS[style]}`;
  if (!context) return prompt;
  return `${prompt}\n当前牌局 ID：${context.state.gameId}，上下文修订号：${context.revision}，动作序号：${context.actionIndex}。确定性局面摘要：${JSON.stringify(context.summary)}。最近公开事件：${JSON.stringify(context.events)}。`;
}

function createResponseContext(
  context?: SessionGameContext,
): CoachResponseContext | undefined {
  return context
    ? {
        gameId: context.state.gameId,
        revision: context.revision,
        actionIndex: context.actionIndex,
        stateChecksum: context.stateChecksum,
      }
    : undefined;
}

function emitDiagnostic(
  listener: OllamaCoachOptions["onDiagnostic"],
  input: {
    generationId: number;
    context: CoachResponseContext | undefined;
    model: string;
    style: CoachStyle;
    toolNames: CoachToolName[];
    quality?: CoachResponseQuality;
    latencyMs: number;
    result: CoachDiagnosticEvent["result"];
  },
): void {
  listener?.({
    generationId: input.generationId,
    ...(input.context
      ? {
          gameId: input.context.gameId,
          contextRevision: input.context.revision,
          actionIndex: input.context.actionIndex,
        }
      : {}),
    model: input.model,
    style: input.style,
    promptVersion: PROMPT_VERSION,
    toolNames: input.toolNames,
    ...(input.quality ? { quality: input.quality } : {}),
    latencyMs: Number(input.latencyMs.toFixed(1)),
    result: input.result,
  });
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
  return /这样|这么出|这些牌|选的|选中|选牌|这手|这几张|行吗|可以吗|是否合法|合法吗/.test(
    userText,
  );
}

function isStrictLegalityQuestion(userText: string): boolean {
  return /是否合法|合法吗|能不能出|可不可以出/.test(userText);
}

function isCurrentTurnQuestion(userText: string): boolean {
  return /轮到谁|谁出牌|该谁出/.test(userText);
}

function seatName(seat: PlayerVisibleGameState["currentTurn"]): string {
  if (seat === "user") return "轮到你";
  return seat === "left" ? "轮到左家" : "轮到右家";
}

function createLegalityAnswer(
  analysis: ReturnType<typeof analyzeSelectedCards>,
): string {
  if (!analysis.legal) {
    return `不可以。${analysis.warnings[0] ?? "这组牌当前不符合出牌规则"}。`;
  }
  const controlWarning = analysis.warnings.find((warning) =>
    warning.includes("高价值控制牌"),
  );
  return controlWarning
    ? `可以。这组牌合法；${controlWarning}。`
    : "可以。这组牌符合当前出牌规则。";
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
