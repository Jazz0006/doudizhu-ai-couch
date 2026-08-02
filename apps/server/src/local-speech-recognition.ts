import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import type {
  SpeechRecognitionEvent,
  SpeechRecognitionService,
} from "./speech-recognition.js";
import type {
  SpeechWorkerConfig,
  SpeechWorkerRequest,
  SpeechWorkerResponse,
} from "./speech-worker-protocol.js";

const MAX_PENDING_AUDIO_MESSAGES = 100;

interface SessionClientState {
  readonly onEvent: (event: SpeechRecognitionEvent) => void;
  pendingAudioMessages: number;
  reportedBackpressure: boolean;
}

export async function createLocalSpeechRecognitionService(
  modelDirectory = resolve(process.cwd(), "models", "voice"),
): Promise<SpeechRecognitionService> {
  const config = resolveWorkerConfig(modelDirectory);
  const worker = new Worker(new URL("./speech-worker.js", import.meta.url));
  const sessions = new Map<string, SessionClientState>();
  const stopWaiters = new Map<string, () => void>();
  let closed = false;

  await new Promise<void>((resolveReady, rejectReady) => {
    const handleInitialMessage = (message: SpeechWorkerResponse) => {
      if (message.type === "ready") {
        worker.off("message", handleInitialMessage);
        resolveReady();
      } else if (message.type === "fatal") {
        worker.off("message", handleInitialMessage);
        rejectReady(new Error(message.message));
      }
    };
    worker.on("message", handleInitialMessage);
    worker.once("error", rejectReady);
    post(worker, { type: "initialize", config });
  }).catch(async (error: unknown) => {
    await worker.terminate();
    throw error;
  });

  worker.on("message", (message: SpeechWorkerResponse) => {
    if (message.type === "audio.processed") {
      const session = sessions.get(message.sessionId);
      if (session) {
        session.pendingAudioMessages = Math.max(
          0,
          session.pendingAudioMessages - 1,
        );
        if (session.pendingAudioMessages < MAX_PENDING_AUDIO_MESSAGES / 2) {
          session.reportedBackpressure = false;
        }
      }
      return;
    }
    if (message.type === "event") {
      sessions.get(message.sessionId)?.onEvent(message.event);
    }
    if (message.type === "session.stopped") {
      stopWaiters.get(message.sessionId)?.();
      stopWaiters.delete(message.sessionId);
    }
  });
  worker.on("error", (error) => {
    const message =
      error instanceof Error ? error.message : "Unknown worker error";
    for (const session of sessions.values()) {
      session.onEvent({
        type: "recognition.error",
        code: "RECOGNITION_WORKER_FAILED",
        message,
        recoverable: false,
      });
    }
  });

  return {
    start(sessionId, sampleRate, onEvent) {
      assertOpen(closed);
      sessions.set(sessionId, {
        onEvent,
        pendingAudioMessages: 0,
        reportedBackpressure: false,
      });
      post(worker, { type: "session.start", sessionId, sampleRate });
    },
    acceptAudio(sessionId, samples) {
      const session = sessions.get(sessionId);
      if (!session || closed) return;
      if (session.pendingAudioMessages >= MAX_PENDING_AUDIO_MESSAGES) {
        if (!session.reportedBackpressure) {
          session.reportedBackpressure = true;
          session.onEvent({
            type: "recognition.error",
            code: "RECOGNITION_BACKPRESSURE",
            message:
              "Speech recognition is falling behind; stale audio was dropped",
            recoverable: true,
          });
        }
        return;
      }
      const copy = new Float32Array(samples);
      session.pendingAudioMessages += 1;
      post(worker, { type: "audio", sessionId, samples: copy }, [copy.buffer]);
    },
    async stop(sessionId) {
      if (closed || !sessions.has(sessionId)) return;
      await new Promise<void>((resolveStopped) => {
        stopWaiters.set(sessionId, resolveStopped);
        post(worker, { type: "session.stop", sessionId });
      });
    },
    remove(sessionId) {
      sessions.delete(sessionId);
      stopWaiters.get(sessionId)?.();
      stopWaiters.delete(sessionId);
      if (!closed) post(worker, { type: "session.remove", sessionId });
    },
    async close() {
      if (closed) return;
      closed = true;
      sessions.clear();
      for (const resolveStopped of stopWaiters.values()) resolveStopped();
      stopWaiters.clear();
      await worker.terminate();
    },
  };
}

export function resolveWorkerConfig(
  modelDirectory: string,
): SpeechWorkerConfig {
  const config = {
    vadModelPath: resolve(modelDirectory, "vad", "silero_vad.onnx"),
    asrEncoderPath: resolve(
      modelDirectory,
      "asr",
      "sherpa-onnx-streaming-paraformer-bilingual-zh-en",
      "encoder.int8.onnx",
    ),
    asrDecoderPath: resolve(
      modelDirectory,
      "asr",
      "sherpa-onnx-streaming-paraformer-bilingual-zh-en",
      "decoder.int8.onnx",
    ),
    asrTokensPath: resolve(
      modelDirectory,
      "asr",
      "sherpa-onnx-streaming-paraformer-bilingual-zh-en",
      "tokens.txt",
    ),
  } satisfies SpeechWorkerConfig;

  for (const [name, path] of Object.entries(config)) {
    if (!existsSync(path)) throw new Error(`Missing ${name}: ${path}`);
  }
  return config;
}

function post(
  worker: Worker,
  message: SpeechWorkerRequest,
  transferList: ArrayBuffer[] = [],
): void {
  worker.postMessage(message, transferList);
}

function assertOpen(closed: boolean): void {
  if (closed) throw new Error("Speech recognition service is closed");
}
