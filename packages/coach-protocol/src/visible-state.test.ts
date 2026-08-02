import { describe, expect, it } from "vitest";

import {
  canBeatPlay,
  createGame,
  generateLegalPlays,
  playCards,
  RANK_ORDER,
  submitBid,
} from "@ai-doudizhu/game-core";
import type { FullGameState, Seat } from "@ai-doudizhu/game-core";

import { getPlayerVisibleState } from "./index.js";

const NOW = "2026-08-01T00:00:00.000Z";

function createPlayingState(seed = "visible-playing"): FullGameState {
  return submitBid(
    createGame({ gameId: seed, randomSeed: seed, now: NOW }),
    "user",
    3,
    NOW,
  );
}

describe("getPlayerVisibleState", () => {
  it("hides every opponent hand and the unrevealed bottom cards while bidding", () => {
    const state = createGame({
      gameId: "hidden-bidding",
      randomSeed: "hidden-bidding",
      now: NOW,
    });
    const visible = getPlayerVisibleState(state, "user");
    const serialized = JSON.stringify(visible);
    const hiddenCards = [
      ...state.hands.left,
      ...state.hands.right,
      ...state.bottomCards,
    ];

    expect(visible.userHand).toEqual(state.hands.user);
    expect(visible.bottomCards).toEqual([]);
    expect(visible.remainingCardCounts).toEqual({
      user: 17,
      left: 17,
      right: 17,
    });
    expect(hiddenCards.every(({ id }) => !serialized.includes(id))).toBe(true);
    expect(serialized).not.toContain("hands");
    expect(serialized).not.toContain("randomSeed");
    expect(serialized).not.toContain("biddingHistory");
  });

  it.each(["user", "left", "right"] as const)(
    "exposes only the %s viewer hand after the landlord is known",
    (viewer) => {
      const state = createPlayingState(`viewer-${viewer}`);
      const visible = getPlayerVisibleState(state, viewer);
      const publicBottomIds = new Set(state.bottomCards.map(({ id }) => id));
      const hiddenIds = opponentSeats(viewer).flatMap((seat) =>
        state.hands[seat]
          .filter(({ id }) => !publicBottomIds.has(id))
          .map(({ id }) => id),
      );
      const serialized = JSON.stringify(visible);

      expect(visible.userSeat).toBe(viewer);
      expect(visible.userHand).toEqual(state.hands[viewer]);
      expect(visible.bottomCards).toEqual(state.bottomCards);
      expect(hiddenIds.every((id) => !serialized.includes(id))).toBe(true);
    },
  );

  it("filters selected IDs to the viewer hand and reports rule legality", () => {
    const state = createPlayingState("selection");
    const legalPlay = generateLegalPlays(state.hands.user, null)[0]!;
    const opponentCardId = state.hands.left[0]!.id;
    const visible = getPlayerVisibleState(state, "user", {
      selectedCardIds: [
        ...legalPlay.cards.map(({ id }) => id),
        opponentCardId,
        legalPlay.cards[0]!.id,
      ],
    });

    expect(visible.selectedCards.map(({ id }) => id)).toEqual(
      legalPlay.cards.map(({ id }) => id),
    );
    expect(visible.selectedCards.some(({ id }) => id === opponentCardId)).toBe(
      false,
    );
    expect(visible.selectedPlay).not.toBeNull();
    expect(visible.selectedPlayLegal).toBe(true);
  });

  it("marks a recognized selection illegal when it cannot beat the table", () => {
    const playing = createPlayingState("losing-selection");
    const opening = generateLegalPlays(playing.hands.user, null)
      .filter(({ type }) => type === "single")
      .sort(
        (left, right) =>
          RANK_ORDER[right.primaryRank] - RANK_ORDER[left.primaryRank],
      )[0]!;
    const following = playCards(
      playing,
      "user",
      opening.cards.map(({ id }) => id),
      NOW,
    );
    const losingSingle = generateLegalPlays(following.hands.left, null)
      .filter(({ type }) => type === "single")
      .find((play) => !canBeatPlay(play, opening));

    if (!losingSingle) throw new Error("Fixture requires a left-hand single");

    const visible = getPlayerVisibleState(following, "left", {
      selectedCardIds: losingSingle.cards.map(({ id }) => id),
    });

    expect(visible.selectedPlay?.type).toBe("single");
    expect(visible.selectedPlayLegal).toBe(false);
  });

  it("optionally returns only legal, viewer-owned actions plus pass", () => {
    const playing = createPlayingState("legal-actions");
    const opening = generateLegalPlays(playing.hands.user, null)[0]!;
    const following = playCards(
      playing,
      "user",
      opening.cards.map(({ id }) => id),
      NOW,
    );
    const withoutActions = getPlayerVisibleState(following, "left");
    const visible = getPlayerVisibleState(following, "left", {
      includeLegalActions: true,
    });
    const handIds = new Set(following.hands.left.map(({ id }) => id));
    const playActions = visible.legalActions!.filter(
      (action) => action.action === "play",
    );

    expect("legalActions" in withoutActions).toBe(false);
    expect(visible.legalActions).toContainEqual({
      actionId: "pass",
      action: "pass",
      cards: [],
      play: null,
    });
    expect(
      playActions.every((action) =>
        action.cards.every(({ id }) => handIds.has(id)),
      ),
    ).toBe(true);
    expect(
      playActions.every((action) =>
        generateLegalPlays(
          following.hands.left,
          following.currentWinningPlay,
        ).some(
          (play) =>
            play.cards
              .map(({ id }) => id)
              .sort()
              .join("|") ===
            action.cards
              .map(({ id }) => id)
              .sort()
              .join("|"),
        ),
      ),
    ).toBe(true);
  });

  it("returns detached data that cannot mutate the full state", () => {
    const playing = createPlayingState("detached");
    const opening = generateLegalPlays(playing.hands.user, null)[0]!;
    const state = playCards(
      playing,
      "user",
      opening.cards.map(({ id }) => id),
      NOW,
    );
    const originalHandLength = state.hands.left.length;
    const originalHistoryLength = state.history.length;
    const visible = getPlayerVisibleState(state, "left", {
      includeLegalActions: true,
    });

    visible.userHand.pop();
    visible.publicHistory.pop();
    visible.legalActions
      ?.find((action) => action.action === "play")
      ?.cards.pop();

    expect(state.hands.left).toHaveLength(originalHandLength);
    expect(state.history).toHaveLength(originalHistoryLength);
  });
});

function opponentSeats(viewer: Seat): Seat[] {
  return (["user", "left", "right"] as const).filter((seat) => seat !== viewer);
}
