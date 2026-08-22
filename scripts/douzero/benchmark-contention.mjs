import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sherpa from "sherpa-onnx-node";

import {
  createLocalSpeechRecognitionService,
  createLocalSpeechSynthesisService,
} from "../../apps/server/dist/index.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BENCHMARK_PATH = path.join(ROOT, "scripts", "douzero", "benchmark.mjs");
const VOICE_ROOT = path.join(ROOT, "models", "voice");
const REPORT_PATH = path.join(
  ROOT,
  "services",
  "douzero-inference",
  "benchmarks",
  "2026-08-22-windows-cpu-contention.json",
);
const ITERATIONS = 136;
const WARMUP = 5;

const baseline = await runStrategyBenchmark();
const voice = await runVoiceScenario();
const ollama = await runOllamaScenario();
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  strategyModelVersion: baseline.modelVersion,
  strategyObjective: baseline.objective,
  parameters: { iterations: ITERATIONS, warmup: WARMUP, coldStarts: 1 },
  baseline: summarizeStrategy(baseline),
  voice,
  ollama,
};

await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function runVoiceScenario() {
  let recognition;
  let synthesis;
  try {
    recognition = await createLocalSpeechRecognitionService(VOICE_ROOT);
    synthesis = await createLocalSpeechSynthesisService(VOICE_ROOT, 4);
  } catch (error) {
    await recognition?.close();
    await synthesis?.close();
    return skipped(error);
  }

  const wave = loadAsrWave();
  const workload = createVoiceWorkload(recognition, synthesis, wave);
  try {
    const strategy = await runStrategyBenchmark();
    await workload.stop();
    return {
      status: "measured",
      strategy: summarizeStrategy(strategy),
      deltaFromBaseline: compareStrategy(strategy, baseline),
      workload: workload.metrics,
    };
  } finally {
    await workload.stop();
    await recognition.close();
    await synthesis.close();
  }
}

async function runOllamaScenario() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok)
      throw new Error(`Ollama returned HTTP ${response.status}`);
    const tags = await response.json();
    const installed = Array.isArray(tags.models)
      ? tags.models.some(({ name }) => name === model)
      : false;
    if (!installed) return skipped(`Ollama model is not installed: ${model}`);
  } catch (error) {
    return skipped(error);
  }

  const workload = createOllamaWorkload(baseUrl, model);
  try {
    await workload.ready;
    const strategy = await runStrategyBenchmark();
    await workload.stop();
    return {
      status: "measured",
      strategy: summarizeStrategy(strategy),
      deltaFromBaseline: compareStrategy(strategy, baseline),
      workload: workload.metrics,
    };
  } finally {
    await workload.stop();
  }
}

function createVoiceWorkload(recognition, synthesis, wave) {
  let stopping = false;
  let activeAsrSession;
  let stopActiveAsr;
  const metrics = { asrRuns: 0, ttsRuns: 0, errors: [] };
  const asrLoop = (async () => {
    while (!stopping) {
      const sessionId = `contention-asr-${metrics.asrRuns}`;
      activeAsrSession = sessionId;
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("ASR contention run timed out")),
            15_000,
          );
          const finish = () => {
            clearTimeout(timeout);
            resolve();
          };
          stopActiveAsr = finish;
          recognition.start(sessionId, wave.sampleRate, (event) => {
            if (event.type === "recognition.error") {
              clearTimeout(timeout);
              reject(new Error(`${event.code}: ${event.message}`));
            } else if (event.type === "transcript.final") {
              finish();
            }
          });
          recognition.acceptAudio(sessionId, wave.samples);
          recognition.acceptAudio(
            sessionId,
            new Float32Array(wave.sampleRate * 2),
          );
        });
        metrics.asrRuns += 1;
      } catch (error) {
        metrics.errors.push(errorMessage(error));
        stopping = true;
      } finally {
        stopActiveAsr = undefined;
        activeAsrSession = undefined;
        recognition.remove(sessionId);
      }
    }
  })();
  const ttsLoop = (async () => {
    while (!stopping) {
      try {
        await synthesis.synthesize(
          "contention-tts",
          metrics.ttsRuns,
          "这手连对可以先出，注意保留一张大牌控制牌权。",
          () => {},
        );
        metrics.ttsRuns += 1;
      } catch (error) {
        metrics.errors.push(errorMessage(error));
        stopping = true;
      }
    }
  })();
  return {
    metrics,
    async stop() {
      stopping = true;
      if (activeAsrSession) recognition.remove(activeAsrSession);
      stopActiveAsr?.();
      synthesis.cancel("contention-tts");
      return Promise.allSettled([asrLoop, ttsLoop]);
    },
  };
}

function createOllamaWorkload(baseUrl, model) {
  let stopping = false;
  let controller;
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));
  const metrics = {
    startedRequests: 0,
    completedRequests: 0,
    abortedRequests: 0,
    errors: [],
  };
  const loop = (async () => {
    while (!stopping) {
      controller = new AbortController();
      metrics.startedRequests += 1;
      markReady();
      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            messages: [
              {
                role: "user",
                content: "用两句话比较斗地主中保留大牌和尽快走牌的取舍。",
              },
            ],
            options: { num_ctx: 4096, num_predict: 160, temperature: 0.3 },
          }),
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Ollama returned HTTP ${response.status}`);
        await response.arrayBuffer();
        metrics.completedRequests += 1;
      } catch (error) {
        if (stopping && controller.signal.aborted) metrics.abortedRequests += 1;
        else metrics.errors.push(errorMessage(error));
      }
    }
  })();
  return {
    metrics,
    ready,
    async stop() {
      stopping = true;
      controller?.abort();
      await loop;
    },
  };
}

function loadAsrWave() {
  const directory = path.join(
    VOICE_ROOT,
    "asr",
    "sherpa-onnx-streaming-paraformer-bilingual-zh-en",
    "test_wavs",
  );
  const filename = readdirSync(directory).find((name) => name.endsWith(".wav"));
  if (!filename) throw new Error(`No ASR test WAV found in ${directory}`);
  return sherpa.readWave(path.join(directory, filename));
}

function runStrategyBenchmark() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        BENCHMARK_PATH,
        "--iterations",
        String(ITERATIONS),
        "--warmup",
        String(WARMUP),
        "--cold-starts",
        "1",
        "--startup-timeout-ms",
        "60000",
        "--timeout-ms",
        "5000",
      ],
      { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Strategy benchmark failed (${code}): ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Strategy benchmark returned invalid JSON: ${error}`));
      }
    });
  });
}

function summarizeStrategy(report) {
  return {
    coldStartP50Ms: report.coldStartMs.p50,
    endToEndP50Ms: report.endToEndLatencyMs.p50,
    endToEndP95Ms: report.endToEndLatencyMs.p95,
    endToEndMaxMs: report.endToEndLatencyMs.max,
    modelP95Ms: report.modelLatencyMs.p95,
    workerRssBytes: report.workerRssBytes.afterBenchmark,
  };
}

function compareStrategy(report, reference) {
  return {
    endToEndP50Ratio: ratio(
      report.endToEndLatencyMs.p50,
      reference.endToEndLatencyMs.p50,
    ),
    endToEndP95Ratio: ratio(
      report.endToEndLatencyMs.p95,
      reference.endToEndLatencyMs.p95,
    ),
    rssRatio: ratio(
      report.workerRssBytes.afterBenchmark,
      reference.workerRssBytes.afterBenchmark,
    ),
  };
}

function ratio(value, reference) {
  return Math.round((value / reference) * 1_000) / 1_000;
}

function skipped(reason) {
  return { status: "skipped", reason: errorMessage(reason) };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
