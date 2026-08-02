import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";

import type {
  SpeechSynthesisService,
  SynthesizedAudioChunk,
} from "./speech-synthesis.js";
import type {
  TtsWorkerConfig,
  TtsWorkerRequest,
  TtsWorkerResponse,
} from "./tts-worker-protocol.js";

interface PendingSynthesis {
  readonly sessionId: string;
  readonly generationId: number;
  readonly onAudio: (chunk: SynthesizedAudioChunk) => void;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export async function createLocalSpeechSynthesisService(
  modelDirectory = resolve(process.cwd(), "models", "voice"),
  numThreads = 4,
): Promise<SpeechSynthesisService> {
  const config = resolveTtsWorkerConfig(modelDirectory, numThreads);
  const worker = new Worker(new URL("./tts-worker.js", import.meta.url));
  const pending = new Map<string, PendingSynthesis>();
  let closed = false;

  await new Promise<void>((resolveReady, rejectReady) => {
    const handleInitialMessage = (message: TtsWorkerResponse) => {
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

  worker.on("message", (message: TtsWorkerResponse) => {
    if (!("requestId" in message)) return;
    const request = pending.get(message.requestId);
    if (!request) return;
    if (message.type === "audio") {
      request.onAudio({
        sampleRate: message.sampleRate,
        samples: message.samples,
      });
      return;
    }
    pending.delete(message.requestId);
    if (message.type === "error") request.reject(new Error(message.message));
    else request.resolve();
  });
  worker.on("error", (error: unknown) => {
    const failure =
      error instanceof Error ? error : new Error("TTS worker failed");
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  });

  const cancel = (sessionId: string): void => {
    if (closed) return;
    post(worker, { type: "cancel", sessionId });
    for (const [requestId, request] of pending) {
      if (request.sessionId === sessionId) {
        request.resolve();
        pending.delete(requestId);
      }
    }
  };

  return {
    async synthesize(sessionId, generationId, text, onAudio) {
      if (closed) throw new Error("Speech synthesis service is closed");
      const requestId = randomUUID();
      await new Promise<void>((resolveSynthesis, rejectSynthesis) => {
        pending.set(requestId, {
          sessionId,
          generationId,
          onAudio,
          resolve: resolveSynthesis,
          reject: rejectSynthesis,
        });
        post(worker, {
          type: "synthesize",
          requestId,
          sessionId,
          generationId,
          text,
        });
      });
    },
    cancel,
    remove(sessionId) {
      cancel(sessionId);
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const request of pending.values()) request.resolve();
      pending.clear();
      await worker.terminate();
    },
  };
}

export function resolveTtsWorkerConfig(
  modelDirectory: string,
  numThreads: number,
): TtsWorkerConfig {
  if (!Number.isInteger(numThreads) || numThreads < 1 || numThreads > 16) {
    throw new Error("VOICE_TTS_THREADS must be an integer between 1 and 16");
  }
  const modelRoot = resolve(modelDirectory, "tts", "vits-melo-tts-zh_en");
  const config = {
    modelPath: resolve(modelRoot, "model.onnx"),
    tokensPath: resolve(modelRoot, "tokens.txt"),
    lexiconPath: resolve(modelRoot, "lexicon.txt"),
    ruleFsts: ["date.fst", "phone.fst", "number.fst"]
      .map((name) => resolve(modelRoot, name))
      .join(","),
    numThreads,
  } satisfies TtsWorkerConfig;
  for (const [name, path] of [
    ["modelPath", config.modelPath],
    ["tokensPath", config.tokensPath],
    ["lexiconPath", config.lexiconPath],
    ...config.ruleFsts.split(",").map((path) => ["ruleFst", path]),
  ]) {
    if (path && !existsSync(path)) throw new Error(`Missing ${name}: ${path}`);
  }
  return config;
}

function post(worker: Worker, message: TtsWorkerRequest): void {
  worker.postMessage(message);
}
