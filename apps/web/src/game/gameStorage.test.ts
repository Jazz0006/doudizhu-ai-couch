import { describe, expect, it } from "vitest";

import { createGame, submitBid } from "@ai-doudizhu/game-core";

import {
  createStoredGameSnapshot,
  decodeStoredGameSnapshot,
} from "./gameStorage";

describe("stored game snapshots", () => {
  it("round-trips state and difficulty through a versioned payload", () => {
    const state = submitBid(
      createGame({ gameId: "web-save", randomSeed: "web-save" }),
      "user",
      3,
    );
    const snapshot = createStoredGameSnapshot(
      state,
      "hard",
      "2026-08-02T00:00:00.000Z",
    );

    expect(decodeStoredGameSnapshot(snapshot)).toEqual({
      savedAt: "2026-08-02T00:00:00.000Z",
      difficulty: "hard",
      state,
    });
  });

  it("rejects unknown storage versions before reading game data", () => {
    expect(() => decodeStoredGameSnapshot({ schemaVersion: 99 })).toThrow(
      /invalid schema/,
    );
  });
});
