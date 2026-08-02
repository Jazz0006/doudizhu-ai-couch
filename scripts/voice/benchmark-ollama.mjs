import { performance } from "node:perf_hooks";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";
const numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 4096);
const prompt =
  "你是斗地主教练。玩家问：我有一手连对，应该先出吗？请只用两句中文简短回答。";

async function benchmark(label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const startedAt = performance.now();
  let firstTextMs;
  let text = "";
  let finalChunk;

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        think: false,
        keep_alive: "30m",
        options: { num_ctx: numCtx, temperature: 0.3, num_predict: 160 },
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`Ollama returned HTTP ${response.status}`);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        const content = event.message?.content ?? "";
        if (content && firstTextMs === undefined)
          firstTextMs = performance.now() - startedAt;
        text += content;
        if (event.done) finalChunk = event;
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    label,
    model,
    numCtx,
    firstTextMs:
      firstTextMs === undefined ? null : Number(firstTextMs.toFixed(1)),
    elapsedMs: Number(elapsedMs.toFixed(1)),
    loadMs: finalChunk?.load_duration
      ? Number((finalChunk.load_duration / 1e6).toFixed(1))
      : null,
    promptEvalMs: finalChunk?.prompt_eval_duration
      ? Number((finalChunk.prompt_eval_duration / 1e6).toFixed(1))
      : null,
    evalCount: finalChunk?.eval_count ?? null,
    tokensPerSecond:
      finalChunk?.eval_count && finalChunk?.eval_duration
        ? Number(
            (finalChunk.eval_count / (finalChunk.eval_duration / 1e9)).toFixed(
              2,
            ),
          )
        : null,
    text,
  };
}

const reports = [await benchmark("cold-or-first"), await benchmark("warm")];
console.log(JSON.stringify({ baseUrl, numCtx, reports }, null, 2));
