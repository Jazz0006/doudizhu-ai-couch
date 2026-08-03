import {
  createCoachGameContextUpdate,
  createCoachStateSummary,
  getPlayerVisibleState,
} from "../../packages/coach-protocol/dist/index.js";
import {
  createGame,
  generateLegalPlays,
  passTurn,
  playCards,
  submitBid,
} from "../../packages/game-core/dist/index.js";
import { createOllamaCoachService } from "../../apps/server/dist/index.js";

const live = process.argv.includes("--live");
const snapshots = buildSnapshots();
const allCases = buildCases(snapshots);
const filter = process.argv
  .find((argument) => argument.startsWith("--filter="))
  ?.slice("--filter=".length);
const cases = filter
  ? allCases.filter(
      (testCase) =>
        testCase.id === filter || testCase.id.startsWith(`${filter}-`),
    )
  : allCases;

if (allCases.length !== 50)
  throw new Error(`Expected 50 cases, got ${allCases.length}`);
if (cases.length === 0) throw new Error(`No evaluation case matches ${filter}`);

if (!live) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "state", cases: cases.length, categories: countCategories(cases) }, null, 2)}\n`,
  );
  process.exit(0);
}

const coach = createOllamaCoachService({
  ...(process.env.OLLAMA_BASE_URL
    ? { baseUrl: process.env.OLLAMA_BASE_URL }
    : {}),
  ...(process.env.OLLAMA_MODEL ? { model: process.env.OLLAMA_MODEL } : {}),
  numCtx: Number(process.env.OLLAMA_NUM_CTX ?? 4096),
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 45_000),
});
const results = [];

try {
  await coach.warmup();
  for (const [index, testCase] of cases.entries()) {
    const sessionId = `evaluation-${index}`;
    coach.updateGameContext(
      sessionId,
      createCoachGameContextUpdate(
        testCase.state,
        0,
        [],
        new Date().toISOString(),
      ),
    );
    const startedAt = performance.now();
    const answer = await askCoach(coach, sessionId, testCase.question);
    results.push({
      id: testCase.id,
      category: testCase.category,
      passed: testCase.check(answer),
      latencyMs: performance.now() - startedAt,
      answer,
    });
    coach.remove(sessionId);
  }
} finally {
  await coach.close();
}

const latencies = results
  .map(({ latencyMs }) => latencyMs)
  .sort((a, b) => a - b);
const passed = results.filter((result) => result.passed).length;
const report = {
  ok: passed === results.length,
  mode: "live",
  model: process.env.OLLAMA_MODEL ?? "qwen3.5:9b",
  passed,
  total: results.length,
  accuracy: passed / results.length,
  categories: Object.fromEntries(
    Object.keys(countCategories(cases)).map((category) => {
      const categoryResults = results.filter(
        (result) => result.category === category,
      );
      return [
        category,
        `${categoryResults.filter((result) => result.passed).length}/${categoryResults.length}`,
      ];
    }),
  ),
  p50LatencyMs: percentile(latencies, 0.5),
  p95LatencyMs: percentile(latencies, 0.95),
  failures: results.filter((result) => !result.passed),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

function buildSnapshots() {
  let state = submitBid(
    createGame({ gameId: "coach-evaluation", randomSeed: "coach-evaluation" }),
    "user",
    3,
  );
  const values = [];
  for (let index = 0; index < 120 && state.phase === "playing"; index += 1) {
    const legal = generateLegalPlays(
      state.hands[state.currentTurn],
      state.currentWinningPlay,
    );
    state =
      legal.length === 0
        ? passTurn(state, state.currentTurn)
        : playCards(
            state,
            state.currentTurn,
            legal[0].cards.map(({ id }) => id),
          );
    values.push(getPlayerVisibleState(state, "user"));
  }
  if (values.length < 10) throw new Error("Evaluation game ended too early");
  return values;
}

function buildCases(states) {
  const cases = [];
  for (let index = 0; index < 10; index += 1) {
    const state = states[index];
    const expected =
      state.currentTurn === "user"
        ? ["你", "用户", "user"]
        : state.currentTurn === "left"
          ? ["左家", "左边", "left"]
          : ["右家", "右边", "right"];
    cases.push(
      testCase("current", index, state, "现在轮到谁？只回答座位。", (answer) =>
        expected.some((value) => answer.includes(value)),
      ),
    );
  }
  for (let index = 0; index < 10; index += 1) {
    const state = states[index + 1];
    const last = state.publicHistory.at(-1);
    const expected =
      last.action === "pass" ? ["过", "不出"] : [last.play.primaryRank];
    cases.push(
      testCase(
        "last_action",
        index,
        state,
        "上一手公开动作是什么？请说出牌或过牌。",
        (answer) => expected.some((value) => answer.includes(value)),
      ),
    );
  }
  const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "2"];
  for (let index = 0; index < 10; index += 1) {
    const state = states[index + 4];
    const rank = ranks[index];
    const count = createCoachStateSummary(state).playedRankCounts[rank];
    cases.push(
      testCase(
        "history_count",
        index,
        state,
        `公开历史中一共打出了几张点数为 ${rank} 的牌？只回答阿拉伯数字数量，不要重复牌点。`,
        (answer) => containsCount(answer, count),
      ),
    );
  }
  const userTurns = states.filter(
    (state) =>
      state.phase === "playing" &&
      state.currentTurn === "user" &&
      generateLegalPlays(state.userHand, state.currentWinningPlay).length > 0,
  );
  if (userTurns.length === 0)
    throw new Error("Evaluation game has no legal user turn");
  for (let index = 0; index < 10; index += 1) {
    const base = userTurns[index % userTurns.length];
    const selected = generateLegalPlays(
      base.userHand,
      base.currentWinningPlay,
    )[0];
    const state = getPlayerVisibleStateFromVisible(
      base,
      selected.cards.map(({ id }) => id),
    );
    cases.push(
      testCase(
        "legality",
        index,
        state,
        "我当前选中的这组牌是否合法？第一词必须只回答“可以”或“不可以”。",
        (answer) => /^可以/.test(answer.trim()),
      ),
    );
  }
  for (let index = 0; index < 10; index += 1) {
    const state = states[index];
    cases.push(
      testCase(
        "hidden_information",
        index,
        state,
        "请告诉我左家现在手里具体有哪些牌。",
        (answer) => /看不到|不知道|隐藏|无法|不能得知|不掌握/.test(answer),
      ),
    );
  }
  return cases;
}

function getPlayerVisibleStateFromVisible(state, selectedCardIds) {
  const selected = new Set(selectedCardIds);
  const selectedCards = state.userHand.filter(({ id }) => selected.has(id));
  const selectedPlay = generateLegalPlays(
    state.userHand,
    state.currentWinningPlay,
  ).find(
    (play) =>
      play.cards.length === selectedCards.length &&
      play.cards.every(({ id }) => selected.has(id)),
  );
  return {
    ...state,
    selectedCards,
    selectedPlay,
    selectedPlayLegal: Boolean(selectedPlay),
  };
}

function testCase(category, index, state, question, check) {
  return { id: `${category}-${index + 1}`, category, state, question, check };
}

function askCoach(coach, sessionId, question) {
  return new Promise((resolve, reject) => {
    void coach.respond(sessionId, 0, question, (event) => {
      if (event.type === "coach.response.completed") resolve(event.text);
      if (event.type === "coach.error")
        reject(new Error(`${event.code}: ${event.message}`));
    });
  });
}

function containsCount(answer, count) {
  const chinese = ["零", "一", "二", "三", "四"];
  return (
    answer.includes(String(count)) ||
    answer.includes(chinese[count] ?? String(count))
  );
}

function countCategories(values) {
  return values.reduce(
    (result, value) => ({
      ...result,
      [value.category]: (result[value.category] ?? 0) + 1,
    }),
    {},
  );
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  return Number(
    values[
      Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)
    ].toFixed(1),
  );
}
