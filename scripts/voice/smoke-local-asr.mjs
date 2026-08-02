import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import sherpa from "sherpa-onnx-node";

import { createLocalSpeechRecognitionService } from "../../apps/server/dist/index.js";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const asrDirectory = resolve(
  process.env.VOICE_MODELS_DIR ?? resolve(repositoryRoot, "models", "voice"),
  "asr",
  "sherpa-onnx-streaming-paraformer-bilingual-zh-en",
);
const defaultWaveDirectory = resolve(asrDirectory, "test_wavs");
const requestedWave = process.argv[2];
const wavePath = requestedWave
  ? resolve(requestedWave)
  : resolve(
      defaultWaveDirectory,
      readdirSync(defaultWaveDirectory).find((name) => name.endsWith(".wav")) ??
        "missing.wav",
    );

if (!existsSync(wavePath))
  throw new Error(`Missing ASR smoke WAV: ${wavePath}`);

const service = await createLocalSpeechRecognitionService(
  process.env.VOICE_MODELS_DIR,
);
const wave = sherpa.readWave(wavePath);
const events = [];
const startedAt = performance.now();

try {
  const final = await new Promise((resolveFinal, rejectFinal) => {
    const timeout = setTimeout(() => {
      rejectFinal(
        new Error(`ASR smoke timed out; events: ${events.join(", ")}`),
      );
    }, 15_000);

    service.start("asr-smoke", wave.sampleRate, (event) => {
      events.push(event.type);
      if (event.type === "recognition.error") {
        clearTimeout(timeout);
        rejectFinal(new Error(`${event.code}: ${event.message}`));
      }
      if (event.type === "transcript.final") {
        clearTimeout(timeout);
        resolveFinal(event);
      }
    });
    service.acceptAudio("asr-smoke", wave.samples);
    service.acceptAudio("asr-smoke", new Float32Array(wave.sampleRate * 2));
  });

  if (!events.includes("speech.started")) {
    throw new Error("ASR smoke did not detect speech");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        wavePath,
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        events,
        final,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  service.remove("asr-smoke");
  await service.close();
}
