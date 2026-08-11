import { fileURLToPath } from "node:url";

import {
  createCoachGameContextUpdate,
  createVisibleStateChecksum,
  getPlayerVisibleState,
} from "@ai-doudizhu/coach-protocol";
import { createGame, submitBid } from "@ai-doudizhu/game-core";
import { describe, expect, it } from "vitest";

import {
  DouZeroWorkerClient,
  type DouZeroWorkerDiagnostic,
} from "./douzero-worker-client.js";
import {
  createHeuristicRankResult,
  createResilientStrategy,
} from "./resilient-strategy.js";
import type { StrategyRankRequest } from "./strategy-types.js";

const WORKER_PATH = fileURLToPath(
  new URL("../../../../services/douzero-inference/worker.py", import.meta.url),
);
const MALFORMED_WORKER_PATH = fileURLToPath(
  new URL(
    "../../../../services/douzero-inference/tests/malformed_worker.py",
    import.meta.url,
  ),
);
const describeWorker = describe.runIf(process.env.DOUZERO_WORKER_TESTS === "1");
const describeRealWorker = describe.runIf(
  process.env.DOUZERO_REAL_MODEL_TESTS === "1",
);

describeWorker("DouZeroWorkerClient process integration", () => {
  it("keeps one worker alive and reuses the full ranking cache", async () => {
    const diagnostics: DouZeroWorkerDiagnostic[] = [];
    const client = new DouZeroWorkerClient({
      pythonExecutable: "python",
      workerPath: WORKER_PATH,
      workerArgs: ["--backend", "fake"],
      timeoutMs: 2_000,
      onDiagnostic: (event) => diagnostics.push(event),
    });
    const request = createRequest(5);

    try {
      const first = await client.rankActions(request);
      const second = await client.rankActions({ ...request, topK: 2 });

      expect(first.source).toBe("test");
      expect(first.cacheHit).toBe(false);
      expect(first.actions.length).toBeGreaterThanOrEqual(2);
      expect(second.cacheHit).toBe(true);
      expect(second.actions).toEqual(first.actions.slice(0, 2));
      expect(
        first.actions.every(({ actionId }) =>
          request.legalActions.some((action) => action.actionId === actionId),
        ),
      ).toBe(true);
      expect(
        diagnostics.filter(({ type }) => type === "worker_started"),
      ).toHaveLength(1);
      expect(diagnostics.some(({ type }) => type === "cache_hit")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("falls back when model inference exceeds the request timeout", async () => {
    const reasons: string[] = [];
    const client = new DouZeroWorkerClient({
      pythonExecutable: "python",
      workerPath: WORKER_PATH,
      workerArgs: ["--backend", "fake", "--delay-ms", "100"],
      timeoutMs: 20,
    });
    const strategy = createResilientStrategy({
      primary: client,
      onFallback: (reason) => reasons.push(reason),
    });

    try {
      const result = await strategy.rankActions(createRequest(3));

      expect(result.source).toBe("heuristic");
      expect(result.degradedReason).toBe("worker_timeout");
      expect(reasons).toEqual(["worker_timeout"]);
    } finally {
      await strategy.close();
    }
  });

  it("rejects malformed worker output and uses the fallback", async () => {
    const client = new DouZeroWorkerClient({
      pythonExecutable: "python",
      workerPath: MALFORMED_WORKER_PATH,
      timeoutMs: 1_000,
    });
    const strategy = createResilientStrategy({ primary: client });

    try {
      const result = await strategy.rankActions(createRequest(3));

      expect(result.source).toBe("heuristic");
      expect(result.degradedReason).toBe("protocol_error");
    } finally {
      await strategy.close();
    }
  });
});

describeRealWorker("DouZeroWorkerClient real model integration", () => {
  it("loads verified checkpoints and returns model-ranked project actions", async () => {
    const pythonExecutable = requiredEnvironmentPath(
      "DOUZERO_PYTHON_EXECUTABLE",
    );
    const upstreamPath = requiredEnvironmentPath("DOUZERO_UPSTREAM_PATH");
    const manifestPath = requiredEnvironmentPath("DOUZERO_MODEL_MANIFEST");
    const modelsDir = requiredEnvironmentPath("DOUZERO_MODELS_DIR");
    const client = new DouZeroWorkerClient({
      pythonExecutable,
      workerPath: WORKER_PATH,
      workerArgs: [
        "--backend",
        "douzero",
        "--upstream-path",
        upstreamPath,
        "--model-manifest",
        manifestPath,
        "--models-dir",
        modelsDir,
        "--allow-unapproved-models",
      ],
      timeoutMs: 1_000,
    });
    const request = createRequest(5);

    try {
      const result = await client.rankActions(request);

      expect(result.source).toBe("douzero");
      expect(result.objective).toBe("wp");
      expect(result.modelVersion).toBe("douzero-wp-community-c010625");
      expect(result.actions.length).toBeGreaterThan(0);
      expect(
        result.actions.every(({ modelScore }) => modelScore !== null),
      ).toBe(true);
      expect(
        result.actions.every(({ actionId }) =>
          request.legalActions.some((action) => action.actionId === actionId),
        ),
      ).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("heuristic strategy fallback", () => {
  it("returns only source action IDs and preserves the state reference", () => {
    const request = createRequest(4);
    const result = createHeuristicRankResult(request, "test_fallback");

    expect(result.source).toBe("heuristic");
    expect(result.stateRef).toBe(request.stateRef);
    expect(result.degradedReason).toBe("test_fallback");
    expect(
      result.actions.every(({ actionId }) =>
        request.legalActions.some((action) => action.actionId === actionId),
      ),
    ).toBe(true);
    expect(new Set(result.actions.map(({ signature }) => signature)).size).toBe(
      result.actions.length,
    );
  });

  it("rejects stale or inapplicable requests instead of hiding them with fallback", async () => {
    const primary: import("./strategy-types.js").StrategyProvider = {
      async warmup() {},
      async rankActions() {
        throw new Error("must not be called");
      },
      async close() {},
    };
    const strategy = createResilientStrategy({ primary });
    const request = createRequest(3);

    await expect(
      strategy.rankActions({
        ...request,
        stateRef: { ...request.stateRef, actionIndex: 99 },
      }),
    ).rejects.toThrow("state reference");
    await expect(strategy.rankActions({ ...request, topK: 0 })).rejects.toThrow(
      "topK",
    );
  });
});

function createRequest(topK: number): StrategyRankRequest {
  const fullState = submitBid(
    createGame({
      gameId: "strategy-worker-test",
      randomSeed: "strategy-worker-test",
      now: "2026-08-10T00:00:00.000Z",
    }),
    "user",
    3,
    "2026-08-10T00:00:01.000Z",
  );
  const state = getPlayerVisibleState(fullState, "user", {
    includeLegalActions: true,
  });
  const update = createCoachGameContextUpdate(state, 1, []);
  expect(update.stateChecksum).toBe(createVisibleStateChecksum(state));
  return {
    state,
    legalActions: state.legalActions ?? [],
    stateRef: {
      gameId: state.gameId,
      revision: update.revision,
      actionIndex: update.actionIndex,
      stateChecksum: update.stateChecksum,
    },
    topK,
  };
}

function requiredEnvironmentPath(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for real model tests`);
  return value;
}
