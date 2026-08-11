import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Interface as ReadLineInterface } from "node:readline";

import { createVisibleStateChecksum } from "@ai-doudizhu/coach-protocol";

import type {
  RankedStrategyAction,
  StrategyPosition,
  StrategyProvider,
  StrategyRankRequest,
  StrategyRankResult,
  StrategySource,
  StrategyStateRef,
} from "./strategy-types.js";

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_SIZE = 128;
const MAX_TOP_K = 20;
const MAX_PROTOCOL_LINE_LENGTH = 5 * 1024 * 1024;

export interface DouZeroWorkerDiagnostic {
  readonly type:
    | "worker_started"
    | "worker_stopped"
    | "request_completed"
    | "cache_hit"
    | "protocol_error";
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly pid?: number;
  readonly message?: string;
}

export interface DouZeroWorkerClientOptions {
  readonly pythonExecutable: string;
  readonly workerPath: string;
  readonly workerArgs?: readonly string[];
  readonly timeoutMs?: number;
  readonly startupTimeoutMs?: number;
  readonly cacheSize?: number;
  readonly onDiagnostic?: (event: DouZeroWorkerDiagnostic) => void;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly startedAt: number;
}

interface ModelInfo {
  readonly backend: StrategySource;
  readonly modelVersion: string;
  readonly objective: "adp" | "wp";
  readonly processId: number;
}

export class DouZeroWorkerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DouZeroWorkerError";
    this.code = code;
  }
}

export class DouZeroWorkerClient implements StrategyProvider {
  readonly options: Required<
    Pick<DouZeroWorkerClientOptions, "pythonExecutable" | "workerPath">
  > &
    Omit<DouZeroWorkerClientOptions, "pythonExecutable" | "workerPath">;

  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: ReadLineInterface | undefined;
  private startPromise: Promise<void> | undefined;
  private modelInfo: ModelInfo | undefined;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly cache = new Map<string, StrategyRankResult>();
  private stderrTail = "";
  private closed = false;
  private closing = false;

  constructor(options: DouZeroWorkerClientOptions) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new Error("DouZero worker timeoutMs must be positive");
    }
    if (!Number.isInteger(cacheSize) || cacheSize < 1) {
      throw new Error("DouZero worker cacheSize must be a positive integer");
    }
    if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs < 1) {
      throw new Error("DouZero worker startupTimeoutMs must be positive");
    }
    this.options = {
      ...options,
      timeoutMs,
      startupTimeoutMs,
      cacheSize,
    };
  }

  async warmup(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("DouZero worker client is closed");
    if (this.modelInfo) return;
    this.startPromise ??= this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async rankActions(request: StrategyRankRequest): Promise<StrategyRankResult> {
    const topK = normalizeTopK(request.topK);
    validateRankRequest(request);
    await this.start();
    const modelInfo = this.modelInfo;
    if (!modelInfo)
      throw new Error("DouZero worker did not provide model info");
    const cacheKey = `${request.stateRef.stateChecksum}:${modelInfo.modelVersion}:${modelInfo.objective}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      this.options.onDiagnostic?.({ type: "cache_hit" });
      return {
        ...cached,
        actions: cached.actions.slice(0, topK),
        cacheHit: true,
      };
    }

    const raw = await this.sendRequest("rank_actions", {
      state: request.state,
      legalActions: request.legalActions,
      stateRef: request.stateRef,
      topK: MAX_TOP_K,
    });
    const parsed = parseRankResult(raw, request, modelInfo);
    this.cache.set(cacheKey, parsed);
    while (this.cache.size > (this.options.cacheSize ?? DEFAULT_CACHE_SIZE)) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
    return { ...parsed, actions: parsed.actions.slice(0, topK) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closing = true;
    const child = this.child;
    if (!child) return;
    try {
      await this.sendRequest("shutdown", {}, Math.min(500, this.timeoutMs));
      child.stdin.end();
      if (!(await waitForExit(child, 500))) {
        child.kill();
        await waitForExit(child, 200);
      }
    } catch {
      child.kill();
      await waitForExit(child, 200);
    } finally {
      if (!child.stdin.destroyed) child.stdin.end();
      this.lines?.close();
      this.child = undefined;
      this.modelInfo = undefined;
      this.cache.clear();
    }
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async startInternal(): Promise<void> {
    const child = spawn(
      this.options.pythonExecutable,
      [this.options.workerPath, ...(this.options.workerArgs ?? [])],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2_000);
    });
    child.once("error", (error) => this.failWorker(error));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      if (this.closing) {
        this.options.onDiagnostic?.({ type: "worker_stopped" });
        this.child = undefined;
        this.modelInfo = undefined;
        return;
      }
      const detail = this.stderrTail.trim();
      this.failWorker(
        new DouZeroWorkerError(
          "worker_exited",
          `DouZero worker exited (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`,
        ),
      );
    });

    const rawInfo = await this.sendRequest(
      "ping",
      {},
      this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    );
    this.modelInfo = parseModelInfo(rawInfo);
    this.options.onDiagnostic?.({
      type: "worker_started",
      pid: this.modelInfo.processId,
    });
  }

  private sendRequest(
    method: string,
    params: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      return Promise.reject(
        new DouZeroWorkerError(
          "worker_unavailable",
          "DouZero worker is unavailable",
        ),
      );
    }
    const requestId = `strategy-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new DouZeroWorkerError(
            "worker_timeout",
            `DouZero worker request timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        startedAt: performance.now(),
      });
      child.stdin.write(
        `${JSON.stringify({ id: requestId, method, params })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(requestId);
          reject(error);
        },
      );
    });
  }

  private handleLine(line: string): void {
    if (line.length > MAX_PROTOCOL_LINE_LENGTH) {
      this.protocolFailure("Worker response exceeded the protocol size limit");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.protocolFailure("Worker emitted invalid JSON");
      return;
    }
    if (!isRecord(value) || typeof value.id !== "string") {
      this.protocolFailure("Worker response is missing a request ID");
      return;
    }
    const pending = this.pending.get(value.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(value.id);
    const latencyMs = performance.now() - pending.startedAt;
    if (value.ok === true && "result" in value) {
      this.options.onDiagnostic?.({
        type: "request_completed",
        requestId: value.id,
        latencyMs,
      });
      pending.resolve(value.result);
      return;
    }
    const error = isRecord(value.error) ? value.error : undefined;
    pending.reject(
      new DouZeroWorkerError(
        typeof error?.code === "string" ? error.code : "worker_error",
        typeof error?.message === "string"
          ? error.message
          : "DouZero worker request failed",
      ),
    );
  }

  private protocolFailure(message: string): void {
    this.options.onDiagnostic?.({ type: "protocol_error", message });
    this.failWorker(new DouZeroWorkerError("protocol_error", message));
    this.child?.kill();
  }

  private failWorker(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.options.onDiagnostic?.({
      type: "worker_stopped",
      message: error.message,
    });
    this.child = undefined;
    this.modelInfo = undefined;
  }
}

function parseModelInfo(value: unknown): ModelInfo {
  if (
    !isRecord(value) ||
    !isStrategySource(value.backend) ||
    typeof value.modelVersion !== "string" ||
    !value.modelVersion ||
    (value.objective !== "adp" && value.objective !== "wp") ||
    typeof value.processId !== "number" ||
    !Number.isInteger(value.processId) ||
    value.processId < 1
  ) {
    throw new DouZeroWorkerError(
      "protocol_error",
      "Invalid worker ping response",
    );
  }
  return {
    backend: value.backend,
    modelVersion: value.modelVersion,
    objective: value.objective,
    processId: value.processId,
  };
}

function parseRankResult(
  value: unknown,
  request: StrategyRankRequest,
  modelInfo: ModelInfo,
): StrategyRankResult {
  if (!isRecord(value)) throw protocolError("Rank result must be an object");
  const stateRef = parseStateRef(value.stateRef, request.stateRef);
  if (!isStrategyPosition(value.position)) {
    throw protocolError("Rank result has an invalid position");
  }
  if (
    value.modelVersion !== modelInfo.modelVersion ||
    value.objective !== modelInfo.objective ||
    value.source !== modelInfo.backend
  ) {
    throw protocolError("Rank result model metadata changed after warmup");
  }
  if (!Array.isArray(value.actions) || value.actions.length > MAX_TOP_K) {
    throw protocolError("Rank result actions are invalid");
  }
  const allowedIds = new Set(
    request.legalActions.map(({ actionId }) => actionId),
  );
  const seenIds = new Set<string>();
  const actions = value.actions.map((action, index) =>
    parseRankedAction(action, index, allowedIds, seenIds),
  );
  if (!isFiniteNonNegative(value.latencyMs)) {
    throw protocolError("Rank result latency is invalid");
  }
  return {
    stateRef,
    position: value.position,
    modelVersion: modelInfo.modelVersion,
    objective: modelInfo.objective,
    source: modelInfo.backend,
    actions,
    latencyMs: value.latencyMs,
    cacheHit: false,
  };
}

function parseRankedAction(
  value: unknown,
  index: number,
  allowedIds: ReadonlySet<string>,
  seenIds: Set<string>,
): RankedStrategyAction {
  const equivalentActionIds =
    isRecord(value) && Array.isArray(value.equivalentActionIds)
      ? value.equivalentActionIds
      : undefined;
  if (
    !isRecord(value) ||
    value.rank !== index + 1 ||
    typeof value.actionId !== "string" ||
    !allowedIds.has(value.actionId) ||
    seenIds.has(value.actionId) ||
    typeof value.signature !== "string" ||
    !equivalentActionIds ||
    !equivalentActionIds.every(
      (actionId) => typeof actionId === "string" && allowedIds.has(actionId),
    ) ||
    new Set(equivalentActionIds).size !== equivalentActionIds.length ||
    !equivalentActionIds.includes(value.actionId) ||
    !isNullableFiniteNumber(value.modelScore) ||
    !isNullableFiniteNumber(value.deltaFromBest)
  ) {
    throw protocolError(`Rank result action ${index} is invalid`);
  }
  seenIds.add(value.actionId);
  return {
    rank: value.rank,
    actionId: value.actionId,
    equivalentActionIds: [...equivalentActionIds] as string[],
    signature: value.signature,
    modelScore: value.modelScore,
    deltaFromBest: value.deltaFromBest,
  };
}

function parseStateRef(
  value: unknown,
  expected: StrategyStateRef,
): StrategyStateRef {
  if (
    !isRecord(value) ||
    value.gameId !== expected.gameId ||
    value.revision !== expected.revision ||
    value.actionIndex !== expected.actionIndex ||
    value.stateChecksum !== expected.stateChecksum
  ) {
    throw protocolError("Rank result stateRef does not match the request");
  }
  return expected;
}

function normalizeTopK(value: number | undefined): number {
  const topK = value ?? 5;
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new Error(`topK must be an integer between 1 and ${MAX_TOP_K}`);
  }
  return topK;
}

function validateRankRequest(request: StrategyRankRequest): void {
  if (
    request.stateRef.gameId !== request.state.gameId ||
    request.stateRef.actionIndex !== request.state.publicHistory.length ||
    request.stateRef.stateChecksum !== createVisibleStateChecksum(request.state)
  ) {
    throw new Error("Strategy state reference does not match visible state");
  }
  if (request.state.currentTurn !== request.state.userSeat) {
    throw new Error("Strategy ranking requires the visible player's turn");
  }
  if (request.legalActions.length === 0) {
    throw new Error("Strategy ranking requires at least one legal action");
  }
}

function isStrategyPosition(value: unknown): value is StrategyPosition {
  return (
    value === "landlord" || value === "landlord_up" || value === "landlord_down"
  );
}

function isStrategySource(value: unknown): value is StrategySource {
  return value === "douzero" || value === "heuristic" || value === "test";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function protocolError(message: string): DouZeroWorkerError {
  return new DouZeroWorkerError("protocol_error", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}
