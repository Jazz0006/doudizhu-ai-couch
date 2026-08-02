import { createServer as createHttpServer } from "node:http";
import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type {
  Server as HttpsServer,
  ServerOptions as HttpsServerOptions,
} from "node:https";

import {
  createVoiceSessionGateway,
  isVoiceSessionRequest,
} from "./voice-session.js";
import type { VoiceSessionGateway } from "./voice-session.js";
import type { SpeechRecognitionService } from "./speech-recognition.js";
import type { CoachTextService } from "./coach-text.js";
import type { SpeechSynthesisService } from "./speech-synthesis.js";

export interface AppServerOptions {
  readonly now?: () => Date;
  readonly allowedOrigins?: readonly string[];
  readonly voiceSessionTtlMs?: number;
  readonly tls?: Pick<HttpsServerOptions, "cert" | "key">;
  readonly speechRecognition?: SpeechRecognitionService;
  readonly coachText?: CoachTextService;
  readonly speechSynthesis?: SpeechSynthesisService;
}

export interface ListenOptions {
  readonly host: string;
  readonly port: number;
}

export interface ListeningServer {
  readonly host: string;
  readonly port: number;
  readonly server: AppServer;
}

export type AppServer = HttpServer | HttpsServer;

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

const voiceGateways = new WeakMap<AppServer, VoiceSessionGateway>();

export function createAppServer(options: AppServerOptions = {}): AppServer {
  const now = options.now ?? (() => new Date());
  const server = options.tls
    ? createHttpsServer(options.tls)
    : createHttpServer();
  const voiceGateway = createVoiceSessionGateway(server, {
    now,
    ...(options.allowedOrigins
      ? { allowedOrigins: options.allowedOrigins }
      : {}),
    ...(options.voiceSessionTtlMs
      ? { sessionTtlMs: options.voiceSessionTtlMs }
      : {}),
    ...(options.speechRecognition
      ? { speechRecognition: options.speechRecognition }
      : {}),
    ...(options.coachText ? { coachText: options.coachText } : {}),
    ...(options.speechSynthesis
      ? { speechSynthesis: options.speechSynthesis }
      : {}),
  });
  voiceGateways.set(server, voiceGateway);
  server.on("request", (request, response) => {
    handleRequest(request, response, now, voiceGateway);
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.on("clientError", (_error, socket) => {
    if (!socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return server;
}

export async function listenForHttp(
  server: AppServer,
  options: ListenOptions,
): Promise<ListeningServer> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await stopHttpServer(server);
    throw new Error("HTTP server did not expose a TCP address");
  }

  return { host: options.host, port: address.port, server };
}

export async function stopHttpServer(server: AppServer): Promise<void> {
  await voiceGateways.get(server)?.close();
  voiceGateways.delete(server);
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  now: () => Date,
  voiceGateway: VoiceSessionGateway,
): void {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (isVoiceSessionRequest(request)) {
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      sendJson(response, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      });
      return;
    }
    sendJson(response, 201, voiceGateway.createSession());
    return;
  }

  if (url.pathname !== "/health") {
    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    return;
  }

  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendJson(response, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
    return;
  }

  sendJson(response, 200, { ok: true, time: now().toISOString() });
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(body)}\n`);
}
