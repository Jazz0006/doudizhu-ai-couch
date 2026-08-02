import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const certificateRoot = fileURLToPath(
  new URL("../../certs/local/", import.meta.url),
);
const certificatePath = `${certificateRoot}local-cert.pem`;
const keyPath = `${certificateRoot}local-key.pem`;
const hasLocalTls = existsSync(certificatePath) && existsSync(keyPath);
const voiceServerOrigin =
  process.env.VOICE_SERVER_ORIGIN ??
  `${hasLocalTls ? "https" : "http"}://127.0.0.1:3000`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    ...(hasLocalTls
      ? {
          https: {
            cert: readFileSync(certificatePath),
            key: readFileSync(keyPath),
          },
        }
      : {}),
    proxy: {
      "/api": {
        target: voiceServerOrigin,
        changeOrigin: false,
        secure: hasLocalTls,
        ws: true,
      },
    },
  },
});
