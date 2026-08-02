import { decodePcm16Frame, encodePcm16Frame } from "@ai-doudizhu/shared-types";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrowserAudioEngine } from "./BrowserAudioEngine";
import type { CapturedAudioChunk } from "./BrowserAudioEngine";

const MAX_BUFFERED_AUDIO_BYTES = 256 * 1024;
const CONTROL_TIMEOUT_MS = 5_000;

export type VoiceAudioPhase =
  "idle" | "connecting" | "listening" | "stopping" | "error";

export interface VoiceAudioSnapshot {
  readonly phase: VoiceAudioPhase;
  readonly message: string;
  readonly acknowledgedSeconds: number;
  readonly droppedFrames: number;
}

interface VoiceResources {
  readonly engine: BrowserAudioEngine;
  readonly webSocket: WebSocket;
  sequence: number;
  generationId: number;
  intentionalClose: boolean;
}

interface SessionResponse {
  readonly sessionId: string;
  readonly token: string;
  readonly protocolVersion: number;
  readonly websocketPath: string;
}

const INITIAL_SNAPSHOT: VoiceAudioSnapshot = {
  phase: "idle",
  message: "本地语音未连接",
  acknowledgedSeconds: 0,
  droppedFrames: 0,
};

export function useVoiceAudioSession() {
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const resourcesRef = useRef<VoiceResources | undefined>(undefined);
  const mountedRef = useRef(true);

  const updateSnapshot = useCallback(
    (update: (current: VoiceAudioSnapshot) => VoiceAudioSnapshot) => {
      if (mountedRef.current) setSnapshot(update);
    },
    [],
  );

  const handleCapturedAudio = useCallback(
    ({ sampleRate, samples }: CapturedAudioChunk) => {
      const resources = resourcesRef.current;
      if (!resources || resources.webSocket.readyState !== WebSocket.OPEN)
        return;
      if (resources.webSocket.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) {
        updateSnapshot((current) => ({
          ...current,
          droppedFrames: current.droppedFrames + 1,
          message: "网络发送积压，已丢弃过期麦克风帧",
        }));
        return;
      }
      resources.webSocket.send(
        encodePcm16Frame({
          kind: "input",
          sequence: resources.sequence,
          generationId: resources.generationId,
          sampleRate,
          samples,
        }),
      );
      resources.sequence += 1;
    },
    [updateSnapshot],
  );

  const releaseResources = useCallback(async (resources?: VoiceResources) => {
    const active = resources ?? resourcesRef.current;
    if (!active) return;
    active.intentionalClose = true;
    if (resourcesRef.current === active) resourcesRef.current = undefined;
    if (
      active.webSocket.readyState === WebSocket.OPEN ||
      active.webSocket.readyState === WebSocket.CONNECTING
    ) {
      active.webSocket.close(1000, "Voice audio stopped");
    }
    await active.engine.close().catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    if (resourcesRef.current) return;
    setSnapshot({
      phase: "connecting",
      message: "正在请求麦克风并建立本地安全通道…",
      acknowledgedSeconds: 0,
      droppedFrames: 0,
    });

    let engine: BrowserAudioEngine | undefined;
    let webSocket: WebSocket | undefined;
    try {
      engine = await BrowserAudioEngine.create(handleCapturedAudio);
      const sessionResponse = await fetch("/api/voice/session", {
        method: "POST",
      });
      if (!sessionResponse.ok) {
        throw new Error(describeSessionCreationFailure(sessionResponse.status));
      }
      const session = validateSessionResponse(await sessionResponse.json());
      webSocket = new WebSocket(buildWebSocketUrl(session.websocketPath));
      webSocket.binaryType = "arraybuffer";
      await waitForSocketOpen(webSocket);
      const sessionReady = waitForControlEvent(webSocket, "session.ready");
      webSocket.send(
        JSON.stringify({
          type: "session.start",
          protocolVersion: session.protocolVersion,
          sessionId: session.sessionId,
          token: session.token,
        }),
      );
      await sessionReady;

      const resources: VoiceResources = {
        engine,
        webSocket,
        sequence: 0,
        generationId: 0,
        intentionalClose: false,
      };
      resourcesRef.current = resources;
      webSocket.addEventListener("message", (event) => {
        handleSocketMessage(event, resources, updateSnapshot);
      });
      webSocket.addEventListener("close", () => {
        if (resources.intentionalClose) return;
        void releaseResources(resources);
        updateSnapshot((current) => ({
          ...current,
          phase: "error",
          message: "本地语音连接已断开，请重试",
        }));
      });

      const inputReady = waitForControlEvent(webSocket, "input.ready");
      webSocket.send(
        JSON.stringify({ type: "input.start", sampleRate: engine.sampleRate }),
      );
      await inputReady;
      engine.startCapture();
      setSnapshot({
        phase: "listening",
        message: `麦克风已开启 · ${engine.sampleRate / 1000}kHz 本地 PCM`,
        acknowledgedSeconds: 0,
        droppedFrames: 0,
      });
    } catch (error) {
      if (webSocket && engine) {
        await releaseResources(
          resourcesRef.current ?? {
            engine,
            webSocket,
            sequence: 0,
            generationId: 0,
            intentionalClose: true,
          },
        );
      } else if (engine) {
        await engine.close().catch(() => undefined);
      } else if (webSocket) {
        webSocket.close();
      }
      setSnapshot({
        phase: "error",
        message: describeVoiceError(error),
        acknowledgedSeconds: 0,
        droppedFrames: 0,
      });
    }
  }, [handleCapturedAudio, releaseResources, updateSnapshot]);

  const stop = useCallback(async () => {
    const resources = resourcesRef.current;
    if (!resources) {
      setSnapshot(INITIAL_SNAPSHOT);
      return;
    }
    updateSnapshot((current) => ({
      ...current,
      phase: "stopping",
      message: "正在停止麦克风…",
    }));
    await resources.engine.stopCapture();
    if (resources.webSocket.readyState === WebSocket.OPEN) {
      resources.webSocket.send(JSON.stringify({ type: "input.stop" }));
      resources.webSocket.send(JSON.stringify({ type: "session.close" }));
    }
    await releaseResources(resources);
    if (mountedRef.current) setSnapshot(INITIAL_SNAPSHOT);
  }, [releaseResources, updateSnapshot]);

  const playTestTone = useCallback(() => {
    resourcesRef.current?.engine.playTestTone();
  }, []);

  const stopPlayback = useCallback(() => {
    const resources = resourcesRef.current;
    if (!resources) return;
    resources.generationId += 1;
    resources.engine.flushPlayback(resources.generationId);
    if (resources.webSocket.readyState === WebSocket.OPEN) {
      resources.webSocket.send(
        JSON.stringify({
          type: "turn.cancel",
          generationId: resources.generationId,
        }),
      );
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void releaseResources();
    };
  }, [releaseResources]);

  return { snapshot, start, stop, playTestTone, stopPlayback };
}

export function buildWebSocketUrl(
  path: string,
  base = window.location.href,
): string {
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export function describeSessionCreationFailure(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return `无法连接语音后端（HTTP ${status}）。请确认电脑上的 npm run voice:dev:server 正在运行`;
  }
  return `创建语音会话失败（HTTP ${status}）`;
}

function handleSocketMessage(
  event: MessageEvent,
  resources: VoiceResources,
  updateSnapshot: (
    update: (current: VoiceAudioSnapshot) => VoiceAudioSnapshot,
  ) => void,
): void {
  if (event.data instanceof ArrayBuffer) {
    try {
      const frame = decodePcm16Frame(event.data);
      if (frame.kind === "output") {
        resources.engine.enqueuePlayback(
          frame.samples,
          frame.sampleRate,
          frame.generationId,
        );
      }
    } catch {
      updateSnapshot((current) => ({
        ...current,
        message: "收到无效的本地音频帧",
      }));
    }
    return;
  }
  if (typeof event.data !== "string") return;
  const message = parseJsonRecord(event.data);
  if (!message) return;
  const totalSamples = message.totalSamples;
  if (message.type === "input.audio.ack" && typeof totalSamples === "number") {
    updateSnapshot((current) => ({
      ...current,
      acknowledgedSeconds: totalSamples / resources.engine.sampleRate,
    }));
  }
  const error = message.error;
  if (message.type === "error" && isRecord(error)) {
    const errorMessage = error.message;
    updateSnapshot((current) => ({
      ...current,
      message:
        typeof errorMessage === "string"
          ? errorMessage
          : "本地语音通道发生错误",
    }));
  }
  if (
    message.type === "turn.cancelled" &&
    typeof message.generationId === "number"
  ) {
    resources.generationId = Math.max(
      resources.generationId,
      message.generationId,
    );
    resources.engine.flushPlayback(resources.generationId);
  }
}

async function waitForSocketOpen(webSocket: WebSocket): Promise<void> {
  await waitForEvent(
    webSocket,
    "open",
    () => undefined,
    "连接本地语音 WebSocket 超时",
  );
}

async function waitForControlEvent(
  webSocket: WebSocket,
  expectedType: string,
): Promise<void> {
  await waitForEvent(
    webSocket,
    "message",
    (event) => {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string")
        return false;
      const message = parseJsonRecord(event.data);
      if (message?.type === "error") {
        throw new Error("本地语音服务拒绝了会话请求");
      }
      return message?.type === expectedType;
    },
    `等待 ${expectedType} 超时`,
  );
}

function waitForEvent(
  target: WebSocket,
  eventName: "open" | "message",
  matches: (event: Event) => boolean | void,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, CONTROL_TIMEOUT_MS);
    const handleEvent = (event: Event) => {
      try {
        if (matches(event) === false) return;
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const handleError = () => {
      cleanup();
      reject(new Error("本地语音 WebSocket 连接失败"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, handleEvent);
      target.removeEventListener("error", handleError);
    };
    target.addEventListener(eventName, handleEvent);
    target.addEventListener("error", handleError, { once: true });
  });
}

function validateSessionResponse(value: unknown): SessionResponse {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    typeof value.token !== "string" ||
    typeof value.protocolVersion !== "number" ||
    typeof value.websocketPath !== "string"
  ) {
    throw new Error("本地语音会话响应格式无效");
  }
  return {
    sessionId: value.sessionId,
    token: value.token,
    protocolVersion: value.protocolVersion,
    websocketPath: value.websocketPath,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeVoiceError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风权限被拒绝，请在浏览器设置中允许后重试";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "没有找到可用的麦克风";
  }
  return error instanceof Error ? error.message : "本地语音启动失败";
}
