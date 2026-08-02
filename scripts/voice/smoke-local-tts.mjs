import { createLocalSpeechSynthesisService } from "../../apps/server/dist/index.js";

const service = await createLocalSpeechSynthesisService(
  process.env.VOICE_MODELS_DIR,
  Number(process.env.VOICE_TTS_THREADS ?? 4),
);
const text =
  process.argv.slice(2).join(" ") || "这手连对可以先出，注意保留一张大牌。";
const startedAt = performance.now();
let firstAudioMs;
let sampleRate;
let sampleCount = 0;
let chunkCount = 0;

try {
  await service.synthesize("tts-smoke", 0, text, (chunk) => {
    if (firstAudioMs === undefined)
      firstAudioMs = performance.now() - startedAt;
    sampleRate = chunk.sampleRate;
    sampleCount += chunk.samples.length;
    chunkCount += 1;
  });
  if (!sampleRate || sampleCount === 0) {
    throw new Error("TTS smoke returned no audio");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        text,
        firstAudioMs: Number(firstAudioMs.toFixed(1)),
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        sampleRate,
        durationSeconds: Number((sampleCount / sampleRate).toFixed(3)),
        sampleCount,
        chunkCount,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  service.remove("tts-smoke");
  await service.close();
}
