import { describe, expect, it } from "vitest";

import {
  createGame,
  generateLegalPlays,
  passTurn,
  playCards,
  replayGameActions,
  restoreGameState,
  serializeGameState,
  submitBid,
} from "./index.js";

const NOW = "2026-08-02T00:00:00.000Z";

function createPlayedState() {
  let state = submitBid(
    createGame({ gameId: "saved", randomSeed: "saved", now: NOW }),
    "user",
    3,
    "2026-08-02T00:00:01.000Z",
  );
  const opening = generateLegalPlays(state.hands.user, null)[0]!;
  state = playCards(
    state,
    "user",
    opening.cards.map(({ id }) => id),
    "2026-08-02T00:00:02.000Z",
  );
  const leftPlay = generateLegalPlays(
    state.hands.left,
    state.currentWinningPlay,
  )[0];
  state = leftPlay
    ? playCards(
        state,
        "left",
        leftPlay.cards.map(({ id }) => id),
        "2026-08-02T00:00:03.000Z",
      )
    : passTurn(state, "left", "2026-08-02T00:00:03.000Z");
  return state;
}

describe("game state serialization", () => {
  it("restores a state by replaying every legal action", () => {
    const state = createPlayedState();
    const serialized = serializeGameState(state);
    const restored = restoreGameState(JSON.parse(JSON.stringify(serialized)));

    expect(restored).toEqual(state);
    expect(replayGameActions(restored)).toHaveLength(state.history.length);
    expect(replayGameActions(restored).at(-1)?.after).toEqual(state);
  });

  it("rejects incompatible, truncated, and illegal saved games", () => {
    const serialized = serializeGameState(createPlayedState());
    expect(() =>
      restoreGameState({ ...serialized, schemaVersion: 99 }),
    ).toThrow(/schema/);
    expect(() =>
      restoreGameState({
        ...serialized,
        actions: serialized.actions.slice(0, -1),
      }),
    ).toThrow(/replayed state/);
    expect(() =>
      restoreGameState({
        ...serialized,
        actions: serialized.actions.map((action, index) =>
          index === 0 && action.type === "play"
            ? { ...action, cardIds: ["not-a-real-card"] }
            : action,
        ),
      }),
    ).toThrow();
  });

  it("preserves the original first bidder across an all-pass redeal", () => {
    let state = createGame({
      gameId: "redeal-save",
      randomSeed: "redeal-save",
    });
    state = submitBid(state, "user", 0);
    state = submitBid(state, "left", 0);
    state = submitBid(state, "right", 0);

    expect(state.dealNumber).toBe(2);
    expect(restoreGameState(serializeGameState(state))).toEqual(state);
  });
});
