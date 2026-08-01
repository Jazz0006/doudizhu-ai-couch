import type { PlayRecord, Seat } from "@ai-doudizhu/game-core";

export type CurrentTrickActions = Partial<Record<Seat, PlayRecord>>;

export function getCurrentTrickActions(
  history: readonly PlayRecord[],
): CurrentTrickActions {
  let actions: CurrentTrickActions = {};
  let consecutivePasses = 0;

  for (const record of history) {
    actions = { ...actions, [record.seat]: record };
    consecutivePasses = record.action === "pass" ? consecutivePasses + 1 : 0;

    if (consecutivePasses === 2) {
      actions = {};
      consecutivePasses = 0;
    }
  }

  return actions;
}
