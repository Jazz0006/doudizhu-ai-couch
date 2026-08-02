import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

import type {
  TtsWorkerConfig,
  TtsWorkerRequest,
  TtsWorkerResponse,
} from "./tts-worker-protocol.js";

interface GeneratedAudio {
  readonly samples: Float32Array;
  readonly sampleRate?: number;
}

interface OfflineTts {
  readonly sampleRate: number;
  generateAsync(options: {
    readonly text: string;
    readonly enableExternalBuffer: boolean;
    readonly generationConfig: object;
    readonly onProgress: (chunk: GeneratedAudio) => boolean | number;
  }): Promise<GeneratedAudio>;
}

interface SherpaModule {
  readonly OfflineTts: {
    createAsync(config: object): Promise<OfflineTts>;
  };
  readonly GenerationConfig: new (config: object) => object;
}

interface SynthesisJob {
  readonly requestId: string;
  readonly sessionId: string;
  readonly generationId: number;
  readonly text: string;
}

const port = parentPort;
if (!port) throw new Error("TTS worker must run in a worker thread");
const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node") as SherpaModule;
const queue: SynthesisJob[] = [];
const cancelledRequests = new Set<string>();
let tts: OfflineTts | undefined;
let draining = false;
let activeJob: SynthesisJob | undefined;

port.on("message", (message: TtsWorkerRequest) => {
  if (message.type === "initialize") {
    void initialize(message.config);
    return;
  }
  if (message.type === "cancel") {
    if (activeJob?.sessionId === message.sessionId) {
      cancelledRequests.add(activeJob.requestId);
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const job = queue[index];
      if (job?.sessionId === message.sessionId) {
        queue.splice(index, 1);
        send({ type: "cancelled", requestId: job.requestId });
      }
    }
    return;
  }
  queue.push(message);
  void drainQueue();
});

async function initialize(config: TtsWorkerConfig): Promise<void> {
  try {
    tts = await sherpa.OfflineTts.createAsync({
      model: {
        vits: {
          model: config.modelPath,
          tokens: config.tokensPath,
          lexicon: config.lexiconPath,
        },
        debug: false,
        numThreads: config.numThreads,
        provider: "cpu",
      },
      ruleFsts: config.ruleFsts,
      maxNumSentences: 1,
    });
    send({ type: "ready", sampleRate: tts.sampleRate });
  } catch (error) {
    send({
      type: "fatal",
      message:
        error instanceof Error ? error.message : "TTS initialization failed",
    });
  }
}

async function drainQueue(): Promise<void> {
  if (draining || !tts) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) continue;
      if (cancelledRequests.has(job.requestId)) {
        send({ type: "cancelled", requestId: job.requestId });
        cancelledRequests.delete(job.requestId);
        continue;
      }
      activeJob = job;
      await synthesize(job);
      activeJob = undefined;
    }
  } finally {
    draining = false;
  }
}

async function synthesize(job: SynthesisJob): Promise<void> {
  if (!tts) return;
  let emittedAudio = false;
  try {
    const audio = await tts.generateAsync({
      text: job.text,
      enableExternalBuffer: true,
      generationConfig: new sherpa.GenerationConfig({
        sid: 0,
        speed: 1,
        silenceScale: 0.2,
      }),
      onProgress: ({ samples, sampleRate }) => {
        if (cancelledRequests.has(job.requestId)) return false;
        if (samples.length > 0) {
          emittedAudio = true;
          sendAudio(
            job.requestId,
            sampleRate ?? tts?.sampleRate ?? 16_000,
            samples,
          );
        }
        return true;
      },
    });
    if (cancelledRequests.has(job.requestId)) {
      send({ type: "cancelled", requestId: job.requestId });
      cancelledRequests.delete(job.requestId);
      return;
    }
    if (!emittedAudio && audio.samples.length > 0) {
      sendAudio(
        job.requestId,
        audio.sampleRate ?? tts.sampleRate,
        audio.samples,
      );
    }
    send({ type: "completed", requestId: job.requestId });
  } catch (error) {
    if (cancelledRequests.has(job.requestId)) {
      send({ type: "cancelled", requestId: job.requestId });
      cancelledRequests.delete(job.requestId);
      return;
    }
    send({
      type: "error",
      requestId: job.requestId,
      message: error instanceof Error ? error.message : "TTS synthesis failed",
    });
  }
}

function sendAudio(
  requestId: string,
  sampleRate: number,
  samples: Float32Array,
): void {
  const copy = new Float32Array(samples);
  const message: TtsWorkerResponse = {
    type: "audio",
    requestId,
    sampleRate,
    samples: copy,
  };
  port?.postMessage(message, [copy.buffer]);
}

function send(message: TtsWorkerResponse): void {
  port?.postMessage(message);
}
