const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const sherpa = require("sherpa-onnx-node");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const modelRoot = path.resolve(
  process.env.VOICE_MODELS_DIR ?? path.join(repositoryRoot, "models", "voice"),
  "asr",
  "sherpa-onnx-streaming-paraformer-bilingual-zh-en",
);
const requiredFiles = ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"];

for (const filename of requiredFiles) {
  const fullPath = path.join(modelRoot, filename);
  if (!fs.existsSync(fullPath))
    throw new Error(`Missing ASR model file: ${fullPath}`);
}

const waveFiles = process.argv.slice(2);
if (waveFiles.length === 0) {
  const testWaveRoot = path.join(modelRoot, "test_wavs");
  if (fs.existsSync(testWaveRoot)) {
    waveFiles.push(
      ...fs
        .readdirSync(testWaveRoot)
        .filter((name) => name.endsWith(".wav"))
        .slice(0, 3)
        .map((name) => path.join(testWaveRoot, name)),
    );
  }
}
if (waveFiles.length === 0)
  throw new Error("Pass at least one WAV file to probe ASR");

const recognizer = new sherpa.OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    paraformer: {
      encoder: path.join(modelRoot, "encoder.int8.onnx"),
      decoder: path.join(modelRoot, "decoder.int8.onnx"),
    },
    tokens: path.join(modelRoot, "tokens.txt"),
    numThreads: 2,
    provider: "cpu",
    debug: false,
  },
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 0.8,
  rule3MinUtteranceLength: 20,
});

const reports = [];
for (const waveFile of waveFiles) {
  const wave = sherpa.readWave(path.resolve(waveFile));
  const stream = recognizer.createStream();
  const startedAt = performance.now();
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
  stream.acceptWaveform({
    sampleRate: wave.sampleRate,
    samples: new Float32Array(Math.round(wave.sampleRate * 0.5)),
  });
  stream.inputFinished();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const elapsedMs = performance.now() - startedAt;
  const durationSeconds = wave.samples.length / wave.sampleRate;
  reports.push({
    waveFile: path.relative(repositoryRoot, path.resolve(waveFile)),
    sampleRate: wave.sampleRate,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    elapsedMs: Number(elapsedMs.toFixed(1)),
    realTimeFactor: Number((elapsedMs / 1000 / durationSeconds).toFixed(3)),
    text: recognizer.getResult(stream).text,
  });
}

console.log(
  JSON.stringify(
    { model: path.relative(repositoryRoot, modelRoot), reports },
    null,
    2,
  ),
);
