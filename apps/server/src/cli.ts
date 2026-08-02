import {
  createAppServer,
  listenForHttp,
  readServerConfig,
  stopHttpServer,
} from "./index.js";

const config = readServerConfig(process.env);
const server = createAppServer({
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
import { readFileSync } from "node:fs";
