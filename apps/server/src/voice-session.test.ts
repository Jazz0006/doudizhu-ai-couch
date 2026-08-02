import { once } from "node:events";

import {
  getPlayerVisibleState,
  type CoachGameContextUpdate,
} from "@ai-doudizhu/coach-protocol";
import { createGame } from "@ai-doudizhu/game-core";
import { decodePcm16Frame, encodePcm16Frame } from "@ai-doudizhu/shared-types";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";

import {
  createAppServer,
  listenForHttp,
  stopHttpServer,
  VOICE_PROTOCOL_VERSION,
} from "./index.js";
import type { ListeningServer } from "./index.js";
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionService,
} from "./speech-recognition.js";
import type { CoachTextEvent, CoachTextService } from "./coach-text.js";
import type {
  SpeechSynthesisService,
  SynthesizedAudioChunk,
} from "./speech-synthesis.js";

describe("voice session protocol", () => {
  it("creates a short-lived capability without caching it", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/voice/session`, {
        method: "POST",
      });

      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = (await response.json()) as VoiceSessionResponse & {
        readonly protocolVersion: number;
        readonly websocketPath: string;
        readonly expiresAt: string;
      };
      expect(body).toMatchObject({
        protocolVersion: VOICE_PROTOCOL_VERSION,
        websocketPath: "/api/voice/ws",
      });
      expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    });
  });

  it("authenticates on the first control message and acknowledges cancellation", async () => {
    await withServer(async ({ baseUrl, origin }) => {
      const session = await createSession(baseUrl);
      const webSocket = await openWebSocket(baseUrl, origin);

      webSocket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: VOICE_PROTOCOL_VERSION,
          sessionId: session.sessionId,
          token: session.token,
        }),
      );
      await expect(nextJsonMessage(webSocket)).resolves.toMatchObject({
        type: "session.ready",
        sessionId: session.sessionId,
      });

      webSocket.send(JSON.stringify({ type: "turn.cancel" }));
      await expect(nextJsonMessage(webSocket)).resolves.toEqual({
        type: "turn.cancelled",
        generationId: 1,
      });

      webSocket.close(1000);
      await once(webSocket, "close");
    });
  });

  it("rejects an invalid capability before accepting session commands", async () => {
    await withServer(async ({ baseUrl, origin }) => {
      const session = await createSession(baseUrl);
      const webSocket = await openWebSocket(baseUrl, origin);

      webSocket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: VOICE_PROTOCOL_VERSION,
          sessionId: session.sessionId,
          token: "invalid-capability",
        }),
      );
      await expect(nextJsonMessage(webSocket)).resolves.toEqual({
        type: "error",
        error: {
          code: "INVALID_SESSION",
          message: "Session capability is invalid or expired",
          recoverable: false,
        },
      });
      const [code] = await once(webSocket, "close");
      expect(code).toBe(4003);
    });
  });

  it("validates and acknowledges binary microphone frames", async () => {
    await withServer(async ({ baseUrl, origin }) => {
      const session = await createSession(baseUrl);
      const webSocket = await openWebSocket(baseUrl, origin);
      webSocket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: VOICE_PROTOCOL_VERSION,
          sessionId: session.sessionId,
          token: session.token,
        }),
      );
      await nextJsonMessage(webSocket);

      webSocket.send(
        JSON.stringify({ type: "input.start", sampleRate: 48_000 }),
      );
      await expect(nextJsonMessage(webSocket)).resolves.toEqual({
        type: "input.ready",
        sampleRate: 48_000,
      });

      webSocket.send(
        encodePcm16Frame({
          kind: "input",
          sequence: 0,
          generationId: 0,
          sampleRate: 48_000,
          samples: new Float32Array([0, 0.25, -0.25, 0]),
        }),
      );
      await expect(nextJsonMessage(webSocket)).resolves.toEqual({
        type: "input.audio.ack",
        sequence: 0,
        sampleCount: 4,
        totalSamples: 4,
      });

      webSocket.send(JSON.stringify({ type: "input.stop" }));
      await expect(nextJsonMessage(webSocket)).resolves.toEqual({
        type: "input.stopped",
        totalSamples: 4,
      });
      webSocket.close(1000);
      await once(webSocket, "close");
    });
  });

  it("accepts only sanitized player-visible game context", async () => {
    const coach = new FakeCoachText();
    const server = createAppServer({ coachText: coach });
    const listening = await listenForHttp(server, {
      host: "127.0.0.1",
      port: 0,
    });
    const baseUrl = `http://${listening.host}:${listening.port}`;
    try {
      const session = await createSession(baseUrl);
      const webSocket = await openWebSocket(baseUrl, baseUrl);
      webSocket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: VOICE_PROTOCOL_VERSION,
          sessionId: session.sessionId,
          token: session.token,
        }),
      );
      await nextJsonMessage(webSocket);
      const fullState = createGame({
        gameId: "voice-context",
        randomSeed: "opponent-secret-seed",
      });
      webSocket.send(
        JSON.stringify({
          type: "game.context",
          update: {
            revision: 4,
            state: {
              ...getPlayerVisibleState(fullState, "user"),
              hands: fullState.hands,
              randomSeed: fullState.randomSeed,
            },
            events: [{ type: "game_started", gameId: fullState.gameId }],
          },
        }),
      );

      await expect(nextJsonMessage(webSocket)).resolves.toEqual({
        type: "game.context.accepted",
        revision: 4,
        gameId: "voice-context",
      });
      expect(coach.contexts).toHaveLength(1);
      expect(JSON.stringify(coach.contexts[0])).not.toContain("hands");
      expect(JSON.stringify(coach.contexts[0])).not.toContain(
        fullState.randomSeed,
      );
      webSocket.close(1000);
      await once(webSocket, "close");
    } finally {
      await stopHttpServer(server);
    }
  });

  it("streams speech recognition events without exposing raw audio", async () => {
    const recognition = new FakeSpeechRecognition();
    const coach = new FakeCoachText();
    const synthesis = new FakeSpeechSynthesis();
    const server = createAppServer({
      speechRecognition: recognition,
      coachText: coach,
      speechSynthesis: synthesis,
    });
    const listening = await listenForHttp(server, {
      host: "127.0.0.1",
      port: 0,
    });
    const baseUrl = `http://${listening.host}:${listening.port}`;

    try {
      const session = await createSession(baseUrl);
      const webSocket = await openWebSocket(baseUrl, baseUrl);
      webSocket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: VOICE_PROTOCOL_VERSION,
          sessionId: session.sessionId,
          token: session.token,
        }),
      );
      await nextJsonMessage(webSocket);
      webSocket.send(
        JSON.stringify({ type: "input.start", sampleRate: 48_000 }),
      );
      await nextJsonMessage(webSocket);
      expect(recognition.started).toHaveLength(1);
      expect(recognition.started[0]?.sampleRate).toBe(48_000);
      expect(recognition.started[0]?.sessionId).toMatch(
        new RegExp(`^${session.sessionId}:`),
      );

      const recognitionMessages = nextJsonMessages(webSocket, 2);
      webSocket.send(
        encodePcm16Frame({
          kind: "input",
          sequence: 0,
          generationId: 0,
          sampleRate: 48_000,
          samples: new Float32Array([0.1, -0.1]),
        }),
      );
      const [transcript, acknowledgement] = await recognitionMessages;
      expect(transcript).toEqual({
        type: "transcript.partial",
        text: "连对",
        rawText: "联队",
      });
      expect(acknowledgement).toMatchObject({
        type: "input.audio.ack",
        sequence: 0,
      });
      expect(recognition.acceptedSampleCounts).toEqual([2]);

      const stoppedMessages = nextSocketMessages(webSocket, 11);
      webSocket.send(JSON.stringify({ type: "input.stop" }));
      const completedTurn = await stoppedMessages;
      expect(completedTurn).toContainEqual({
        type: "transcript.final",
        text: "连对",
        rawText: "联队",
      });
      expect(completedTurn).toContainEqual({
        type: "coach.response.completed",
        generationId: 0,
        text: "可以，先整理手牌。",
      });
      expect(completedTurn).toContainEqual({
        type: "coach.highlight",
        generationId: 0,
        instruction: {
          cardIds: ["spade-3"],
          reason: "测试高亮",
          expiresInMs: 8_000,
        },
      });
      expect(completedTurn).toContainEqual({
        type: "tts.started",
        generationId: 0,
      });
      expect(completedTurn).toContainEqual({
        type: "tts.completed",
        generationId: 0,
      });
      expect(completedTurn).toContainEqual({
        type: "input.stopped",
        totalSamples: 2,
      });
      const audioFrames = completedTurn.filter(isDecodedAudioFrame);
      expect(audioFrames).toHaveLength(2);
      expect(audioFrames[0]).toMatchObject({
        kind: "output",
        generationId: 0,
        sampleRate: 24_000,
        endOfStream: false,
      });
      expect(audioFrames[0]?.samples).toHaveLength(3);
      expect(audioFrames[1]).toMatchObject({
        kind: "output",
        generationId: 0,
        endOfStream: true,
      });
      expect(coach.requests).toEqual([
        { sessionId: session.sessionId, generationId: 0, text: "连对" },
      ]);
      webSocket.close(1000);
      await once(webSocket, "close");
    } finally {
      await stopHttpServer(server);
    }
    expect(recognition.closed).toBe(true);
    expect(coach.closed).toBe(true);
    expect(synthesis.closed).toBe(true);
  });

  it("rejects cross-origin WebSocket upgrades", async () => {
    await withServer(async ({ baseUrl }) => {
      const webSocket = new WebSocket(toWebSocketUrl(baseUrl), {
        origin: "https://malicious.example",
      });
      webSocket.on("error", () => undefined);
      const [, response] = await once(webSocket, "unexpected-response");
      expect(response.statusCode).toBe(403);
      response.resume();
      await once(response, "end");
    });
  });
});

interface VoiceSessionResponse {
  readonly sessionId: string;
  readonly token: string;
}

class FakeSpeechRecognition implements SpeechRecognitionService {
  readonly started: Array<{ sessionId: string; sampleRate: number }> = [];
  readonly acceptedSampleCounts: number[] = [];
  private listeners = new Map<
    string,
    (event: SpeechRecognitionEvent) => void
  >();
  closed = false;

  start(
    sessionId: string,
    sampleRate: number,
    onEvent: (event: SpeechRecognitionEvent) => void,
  ): void {
    this.started.push({ sessionId, sampleRate });
    this.listeners.set(sessionId, onEvent);
  }

  acceptAudio(sessionId: string, samples: Float32Array): void {
    this.acceptedSampleCounts.push(samples.length);
    this.listeners.get(sessionId)?.({
      type: "transcript.partial",
      text: "连对",
      rawText: "联队",
    });
  }

  async stop(sessionId: string): Promise<void> {
    this.listeners.get(sessionId)?.({
      type: "transcript.final",
      text: "连对",
      rawText: "联队",
    });
  }

  remove(sessionId: string): void {
    this.listeners.delete(sessionId);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeCoachText implements CoachTextService {
  readonly requests: Array<{
    sessionId: string;
    generationId: number;
    text: string;
  }> = [];
  readonly contexts: CoachGameContextUpdate[] = [];
  closed = false;

  async warmup(): Promise<void> {}

  updateGameContext(_sessionId: string, update: CoachGameContextUpdate): void {
    this.contexts.push(update);
  }

  async respond(
    sessionId: string,
    generationId: number,
    text: string,
    onEvent: (event: CoachTextEvent) => void,
  ): Promise<void> {
    this.requests.push({ sessionId, generationId, text });
    onEvent({ type: "coach.response.started", generationId });
    onEvent({ type: "coach.highlight.clear", generationId });
    onEvent({
      type: "coach.highlight",
      generationId,
      instruction: {
        cardIds: ["spade-3"],
        reason: "测试高亮",
        expiresInMs: 8_000,
      },
    });
    onEvent({ type: "coach.response.delta", generationId, delta: "可以，" });
    onEvent({
      type: "coach.response.completed",
      generationId,
      text: "可以，先整理手牌。",
    });
  }

  cancel(): void {}

  remove(): void {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeSpeechSynthesis implements SpeechSynthesisService {
  closed = false;

  async synthesize(
    _sessionId: string,
    _generationId: number,
    _text: string,
    onAudio: (chunk: SynthesizedAudioChunk) => void,
  ): Promise<void> {
    onAudio({
      sampleRate: 24_000,
      samples: new Float32Array([0.1, 0.2, 0.3]),
    });
  }

  cancel(): void {}

  remove(): void {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

async function createSession(baseUrl: string): Promise<VoiceSessionResponse> {
  const response = await fetch(`${baseUrl}/api/voice/session`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(`Session creation failed with ${response.status}`);
  return (await response.json()) as VoiceSessionResponse;
}

async function openWebSocket(
  baseUrl: string,
  origin: string,
): Promise<WebSocket> {
  const webSocket = new WebSocket(toWebSocketUrl(baseUrl), { origin });
  await once(webSocket, "open");
  return webSocket;
}

function toWebSocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, "ws")}/api/voice/ws`;
}

async function nextJsonMessage(webSocket: WebSocket): Promise<unknown> {
  const [data] = await once(webSocket, "message");
  return JSON.parse(data.toString());
}

async function nextJsonMessages(
  webSocket: WebSocket,
  count: number,
): Promise<unknown[]> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const handleMessage = (data: Buffer) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === count) {
        webSocket.off("message", handleMessage);
        resolve(messages);
      }
    };
    webSocket.on("message", handleMessage);
  });
}

async function nextSocketMessages(
  webSocket: WebSocket,
  count: number,
): Promise<unknown[]> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const handleMessage = (data: Buffer, isBinary: boolean) => {
      messages.push(
        isBinary ? decodePcm16Frame(data) : JSON.parse(data.toString()),
      );
      if (messages.length === count) {
        webSocket.off("message", handleMessage);
        resolve(messages);
      }
    };
    webSocket.on("message", handleMessage);
  });
}

function isDecodedAudioFrame(
  value: unknown,
): value is ReturnType<typeof decodePcm16Frame> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "output"
  );
}

async function withServer(
  run: (context: { baseUrl: string; origin: string }) => Promise<void>,
): Promise<void> {
  const server = createAppServer();
  const listening: ListeningServer = await listenForHttp(server, {
    host: "127.0.0.1",
    port: 0,
  });
  const baseUrl = `http://${listening.host}:${listening.port}`;

  try {
    await run({ baseUrl, origin: baseUrl });
  } finally {
    await stopHttpServer(server);
  }
}
