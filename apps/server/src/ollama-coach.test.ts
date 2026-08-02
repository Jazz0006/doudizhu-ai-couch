import { describe, expect, it, vi } from "vitest";

import { getPlayerVisibleState } from "@ai-doudizhu/coach-protocol";
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
    coach.updateGameContext("session", {
      revision: 2,
      state: getPlayerVisibleState(fullState, "user"),
      events: [
        {
          type: "landlord_selected",
          seat: "user",
          bottomCards: fullState.bottomCards,
        },
      ],
    });
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
    coach.updateGameContext("selection-session", {
      revision: 1,
      state: getPlayerVisibleState(fullState, "user", {
        selectedCardIds: selectedIds,
      }),
      events: [],
    });
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
