import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

import { normalizeDoudizhuTerms } from "./doudizhu-terms.js";
import type {
  SpeechWorkerConfig,
  SpeechWorkerRequest,
  SpeechWorkerResponse,
} from "./speech-worker-protocol.js";

interface OnlineStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

interface OnlineRecognizer {
  createStream(): OnlineStream;
  isReady(stream: OnlineStream): boolean;
  decode(stream: OnlineStream): void;
  getResult(stream: OnlineStream): { text: string };
  reset(stream: OnlineStream): void;
}

interface VoiceActivityDetector {
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  isEmpty(): boolean;
  pop(): void;
  flush(): void;
}

interface LinearResampler {
  resample(samples: Float32Array): Float32Array;
  flush(samples: Float32Array): Float32Array;
}

interface SherpaModule {
  readonly OnlineRecognizer: new (config: object) => OnlineRecognizer;
  readonly Vad: new (
    config: object,
    bufferSizeInSeconds: number,
  ) => VoiceActivityDetector;
  readonly LinearResampler: new (
    inputSampleRate: number,
    outputSampleRate: number,
  ) => LinearResampler;
}

interface WorkerSession {
  readonly resampler: LinearResampler;
  readonly vad: VoiceActivityDetector;
  readonly stream: OnlineStream;
  speechActive: boolean;
  lastPartial: string;
  pendingSamples: Float32Array;
}

const port = parentPort;
if (!port) throw new Error("Speech worker must run in a worker thread");

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node") as SherpaModule;
const sessions = new Map<string, WorkerSession>();
let recognizer: OnlineRecognizer | undefined;
let config: SpeechWorkerConfig | undefined;

port.on("message", (message: SpeechWorkerRequest) => {
  try {
    handleMessage(message);
  } catch (error) {
    const description =
      error instanceof Error ? error.message : "Unknown error";
    if ("sessionId" in message) {
      emit(message.sessionId, {
        type: "recognition.error",
        code: "RECOGNITION_FAILED",
        message: description,
        recoverable: false,
      });
    } else {
      send({ type: "fatal", message: description });
    }
  } finally {
    if (message.type === "audio") {
      send({ type: "audio.processed", sessionId: message.sessionId });
    }
    if (message.type === "session.stop") {
      send({ type: "session.stopped", sessionId: message.sessionId });
    }
  }
});

function handleMessage(message: SpeechWorkerRequest): void {
  switch (message.type) {
    case "initialize":
      initialize(message.config);
      break;
    case "session.start":
      startSession(message.sessionId, message.sampleRate);
      break;
    case "audio":
      processAudio(message.sessionId, message.samples, false);
      break;
    case "session.stop":
      stopSession(message.sessionId);
      break;
    case "session.remove":
      sessions.delete(message.sessionId);
      break;
  }
}

function initialize(workerConfig: SpeechWorkerConfig): void {
  config = workerConfig;
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      paraformer: {
        encoder: config.asrEncoderPath,
        decoder: config.asrDecoderPath,
      },
      tokens: config.asrTokensPath,
      numThreads: 2,
      provider: "cpu",
      debug: false,
    },
    enableEndpoint: false,
  });
  send({ type: "ready" });
}

function startSession(sessionId: string, sampleRate: number): void {
  if (!recognizer || !config)
    throw new Error("Recognition worker is not ready");
  sessions.set(sessionId, {
    resampler: new sherpa.LinearResampler(sampleRate, 16_000),
    vad: new sherpa.Vad(
      {
        sileroVad: {
          model: config.vadModelPath,
          threshold: 0.5,
          minSilenceDuration: 0.65,
          minSpeechDuration: 0.15,
          windowSize: 512,
          maxSpeechDuration: 20,
        },
        sampleRate: 16_000,
        numThreads: 1,
        provider: "cpu",
        debug: false,
      },
      30,
    ),
    stream: recognizer.createStream(),
    speechActive: false,
    lastPartial: "",
    pendingSamples: new Float32Array(),
  });
}

function processAudio(
  sessionId: string,
  input: Float32Array,
  flush: boolean,
): void {
  const session = sessions.get(sessionId);
  if (!session || !recognizer) return;
  const samples = flush
    ? session.resampler.flush(input)
    : session.resampler.resample(input);
  if (samples.length === 0) return;
  session.pendingSamples = concatenate(session.pendingSamples, samples);
  while (session.pendingSamples.length >= 512) {
    const window = session.pendingSamples.slice(0, 512);
    session.pendingSamples = session.pendingSamples.slice(512);
    processWindow(sessionId, session, window);
  }
}

function stopSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || !recognizer) return;
  processAudio(sessionId, new Float32Array(), true);
  if (session.pendingSamples.length > 0) {
    const padded = new Float32Array(512);
    padded.set(session.pendingSamples);
    session.pendingSamples = new Float32Array();
    processWindow(sessionId, session, padded);
  }
  session.vad.flush();
  drainVadSegments(sessionId, session);
  session.stream.inputFinished();
  while (recognizer.isReady(session.stream)) recognizer.decode(session.stream);
  finalizeUtterance(sessionId, session);
  sessions.delete(sessionId);
}

function processWindow(
  sessionId: string,
  session: WorkerSession,
  samples: Float32Array,
): void {
  if (!recognizer) return;
  session.vad.acceptWaveform(samples);
  session.stream.acceptWaveform({ sampleRate: 16_000, samples });
  while (recognizer.isReady(session.stream)) recognizer.decode(session.stream);

  if (session.vad.isDetected() && !session.speechActive) {
    session.speechActive = true;
    emit(sessionId, { type: "speech.started" });
  }
  emitPartial(sessionId, session);
  drainVadSegments(sessionId, session);
}

function drainVadSegments(sessionId: string, session: WorkerSession): void {
  while (!session.vad.isEmpty()) {
    session.vad.pop();
    finalizeUtterance(sessionId, session);
  }
}

function concatenate(left: Float32Array, right: Float32Array): Float32Array {
  if (left.length === 0) return right;
  const joined = new Float32Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

function emitPartial(sessionId: string, session: WorkerSession): void {
  if (!recognizer) return;
  const rawText = recognizer.getResult(session.stream).text.trim();
  if (!rawText || rawText === session.lastPartial) return;
  session.lastPartial = rawText;
  emit(sessionId, {
    type: "transcript.partial",
    rawText,
    text: normalizeDoudizhuTerms(rawText),
  });
}

function finalizeUtterance(sessionId: string, session: WorkerSession): void {
  if (!recognizer) return;
  const rawText = recognizer.getResult(session.stream).text.trim();
  if (rawText) {
    emit(sessionId, {
      type: "transcript.final",
      rawText,
      text: normalizeDoudizhuTerms(rawText),
    });
  }
  if (session.speechActive) emit(sessionId, { type: "speech.ended" });
  recognizer.reset(session.stream);
  session.speechActive = false;
  session.lastPartial = "";
}

function emit(
  sessionId: string,
  event: import("./speech-recognition.js").SpeechRecognitionEvent,
): void {
  send({ type: "event", sessionId, event });
}

function send(message: SpeechWorkerResponse): void {
  port?.postMessage(message);
}
