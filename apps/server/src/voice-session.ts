import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Socket } from "node:net";

import { decodePcm16Frame } from "@ai-doudizhu/shared-types";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";

import {
  parseVoiceClientMessage,
  VOICE_PROTOCOL_VERSION,
} from "./voice-protocol.js";
import type { VoiceServerControlEvent } from "./voice-protocol.js";

const VOICE_SESSION_PATH = "/api/voice/session";
const VOICE_SOCKET_PATH = "/api/voice/ws";
const DEFAULT_SESSION_TTL_MS = 5 * 60_000;
const AUTHENTICATION_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_CONTROL_OR_AUDIO_FRAME_BYTES = 64 * 1024;

export interface VoiceSessionGatewayOptions {
  readonly now?: () => Date;
  readonly allowedOrigins?: readonly string[];
  readonly sessionTtlMs?: number;
}

export interface CreatedVoiceSession {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: string;
  readonly protocolVersion: typeof VOICE_PROTOCOL_VERSION;
  readonly websocketPath: typeof VOICE_SOCKET_PATH;
}

interface StoredSession {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAtMs: number;
}

interface ConnectionState {
  authenticated: boolean;
  sessionId?: string;
  generationId: number;
  alive: boolean;
  inputStarted: boolean;
  inputSampleRate?: number;
  nextInputSequence: number;
  totalInputSamples: number;
}

export interface VoiceSessionGateway {
  readonly createSession: () => CreatedVoiceSession;
  readonly handleUpgrade: (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ) => void;
  readonly close: () => void;
}

export function createVoiceSessionGateway(
  server: HttpServer | HttpsServer,
  options: VoiceSessionGatewayOptions = {},
): VoiceSessionGateway {
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const sessions = new Map<string, StoredSession>();
  const activeConnections = new Map<string, WebSocket>();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CONTROL_OR_AUDIO_FRAME_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
  });

  const createSession = (): CreatedVoiceSession => {
    removeExpiredSessions(sessions, now().getTime());
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = now().getTime() + sessionTtlMs;
    sessions.set(sessionId, { sessionId, token, expiresAtMs });
    return {
      sessionId,
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
      protocolVersion: VOICE_PROTOCOL_VERSION,
      websocketPath: VOICE_SOCKET_PATH,
    };
  };

  webSocketServer.on("connection", (webSocket) => {
    const state =
      connectionStates.get(webSocket) ??
      ({
        authenticated: false,
        generationId: 0,
        alive: true,
        inputStarted: false,
        nextInputSequence: 0,
        totalInputSamples: 0,
      } satisfies ConnectionState);
    connectionStates.set(webSocket, state);
    const authenticationTimeout = setTimeout(() => {
      if (!state.authenticated)
        closeWithError(
          webSocket,
          "AUTH_TIMEOUT",
          "Session authentication timed out",
        );
    }, AUTHENTICATION_TIMEOUT_MS);

    webSocket.on("pong", () => {
      state.alive = true;
    });
    webSocket.on("message", (data, isBinary) => {
      handleSocketMessage({
        webSocket,
        data,
        isBinary,
        state,
        sessions,
        activeConnections,
        now,
      });
    });
    webSocket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (
        state.sessionId &&
        activeConnections.get(state.sessionId) === webSocket
      ) {
        activeConnections.delete(state.sessionId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const webSocket of webSocketServer.clients) {
      const state = connectionStates.get(webSocket);
      if (state && !state.alive) {
        webSocket.terminate();
        continue;
      }
      if (state) state.alive = false;
      webSocket.ping();
    }
    removeExpiredSessions(sessions, now().getTime());
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const handleUpgrade = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== VOICE_SOCKET_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!isAllowedOrigin(request, allowedOrigins)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const state: ConnectionState = {
        authenticated: false,
        generationId: 0,
        alive: true,
        inputStarted: false,
        nextInputSequence: 0,
        totalInputSamples: 0,
      };
      connectionStates.set(webSocket, state);
      webSocketServer.emit("connection", webSocket, request);
    });
  };

  const close = (): void => {
    clearInterval(heartbeat);
    for (const webSocket of webSocketServer.clients) webSocket.terminate();
    webSocketServer.close();
    sessions.clear();
    activeConnections.clear();
  };

  server.on("upgrade", handleUpgrade);
  return { createSession, handleUpgrade, close };
}

const connectionStates = new WeakMap<WebSocket, ConnectionState>();

interface HandleSocketMessageOptions {
  readonly webSocket: WebSocket;
  readonly data: RawData;
  readonly isBinary: boolean;
  readonly state: ConnectionState;
  readonly sessions: Map<string, StoredSession>;
  readonly activeConnections: Map<string, WebSocket>;
  readonly now: () => Date;
}

function handleSocketMessage(options: HandleSocketMessageOptions): void {
  const { webSocket, data, isBinary, state, sessions, activeConnections, now } =
    options;
  connectionStates.set(webSocket, state);

  if (isBinary) {
    if (!state.authenticated) {
      closeWithError(
        webSocket,
        "NOT_AUTHENTICATED",
        "Authenticate before sending audio",
      );
      return;
    }
    handleInputAudioFrame(webSocket, data, state);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    sendError(
      webSocket,
      "INVALID_JSON",
      "Control message must be valid JSON",
      true,
    );
    return;
  }
  const message = parseVoiceClientMessage(parsed);
  if (!message) {
    sendError(
      webSocket,
      "INVALID_MESSAGE",
      "Unsupported or invalid control message",
      true,
    );
    return;
  }

  if (!state.authenticated) {
    if (message.type !== "session.start") {
      closeWithError(
        webSocket,
        "NOT_AUTHENTICATED",
        "First message must authenticate the session",
      );
      return;
    }
    removeExpiredSessions(sessions, now().getTime());
    const session = sessions.get(message.sessionId);
    if (!session || !tokensMatch(session.token, message.token)) {
      closeWithError(
        webSocket,
        "INVALID_SESSION",
        "Session capability is invalid or expired",
      );
      return;
    }
    const previousConnection = activeConnections.get(session.sessionId);
    if (previousConnection && previousConnection !== webSocket)
      previousConnection.close(4001, "Reconnected");
    state.authenticated = true;
    state.sessionId = session.sessionId;
    activeConnections.set(session.sessionId, webSocket);
    sendEvent(webSocket, {
      type: "session.ready",
      protocolVersion: VOICE_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    });
    return;
  }

  switch (message.type) {
    case "turn.cancel": {
      state.generationId = Math.max(
        state.generationId + 1,
        message.generationId ?? 0,
      );
      sendEvent(webSocket, {
        type: "turn.cancelled",
        generationId: state.generationId,
      });
      break;
    }
    case "ping":
      sendEvent(
        webSocket,
        message.timestamp === undefined
          ? { type: "pong" }
          : { type: "pong", timestamp: message.timestamp },
      );
      break;
    case "input.start":
      state.inputStarted = true;
      state.inputSampleRate = message.sampleRate;
      state.nextInputSequence = 0;
      state.totalInputSamples = 0;
      sendEvent(webSocket, {
        type: "input.ready",
        sampleRate: message.sampleRate,
      });
      break;
    case "input.stop":
      state.inputStarted = false;
      sendEvent(webSocket, {
        type: "input.stopped",
        totalSamples: state.totalInputSamples,
      });
      break;
    case "session.close":
      webSocket.close(1000, "Session closed");
      break;
    case "session.start":
      sendError(
        webSocket,
        "ALREADY_AUTHENTICATED",
        "Session is already authenticated",
        true,
      );
      break;
  }
}

function handleInputAudioFrame(
  webSocket: WebSocket,
  data: RawData,
  state: ConnectionState,
): void {
  if (!state.inputStarted || state.inputSampleRate === undefined) {
    sendError(
      webSocket,
      "INPUT_NOT_STARTED",
      "Send input.start before audio frames",
      true,
    );
    return;
  }

  let frame;
  try {
    frame = decodePcm16Frame(Array.isArray(data) ? Buffer.concat(data) : data);
  } catch {
    sendError(webSocket, "INVALID_AUDIO_FRAME", "Audio frame is invalid", true);
    return;
  }
  if (frame.kind !== "input") {
    sendError(
      webSocket,
      "INVALID_AUDIO_DIRECTION",
      "Expected an input audio frame",
      true,
    );
    return;
  }
  if (frame.sampleRate !== state.inputSampleRate) {
    sendError(
      webSocket,
      "SAMPLE_RATE_CHANGED",
      "Audio sample rate changed during input",
      false,
    );
    return;
  }
  if (frame.sequence !== state.nextInputSequence) {
    sendError(
      webSocket,
      "AUDIO_SEQUENCE_GAP",
      "Audio frame sequence is not contiguous",
      true,
    );
    state.nextInputSequence = frame.sequence;
  }

  state.nextInputSequence += 1;
  state.totalInputSamples += frame.samples.length;
  sendEvent(webSocket, {
    type: "input.audio.ack",
    sequence: frame.sequence,
    sampleCount: frame.samples.length,
    totalSamples: state.totalInputSamples,
  });
  if (frame.endOfStream) {
    state.inputStarted = false;
    sendEvent(webSocket, {
      type: "input.stopped",
      totalSamples: state.totalInputSamples,
    });
  }
}

function isAllowedOrigin(
  request: IncomingMessage,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  if (allowedOrigins.has(origin)) return true;
  const scheme =
    "encrypted" in request.socket && request.socket.encrypted
      ? "https"
      : "http";
  return origin === `${scheme}://${host}`;
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function removeExpiredSessions(
  sessions: Map<string, StoredSession>,
  nowMs: number,
): void {
  for (const [sessionId, session] of sessions) {
    if (session.expiresAtMs <= nowMs) sessions.delete(sessionId);
  }
}

function sendEvent(webSocket: WebSocket, event: VoiceServerControlEvent): void {
  if (webSocket.readyState === WebSocket.OPEN)
    webSocket.send(JSON.stringify(event));
}

function sendError(
  webSocket: WebSocket,
  code: string,
  message: string,
  recoverable: boolean,
): void {
  sendEvent(webSocket, {
    type: "error",
    error: { code, message, recoverable },
  });
}

function closeWithError(
  webSocket: WebSocket,
  code: string,
  message: string,
): void {
  sendError(webSocket, code, message, false);
  webSocket.close(4003, code);
}

function rejectUpgrade(
  socket: Socket,
  statusCode: number,
  message: string,
): void {
  if (!socket.writable) return;
  socket.end(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

export function isVoiceSessionRequest(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  return url.pathname === VOICE_SESSION_PATH;
}
