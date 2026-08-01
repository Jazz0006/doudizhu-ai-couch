import { describe, expect, it } from "vitest";

import { getCurrentTrickActions } from "./currentTrick.js";
import type { PlayRecord, Seat } from "@ai-doudizhu/game-core";

function record(
  index: number,
  seat: Seat,
  action: "play" | "pass",
): PlayRecord {
  return {
    index,
    seat,
    action,
    play: null,
    timestamp: `2026-08-01T00:00:0${index}.000Z`,
  };
}

describe("getCurrentTrickActions", () => {
  it("keeps each seat's latest action during the current trick", () => {
    const actions = getCurrentTrickActions([
      record(0, "left", "play"),
      record(1, "right", "pass"),
      record(2, "user", "play"),
      record(3, "left", "pass"),
    ]);

    expect(actions.left?.index).toBe(3);
    expect(actions.right?.index).toBe(1);
    expect(actions.user?.index).toBe(2);
  });

  it("clears all seat actions after two consecutive passes", () => {
    const actions = getCurrentTrickActions([
      record(0, "user", "play"),
      record(1, "left", "pass"),
      record(2, "right", "pass"),
    ]);

    expect(actions).toEqual({});
  });

  it("starts a fresh display when the next trick is led", () => {
    const actions = getCurrentTrickActions([
      record(0, "user", "play"),
      record(1, "left", "pass"),
      record(2, "right", "pass"),
      record(3, "user", "play"),
    ]);

    expect(Object.keys(actions)).toEqual(["user"]);
    expect(actions.user?.index).toBe(3);
  });
});
