import { readFileSync } from "node:fs";

import {
  createAppServer,
  createLocalSpeechRecognitionService,
  createLocalSpeechSynthesisService,
  createOllamaCoachService,
  createUnavailableSpeechRecognitionService,
  createUnavailableSpeechSynthesisService,
  createUnavailableCoachTextService,
  listenForHttp,
  readServerConfig,
  stopHttpServer,
} from "./index.js";

const config = readServerConfig(process.env);
const speechRecognition = await createLocalSpeechRecognitionService(
  process.env.VOICE_MODELS_DIR,
).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "本地语音识别初始化失败";
  process.stderr.write(`本地语音识别不可用：${message}\n`);
  return createUnavailableSpeechRecognitionService(message);
});
const coachText = await createCoachFromEnvironment();
const speechSynthesis = await createLocalSpeechSynthesisService(
  process.env.VOICE_MODELS_DIR,
  Number(process.env.VOICE_TTS_THREADS ?? 4),
).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "本地语音合成初始化失败";
  process.stderr.write(`本地语音合成不可用：${message}\n`);
  return createUnavailableSpeechSynthesisService(message);
});
const server = createAppServer({
  speechRecognition,
  coachText,
  speechSynthesis,
  ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
  ...(config.tls
    ? {
        tls: {
          key: readFileSync(config.tls.keyPath),
          cert: readFileSync(config.tls.certPath),
        },
      }
    : {}),
});
const listening = await listenForHttp(server, config);
const scheme = config.tls ? "https" : "http";

process.stdout.write(
  `AI 斗地主教练后端已启动：${scheme}://${listening.host}:${listening.port}\n`,
);

let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`收到 ${signal}，正在关闭后端…\n`);

  try {
    await stopHttpServer(server);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(
      `关闭后端失败：${error instanceof Error ? error.message : "未知错误"}\n`,
    );
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function createCoachFromEnvironment() {
  if ((process.env.COACH_PROVIDER?.trim() || "ollama") !== "ollama") {
    return createUnavailableCoachTextService(
      "Only the local Ollama coach is available in this build",
    );
  }
  try {
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
    await coach.warmup();
    return coach;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "本地教练初始化失败";
    process.stderr.write(`本地教练不可用：${message}\n`);
    return createUnavailableCoachTextService(message);
  }
}
