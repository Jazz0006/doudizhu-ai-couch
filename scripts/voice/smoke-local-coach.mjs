import { createOllamaCoachService } from "../../apps/server/dist/index.js";
import { getPlayerVisibleState } from "../../packages/coach-protocol/dist/index.js";
import { createGame, submitBid } from "../../packages/game-core/dist/index.js";

const coach = createOllamaCoachService({
  ...(process.env.OLLAMA_BASE_URL
    ? { baseUrl: process.env.OLLAMA_BASE_URL }
    : {}),
  ...(process.env.OLLAMA_MODEL ? { model: process.env.OLLAMA_MODEL } : {}),
  ...(process.env.OLLAMA_KEEP_ALIVE
    ? { keepAlive: process.env.OLLAMA_KEEP_ALIVE }
    : {}),
  numCtx: Number(process.env.OLLAMA_NUM_CTX ?? 4096),
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 45_000),
});
let firstTextMs;
const eventTypes = [];
const toolNames = [];
let highlight;

try {
  await coach.warmup();
  const game = submitBid(
    createGame({
      gameId: "coach-smoke-game",
      randomSeed: "coach-smoke-game",
    }),
    "user",
    3,
  );
  coach.updateGameContext("coach-smoke", {
    revision: 0,
    state: getPlayerVisibleState(game, "user", {
      selectedCardIds: [game.hands.user[0].id],
    }),
    events: [
      {
        type: "landlord_selected",
        seat: "user",
        bottomCards: game.bottomCards,
      },
    ],
  });
  const startedAt = performance.now();
  const answer = await new Promise((resolve, reject) => {
    void coach.respond(
      "coach-smoke",
      0,
      "我选了一张牌，这样出可以吗？",
      (event) => {
        eventTypes.push(event.type);
        if (event.type === "coach.tool.called") toolNames.push(event.name);
        if (event.type === "coach.highlight") highlight = event.instruction;
        if (
          event.type === "coach.response.delta" &&
          firstTextMs === undefined
        ) {
          firstTextMs = performance.now() - startedAt;
        }
        if (event.type === "coach.error") {
          reject(new Error(`${event.code}: ${event.message}`));
        }
        if (event.type === "coach.response.completed") resolve(event.text);
      },
    );
  });
  if (!String(answer).trim()) throw new Error("Coach returned an empty answer");
  if (!eventTypes.includes("coach.tool.called")) {
    throw new Error("Coach did not call a game-state tool");
  }
  if (!toolNames.includes("analyze_selected_cards")) {
    throw new Error("Coach did not analyze the selected cards");
  }
  if (!highlight?.cardIds?.includes(game.hands.user[0].id)) {
    throw new Error("Coach did not highlight the selected card");
  }
  if (/看不到.{0,8}底牌/.test(String(answer))) {
    throw new Error(
      "Coach incorrectly claimed that public bottom cards are hidden",
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        firstTextMs:
          firstTextMs === undefined ? null : Number(firstTextMs.toFixed(1)),
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        eventTypes,
        toolNames,
        highlight,
        answer,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  coach.remove("coach-smoke");
  await coach.close();
}
