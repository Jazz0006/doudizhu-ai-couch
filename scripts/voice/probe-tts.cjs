const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const sherpa = require("sherpa-onnx-node");

async function main() {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const arguments_ = process.argv.slice(2);
  const modelArgument = arguments_.find((value) =>
    value.startsWith("--model="),
  );
  const threadsArgument = arguments_.find((value) =>
    value.startsWith("--threads="),
  );
  const modelKind =
    modelArgument?.slice("--model=".length) ??
    process.env.VOICE_TTS_MODEL ??
    "kokoro";
  if (!new Set(["kokoro", "melo"]).has(modelKind)) {
    throw new Error("VOICE_TTS_MODEL must be kokoro or melo");
  }
  const modelDirectory =
    modelKind === "kokoro" ? "kokoro-multi-lang-v1_1" : "vits-melo-tts-zh_en";
  const modelRoot = path.resolve(
    process.env.VOICE_MODELS_DIR ??
      path.join(repositoryRoot, "models", "voice"),
    "tts",
    modelDirectory,
  );
  const requiredFiles =
    modelKind === "kokoro"
      ? ["model.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt"]
      : ["model.onnx", "tokens.txt", "lexicon.txt"];
  for (const filename of requiredFiles) {
    const fullPath = path.join(modelRoot, filename);
    if (!fs.existsSync(fullPath))
      throw new Error(`Missing TTS model file: ${fullPath}`);
  }

  const text =
    arguments_.filter((value) => !value.startsWith("--")).join(" ") ||
    "这手连对可以先出，注意保留一张大牌取得出牌权。";
  const outputRoot = path.join(
    repositoryRoot,
    "models",
    "voice",
    "probe-output",
  );
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputFile = path.join(outputRoot, `${modelKind}-probe.wav`);
  const numThreads = Number(
    threadsArgument?.slice("--threads=".length) ??
      process.env.VOICE_NUM_THREADS ??
      4,
  );
  const modelConfig =
    modelKind === "kokoro"
      ? {
          kokoro: {
            model: path.join(modelRoot, "model.onnx"),
            voices: path.join(modelRoot, "voices.bin"),
            tokens: path.join(modelRoot, "tokens.txt"),
            dataDir: path.join(modelRoot, "espeak-ng-data"),
            lexicon: [
              path.join(modelRoot, "lexicon-us-en.txt"),
              path.join(modelRoot, "lexicon-zh.txt"),
            ].join(","),
          },
          debug: false,
          numThreads,
          provider: "cpu",
        }
      : {
          vits: {
            model: path.join(modelRoot, "model.onnx"),
            tokens: path.join(modelRoot, "tokens.txt"),
            lexicon: path.join(modelRoot, "lexicon.txt"),
          },
          debug: false,
          numThreads,
          provider: "cpu",
        };
  const ttsConfig = { model: modelConfig, maxNumSentences: 1 };
  if (modelKind === "melo") {
    ttsConfig.ruleFsts = ["date.fst", "phone.fst", "number.fst"]
      .map((name) => path.join(modelRoot, name))
      .join(",");
  }
  const tts = await sherpa.OfflineTts.createAsync(ttsConfig);

  let firstChunkMs;
  let chunkCount = 0;
  const startedAt = performance.now();
  const audio = await tts.generateAsync({
    text,
    enableExternalBuffer: true,
    generationConfig: new sherpa.GenerationConfig({
      sid: modelKind === "kokoro" ? 48 : 0,
      speed: 1,
      silenceScale: 0.2,
    }),
    onProgress: ({ samples }) => {
      chunkCount += 1;
      if (firstChunkMs === undefined && samples.length > 0)
        firstChunkMs = performance.now() - startedAt;
      return 1;
    },
  });
  const elapsedMs = performance.now() - startedAt;
  const durationSeconds = audio.samples.length / audio.sampleRate;
  sherpa.writeWave(outputFile, {
    samples: audio.samples,
    sampleRate: audio.sampleRate,
  });

  console.log(
    JSON.stringify(
      {
        modelKind,
        numThreads,
        text,
        outputFile: path.relative(repositoryRoot, outputFile),
        sampleRate: audio.sampleRate,
        durationSeconds: Number(durationSeconds.toFixed(3)),
        firstChunkMs:
          firstChunkMs === undefined ? null : Number(firstChunkMs.toFixed(1)),
        elapsedMs: Number(elapsedMs.toFixed(1)),
        realTimeFactor: Number((elapsedMs / 1000 / durationSeconds).toFixed(3)),
        chunkCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
