import {
  createCoachGameContextUpdate,
  getPlayerVisibleState,
} from "../../packages/coach-protocol/dist/index.js";
import { createGame, submitBid } from "../../packages/game-core/dist/index.js";
import {
  assessCoachResponseQuality,
  createOllamaCoachService,
} from "../../apps/server/dist/index.js";

const coach = createOllamaCoachService({
  ...(process.env.OLLAMA_BASE_URL
    ? { baseUrl: process.env.OLLAMA_BASE_URL }
    : {}),
  ...(process.env.OLLAMA_MODEL ? { model: process.env.OLLAMA_MODEL } : {}),
  numCtx: Number(process.env.OLLAMA_NUM_CTX ?? 4096),
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 45_000),
});
const game = submitBid(
  createGame({
    gameId: "coach-style-evaluation",
    randomSeed: "coach-style-evaluation",
  }),
  "user",
  3,
);
const state = getPlayerVisibleState(game, "user");
const results = [];
const requestedStyle = process.argv
  .find((argument) => argument.startsWith("--style="))
  ?.slice("--style=".length);
const styles = ["direct", "warm", "analytical"].filter(
  (style) => !requestedStyle || style === requestedStyle,
);
if (styles.length === 0)
  throw new Error(`Unsupported style: ${requestedStyle}`);

try {
  await coach.warmup();
  for (const style of styles) {
    const sessionId = `style-${style}`;
    coach.updateStyle(sessionId, style);
    coach.updateGameContext(
      sessionId,
      createCoachGameContextUpdate(state, 0, [], new Date().toISOString()),
    );
    const startedAt = performance.now();
    const answer = await askCoach(
      coach,
      sessionId,
      "我现在应该怎么出？请直接给一个基于当前牌面的具体建议。",
    );
    const quality = assessCoachResponseQuality(answer, style);
    results.push({
      style,
      passed:
        quality.fillerMatches.length === 0 &&
        quality.ruleErrorMatches.length === 0 &&
        quality.withinStyleLimit,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      quality,
      answer,
    });
    coach.remove(sessionId);
  }
} finally {
  await coach.close();
}

const report = {
  ok: results.every(({ passed }) => passed),
  model: process.env.OLLAMA_MODEL ?? "qwen3.5:9b",
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

function askCoach(service, sessionId, question) {
  return new Promise((resolve, reject) => {
    void service.respond(sessionId, 0, question, (event) => {
      if (event.type === "coach.response.completed") resolve(event.text);
      if (event.type === "coach.error")
        reject(new Error(`${event.code}: ${event.message}`));
    });
  });
}
