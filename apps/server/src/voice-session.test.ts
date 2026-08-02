import { once } from "node:events";

import { encodePcm16Frame } from "@ai-doudizhu/shared-types";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";

import {
  createAppServer,
  listenForHttp,
  stopHttpServer,
  VOICE_PROTOCOL_VERSION,
} from "./index.js";
import type { ListeningServer } from "./index.js";

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
