import {
  passTurn,
  playCards,
  createGame,
  submitBid,
} from "../../../packages/game-core/dist/index.js";
import { getPlayerVisibleState } from "../../../packages/coach-protocol/dist/index.js";

const seats = ["user", "left", "right"];
const cases = [];

for (const landlord of seats) {
  let state = submitBid(
    createGame({
      gameId: `douzero-contract-${landlord}`,
      randomSeed: `douzero-contract-${landlord}`,
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
    cases.push({ state: visible, legalActions });

    const pass = legalActions.find((action) => action.action === "pass");
    const plays = legalActions
      .filter((action) => action.action === "play")
      .sort(
        (left, right) =>
          right.cards.length - left.cards.length ||
          left.actionId.localeCompare(right.actionId),
      );
    const selected = pass && step % 5 === 4 ? pass : (plays[0] ?? pass);
    if (!selected) {
      throw new Error("Reachable playing state has no legal action");
    }
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

  if (state.phase !== "finished") {
    throw new Error(`Contract simulation did not finish for ${landlord}`);
  }
}

process.stdout.write(JSON.stringify(cases));
