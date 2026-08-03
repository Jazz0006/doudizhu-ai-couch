import { describe, expect, it, vi } from "vitest";

import {
  createCoachGameContextUpdate,
  getPlayerVisibleState,
} from "@ai-doudizhu/coach-protocol";
import { createGame, submitBid } from "@ai-doudizhu/game-core";

import {
  createOllamaCoachService,
  normalizeLocalOllamaUrl,
} from "./ollama-coach.js";
import type { CoachTextEvent } from "./coach-text.js";

describe("normalizeLocalOllamaUrl", () => {
  it("accepts loopback Ollama URLs", () => {
    expect(normalizeLocalOllamaUrl("http://127.0.0.1:11434/")).toBe(
      "http://127.0.0.1:11434",
    );
  });

  it("rejects remote hosts so transcripts stay local", () => {
    expect(() => normalizeLocalOllamaUrl("https://example.com")).toThrow(
      /local computer/,
    );
  });
});

describe("Ollama coach", () => {
  it("applies the selected personality prompt and generation profile", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const diagnostics: unknown[] = [];
    const fetchImplementation = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return ndjsonResponse(["先别出王。右家只剩两张，留王更容易抢回牌权。"]);
    }) as unknown as typeof fetch;
    const coach = createOllamaCoachService({
      fetchImplementation,
      onDiagnostic: (event) => diagnostics.push(event),
    });
    coach.updateStyle("styled-session", "warm");

    await coach.respond("styled-session", 0, "现在怎么出？", () => undefined);

    const messages = bodies[0]?.messages as OllamaMessageForTest[];
    expect(messages[0]?.content).toContain("当前风格是陪练型");
    expect(messages[0]?.content).toContain("禁止没有新增信息的套话");
    expect(bodies[0]?.options).toMatchObject({
      temperature: 0.3,
      top_p: 0.85,
      repeat_penalty: 1.12,
      num_predict: 190,
    });
    expect(diagnostics[0]).toMatchObject({
      style: "warm",
      promptVersion: "coach-personality-v1",
      quality: { fillerMatches: [], withinStyleLimit: true },
    });
    await coach.close();
  });

  it("rejects stale or conflicting context revisions and accepts idempotent retransmission", async () => {
    const fullState = submitBid(
      createGame({ gameId: "revision-game", randomSeed: "revision-game" }),
      "user",
      3,
    );
    const coach = createOllamaCoachService({
      fetchImplementation: vi.fn() as unknown as typeof fetch,
    });
    const first = createCoachGameContextUpdate(
      getPlayerVisibleState(fullState, "user"),
      2,
      [],
    );

    expect(coach.updateGameContext("revision-session", first).status).toBe(
      "accepted",
    );
    expect(coach.updateGameContext("revision-session", first).status).toBe(
      "idempotent",
    );
    expect(
      coach.updateGameContext("revision-session", { ...first, revision: 1 })
        .status,
    ).toBe("stale");
    const conflicting = createCoachGameContextUpdate(
      getPlayerVisibleState(fullState, "user", {
        selectedCardIds: [fullState.hands.user[0]!.id],
      }),
      2,
      [],
    );
    expect(
      coach.updateGameContext("revision-session", conflicting).status,
    ).toBe("conflict");
    await coach.close();
  });

  it("streams concise text and retains bounded conversation context", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImplementation = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return ndjsonResponse(["可以。", "先保留大牌。"]);
    }) as unknown as typeof fetch;
    const coach = createOllamaCoachService({ fetchImplementation });
    const first: CoachTextEvent[] = [];
    await coach.respond("session", 0, "我可以出连对吗", (event) =>
      first.push(event),
    );
    await coach.respond("session", 1, "为什么", () => undefined);

    expect(first.map((event) => event.type)).toEqual([
      "coach.response.started",
      "coach.response.delta",
      "coach.response.delta",
      "coach.response.completed",
    ]);
    expect(first.at(-1)).toMatchObject({
      text: "可以。先保留大牌。",
      generationId: 0,
    });
    const secondMessages = bodies[1]?.messages as OllamaMessageForTest[];
    expect(secondMessages.slice(-3)).toEqual([
      { role: "user", content: "我可以出连对吗" },
      { role: "assistant", content: "可以。先保留大牌。" },
      { role: "user", content: "为什么" },
    ]);
    await coach.close();
  });

  it("executes read-only visible-state tools without exposing opponent cards", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const responses = [ndjsonResponse(["现在你是地主，可以先从小牌试探。"])];
    const fetchImplementation = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const fullState = submitBid(
      createGame({
        gameId: "tool-game",
        randomSeed: "tool-game",
        now: "2026-08-02T00:00:00.000Z",
      }),
      "user",
      3,
      "2026-08-02T00:00:00.000Z",
    );
    const coach = createOllamaCoachService({ fetchImplementation });
    coach.updateGameContext(
      "session",
      createCoachGameContextUpdate(
        getPlayerVisibleState(fullState, "user"),
        2,
        [
          {
            type: "landlord_selected",
            seat: "user",
            bottomCards: fullState.bottomCards,
          },
        ],
      ),
    );
    const events: CoachTextEvent[] = [];

    await coach.respond("session", 5, "现在该出什么牌？", (event) =>
      events.push(event),
    );

    const messages = bodies[0]?.messages as OllamaMessageForTest[];
    const toolMessage = messages.find(({ role }) => role === "tool");
    expect(toolMessage?.content).toContain("tool-game");
    const serializedToolResult = toolMessage?.content ?? "";
    expect(
      fullState.hands.left.every(
        ({ id }) => !serializedToolResult.includes(id),
      ),
    ).toBe(true);
    expect(
      fullState.hands.right.every(
        ({ id }) => !serializedToolResult.includes(id),
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "coach.response.completed",
      generationId: 5,
      text: "现在你是地主，可以先从小牌试探。",
      context: {
        gameId: "tool-game",
        revision: 2,
        actionIndex: 0,
      },
    });
    expect(events).toContainEqual({
      type: "coach.tool.called",
      generationId: 5,
      name: "get_current_visible_state",
    });
    expect(events).toContainEqual({
      type: "coach.tool.called",
      generationId: 5,
      name: "get_legal_actions",
    });
    const highlightEvent = events.find(
      (event) => event.type === "coach.highlight",
    );
    expect(highlightEvent).toMatchObject({
      type: "coach.highlight",
      generationId: 5,
      instruction: { reason: "教练建议优先考虑这组牌" },
    });
    if (highlightEvent?.type !== "coach.highlight") {
      throw new Error("Expected a highlight event");
    }
    const userHandIds = new Set(fullState.hands.user.map(({ id }) => id));
    expect(
      highlightEvent.instruction.cardIds.every((id) => userHandIds.has(id)),
    ).toBe(true);
    expect(
      messages.find(({ tool_name }) => tool_name === "get_legal_actions")
        ?.content,
    ).toContain("actionId");
    await coach.close();
  });

  it("analyzes and highlights the user's selected cards", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImplementation = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return ndjsonResponse(["这组牌合法，可以这样出。"]);
    }) as unknown as typeof fetch;
    const fullState = submitBid(
      createGame({
        gameId: "selection-game",
        randomSeed: "selection-game",
      }),
      "user",
      3,
    );
    const selectedIds = [fullState.hands.user[0]!.id];
    const coach = createOllamaCoachService({ fetchImplementation });
    coach.updateGameContext(
      "selection-session",
      createCoachGameContextUpdate(
        getPlayerVisibleState(fullState, "user", {
          selectedCardIds: selectedIds,
        }),
        1,
        [],
      ),
    );
    const events: CoachTextEvent[] = [];

    await coach.respond("selection-session", 2, "我这样出可以吗？", (event) =>
      events.push(event),
    );

    const messages = bodies[0]?.messages as OllamaMessageForTest[];
    expect(
      messages.find(({ tool_name }) => tool_name === "analyze_selected_cards")
        ?.content,
    ).toContain('"legal":true');
    expect(events).toContainEqual({
      type: "coach.highlight",
      generationId: 2,
      instruction: {
        cardIds: selectedIds,
        reason: "正在分析你选中的牌",
        expiresInMs: 8_000,
      },
    });
    await coach.close();
  });

  it("answers explicit legality questions from the rule engine without model generation", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const fullState = submitBid(
      createGame({ gameId: "strict-legality", randomSeed: "strict-legality" }),
      "user",
      3,
    );
    const selectedIds = [fullState.hands.user[0]!.id];
    const coach = createOllamaCoachService({ fetchImplementation });
    coach.updateGameContext(
      "strict-legality-session",
      createCoachGameContextUpdate(
        getPlayerVisibleState(fullState, "user", {
          selectedCardIds: selectedIds,
        }),
        1,
        [],
      ),
    );
    const events: CoachTextEvent[] = [];

    await coach.respond(
      "strict-legality-session",
      3,
      "我当前选中的这组牌是否合法？",
      (event) => events.push(event),
    );

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "coach.response.delta",
      generationId: 3,
      delta: "可以。这组牌符合当前出牌规则。",
    });
    expect(events.at(-1)).toMatchObject({
      type: "coach.response.completed",
      text: "可以。这组牌符合当前出牌规则。",
    });
    await coach.close();
  });

  it("answers whose turn it is directly from visible state", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const fullState = submitBid(
      createGame({ gameId: "turn-fact", randomSeed: "turn-fact" }),
      "user",
      3,
    );
    const coach = createOllamaCoachService({ fetchImplementation });
    coach.updateGameContext(
      "turn-fact-session",
      createCoachGameContextUpdate(
        getPlayerVisibleState(fullState, "user"),
        0,
        [],
      ),
    );
    const events: CoachTextEvent[] = [];

    await coach.respond("turn-fact-session", 4, "现在轮到谁？", (event) =>
      events.push(event),
    );

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "coach.response.completed",
      text: "轮到你。",
    });
    await coach.close();
  });

  it("cancels an active response without emitting an error", async () => {
    const fetchImplementation = vi.fn(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const coach = createOllamaCoachService({ fetchImplementation });
    const events: CoachTextEvent[] = [];
    const response = coach.respond("session", 3, "解释一下", (event) =>
      events.push(event),
    );
    await Promise.resolve();
    coach.cancel("session");
    await response;

    expect(events).toEqual([
      { type: "coach.response.started", generationId: 3 },
    ]);
    await coach.close();
  });
});

interface OllamaMessageForTest {
  readonly role: string;
  readonly content: string;
  readonly tool_name?: string;
}

function ndjsonResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const content of chunks) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ message: { content }, done: false })}\n`,
            ),
          );
        }
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ message: { content: "" }, done: true })}\n`,
          ),
        );
        controller.close();
      },
    }),
    { status: 200 },
  );
}
