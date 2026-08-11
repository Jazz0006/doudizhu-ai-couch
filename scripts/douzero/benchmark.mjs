import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCoachGameContextUpdate,
  getPlayerVisibleState,
} from "../../packages/coach-protocol/dist/index.js";
import {
  createGame,
  passTurn,
  playCards,
  submitBid,
} from "../../packages/game-core/dist/index.js";
import { DouZeroWorkerClient } from "../../apps/server/dist/index.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SERVICE_ROOT = path.join(ROOT, "services", "douzero-inference");
const options = parseArguments(process.argv.slice(2));
const runtime = resolveRuntime();
const cases = createCases();
const selectedCases = cases.slice(
  0,
  Math.min(options.iterations, cases.length),
);
const requestLatencies = [];
const modelLatencies = [];
const coldStartLatencies = [];
let workerPid;
let client;
let report;
try {
  for (let index = 0; index < options.coldStarts; index += 1) {
    const candidate = createClient((pid) => {
      if (index === options.coldStarts - 1) workerPid = pid;
    });
    try {
      const coldStartedAt = performance.now();
      await candidate.warmup();
      coldStartLatencies.push(performance.now() - coldStartedAt);
      if (index === options.coldStarts - 1) client = candidate;
      else await candidate.close();
    } catch (error) {
      await candidate.close();
      throw error;
    }
  }
  if (!client) throw new Error("Benchmark worker did not start");
  const rssAfterStartupBytes = readProcessRssBytes(workerPid);

  for (const benchmarkCase of selectedCases.slice(0, options.warmup)) {
    await client.rankActions(benchmarkCase);
  }

  for (const benchmarkCase of selectedCases.slice(options.warmup)) {
    const startedAt = performance.now();
    const result = await client.rankActions(benchmarkCase);
    requestLatencies.push(performance.now() - startedAt);
    modelLatencies.push(result.latencyMs);
  }

  const cacheCase = selectedCases.at(-1);
  if (!cacheCase) throw new Error("No benchmark cases were generated");
  const cacheStartedAt = performance.now();
  const cacheResult = await client.rankActions(cacheCase);
  const cacheHitMs = performance.now() - cacheStartedAt;
  if (!cacheResult.cacheHit) throw new Error("Expected benchmark cache hit");

  report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    platform: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      node: process.version,
    },
    runtime: {
      pythonExecutable: displayPath(runtime.pythonExecutable),
      upstreamPath: displayPath(runtime.upstreamPath),
      manifestPath: displayPath(runtime.manifestPath),
      modelsDir: displayPath(runtime.modelsDir),
    },
    modelVersion: cacheResult.modelVersion,
    objective: cacheResult.objective,
    cases: {
      generated: cases.length,
      warmup: Math.min(options.warmup, selectedCases.length),
      measured: requestLatencies.length,
    },
    coldStartMs: summarize(coldStartLatencies),
    endToEndLatencyMs: summarize(requestLatencies),
    modelLatencyMs: summarize(modelLatencies),
    cacheHitMs: round(cacheHitMs),
    workerRssBytes: {
      afterStartup: rssAfterStartupBytes,
      afterBenchmark: readProcessRssBytes(workerPid),
    },
    configuredTimeoutsMs: {
      startup: options.startupTimeoutMs,
      inference: options.timeoutMs,
    },
  };
} finally {
  await client?.close();
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) {
  const outputPath = path.resolve(ROOT, options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);

function createCases() {
  const seats = ["user", "left", "right"];
  const result = [];
  for (const landlord of seats) {
    let state = submitBid(
      createGame({
        gameId: `douzero-benchmark-${landlord}`,
        randomSeed: `douzero-benchmark-${landlord}`,
        firstBidder: landlord,
        now: "2026-08-10T00:00:00.000Z",
      }),
      landlord,
      3,
      "2026-08-10T00:00:01.000Z",
    );
    for (let step = 0; state.phase === "playing" && step < 200; step += 1) {
      const viewer = state.currentTurn;
      const visible = getPlayerVisibleState(state, viewer, {
        includeLegalActions: true,
      });
      const legalActions = visible.legalActions ?? [];
      const update = createCoachGameContextUpdate(visible, step + 1, []);
      result.push({
        state: visible,
        legalActions,
        stateRef: {
          gameId: visible.gameId,
          revision: update.revision,
          actionIndex: update.actionIndex,
          stateChecksum: update.stateChecksum,
        },
        topK: 5,
      });

      const pass = legalActions.find(({ action }) => action === "pass");
      const plays = legalActions
        .filter(({ action }) => action === "play")
        .sort(
          (left, right) =>
            right.cards.length - left.cards.length ||
            left.actionId.localeCompare(right.actionId),
        );
      const selected = pass && step % 5 === 4 ? pass : (plays[0] ?? pass);
      if (!selected) throw new Error("Reachable state has no legal action");
      state =
        selected.action === "pass"
          ? passTurn(state, viewer, `2026-08-10T00:01:${step % 60}.000Z`)
          : playCards(
              state,
              viewer,
              selected.cards.map(({ id }) => id),
              `2026-08-10T00:01:${step % 60}.000Z`,
            );
    }
  }
  return result;
}

function createClient(onWorkerPid) {
  return new DouZeroWorkerClient({
    pythonExecutable: runtime.pythonExecutable,
    workerPath: path.join(SERVICE_ROOT, "worker.py"),
    workerArgs: [
      "--backend",
      "douzero",
      "--upstream-path",
      runtime.upstreamPath,
      "--model-manifest",
      runtime.manifestPath,
      "--models-dir",
      runtime.modelsDir,
      "--allow-unapproved-models",
    ],
    timeoutMs: options.timeoutMs,
    startupTimeoutMs: options.startupTimeoutMs,
    cacheSize: Math.max(128, selectedCases.length + 1),
    onDiagnostic(event) {
      if (event.type === "worker_started" && event.pid !== undefined) {
        onWorkerPid(event.pid);
      }
    },
  });
}

function summarize(values) {
  if (values.length === 0) throw new Error("No measured benchmark values");
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function percentile(sorted, percentileValue) {
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function readProcessRssBytes(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).WorkingSet64`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const value = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(value) ? value : null;
  }
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const kibibytes = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(kibibytes) ? kibibytes * 1024 : null;
}

function displayPath(value) {
  const relative = path.relative(ROOT, value);
  return relative.startsWith("..") ? value : relative.replaceAll("\\", "/");
}

function resolveRuntime() {
  const windowsPython = path.join(
    SERVICE_ROOT,
    ".runtime",
    "venv",
    "Scripts",
    "python.exe",
  );
  const unixPython = path.join(
    SERVICE_ROOT,
    ".runtime",
    "venv",
    "bin",
    "python",
  );
  return {
    pythonExecutable:
      process.env.DOUZERO_PYTHON_EXECUTABLE ??
      (process.platform === "win32" ? windowsPython : unixPython),
    upstreamPath:
      process.env.DOUZERO_UPSTREAM_PATH ??
      path.join(SERVICE_ROOT, ".runtime", "upstream"),
    manifestPath:
      process.env.DOUZERO_MODEL_MANIFEST ??
      path.join(SERVICE_ROOT, "model-manifest.community-wp.json"),
    modelsDir:
      process.env.DOUZERO_MODELS_DIR ??
      path.join(SERVICE_ROOT, "models", "douzero-wp-community-c010625"),
  };
}

function parseArguments(argumentsList) {
  const parsed = {
    iterations: 60,
    warmup: 5,
    coldStarts: 3,
    timeoutMs: 1_000,
    startupTimeoutMs: 15_000,
    output: undefined,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--iterations") parsed.iterations = positiveInteger(value);
    else if (argument === "--warmup") parsed.warmup = nonNegativeInteger(value);
    else if (argument === "--cold-starts")
      parsed.coldStarts = positiveInteger(value);
    else if (argument === "--timeout-ms")
      parsed.timeoutMs = positiveInteger(value);
    else if (argument === "--startup-timeout-ms")
      parsed.startupTimeoutMs = positiveInteger(value);
    else if (argument === "--output") parsed.output = value;
    else throw new Error(`Unknown benchmark argument: ${argument}`);
    index += 1;
  }
  if (parsed.warmup >= parsed.iterations) {
    throw new Error("--warmup must be smaller than --iterations");
  }
  return parsed;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
