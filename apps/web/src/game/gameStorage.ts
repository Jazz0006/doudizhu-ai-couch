import type { Difficulty } from "@ai-doudizhu/bot-engine";
import type { GameReview } from "@ai-doudizhu/coach-protocol";
import { restoreGameState, serializeGameState } from "@ai-doudizhu/game-core";
import type {
  FullGameState,
  SerializedGameState,
} from "@ai-doudizhu/game-core";

const DATABASE_NAME = "ai-doudizhu-coach";
const DATABASE_VERSION = 1;
const CURRENT_GAME_STORE = "current-game";
const SUMMARY_STORE = "game-summaries";
const CURRENT_GAME_KEY = "active";
const SNAPSHOT_SCHEMA_VERSION = 1 as const;
const MAX_RECENT_SUMMARIES = 10;

interface StoredGameSnapshot {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  readonly savedAt: string;
  readonly difficulty: Difficulty;
  readonly game: SerializedGameState;
}

export interface RestoredGameSnapshot {
  readonly savedAt: string;
  readonly difficulty: Difficulty;
  readonly state: FullGameState;
}

export interface StoredGameSummary {
  readonly gameId: string;
  readonly endedAt: string;
  readonly difficulty: Difficulty;
  readonly winner: "landlord" | "farmers";
  readonly review: GameReview;
}

export function createStoredGameSnapshot(
  state: FullGameState,
  difficulty: Difficulty,
  savedAt = new Date().toISOString(),
): StoredGameSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    savedAt,
    difficulty,
    game: serializeGameState(state),
  };
}

export function decodeStoredGameSnapshot(value: unknown): RestoredGameSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    !isDifficulty(value.difficulty)
  ) {
    throw new Error("Stored game snapshot has an invalid schema");
  }
  return {
    savedAt: value.savedAt,
    difficulty: value.difficulty,
    state: restoreGameState(value.game),
  };
}

export async function loadGameSnapshot(): Promise<RestoredGameSnapshot | null> {
  const database = await openDatabase();
  try {
    const value = await requestResult(
      database
        .transaction(CURRENT_GAME_STORE, "readonly")
        .objectStore(CURRENT_GAME_STORE)
        .get(CURRENT_GAME_KEY),
    );
    return value === undefined ? null : decodeStoredGameSnapshot(value);
  } finally {
    database.close();
  }
}

export async function saveGameSnapshot(
  state: FullGameState,
  difficulty: Difficulty,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CURRENT_GAME_STORE, "readwrite");
    transaction
      .objectStore(CURRENT_GAME_STORE)
      .put(createStoredGameSnapshot(state, difficulty), CURRENT_GAME_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearGameSnapshot(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CURRENT_GAME_STORE, "readwrite");
    transaction.objectStore(CURRENT_GAME_STORE).delete(CURRENT_GAME_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveGameSummary(
  summary: StoredGameSummary,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE, "readwrite");
    const store = transaction.objectStore(SUMMARY_STORE);
    store.put(summary, summary.gameId);
    await transactionDone(transaction);
    const summaries = await loadSummaryRecords(database);
    const expired = summaries
      .sort((left, right) => right.endedAt.localeCompare(left.endedAt))
      .slice(MAX_RECENT_SUMMARIES);
    if (expired.length > 0) {
      const cleanup = database.transaction(SUMMARY_STORE, "readwrite");
      for (const item of expired)
        cleanup.objectStore(SUMMARY_STORE).delete(item.gameId);
      await transactionDone(cleanup);
    }
  } finally {
    database.close();
  }
}

export async function loadRecentGameSummaries(): Promise<StoredGameSummary[]> {
  const database = await openDatabase();
  try {
    return (await loadSummaryRecords(database)).sort((left, right) =>
      right.endedAt.localeCompare(left.endedAt),
    );
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CURRENT_GAME_STORE)) {
        database.createObjectStore(CURRENT_GAME_STORE);
      }
      if (!database.objectStoreNames.contains(SUMMARY_STORE)) {
        database.createObjectStore(SUMMARY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB failed"));
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade was blocked"));
  });
}

async function loadSummaryRecords(
  database: IDBDatabase,
): Promise<StoredGameSummary[]> {
  const value = await requestResult(
    database
      .transaction(SUMMARY_STORE, "readonly")
      .objectStore(SUMMARY_STORE)
      .getAll(),
  );
  return Array.isArray(value) ? value.filter(isStoredGameSummary) : [];
}

function isStoredGameSummary(value: unknown): value is StoredGameSummary {
  return (
    isRecord(value) &&
    typeof value.gameId === "string" &&
    typeof value.endedAt === "string" &&
    isDifficulty(value.difficulty) &&
    (value.winner === "landlord" || value.winner === "farmers") &&
    isRecord(value.review)
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
