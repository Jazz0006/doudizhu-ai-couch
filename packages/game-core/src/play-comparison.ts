import { RANK_ORDER } from "./card.js";
import type { Play } from "./play.js";

export type PlayComparison = -1 | 0 | 1 | null;

/**
 * Compares two plays. `null` means the plays cannot be compared because their
 * types or lengths differ; otherwise the result follows normal sort semantics.
 */
export function comparePlays(left: Play, right: Play): PlayComparison {
  if (left.type === "rocket" || right.type === "rocket") {
    if (left.type === right.type) {
      return 0;
    }

    return left.type === "rocket" ? 1 : -1;
  }

  if (left.type === "bomb" || right.type === "bomb") {
    if (left.type !== right.type) {
      return left.type === "bomb" ? 1 : -1;
    }

    return compareRanks(left, right);
  }

  if (left.type !== right.type || left.length !== right.length) {
    return null;
  }

  return compareRanks(left, right);
}

export function canBeatPlay(candidate: Play, current: Play): boolean {
  return comparePlays(candidate, current) === 1;
}

function compareRanks(left: Play, right: Play): -1 | 0 | 1 {
  const difference =
    RANK_ORDER[left.primaryRank] - RANK_ORDER[right.primaryRank];

  return difference === 0 ? 0 : difference > 0 ? 1 : -1;
}
