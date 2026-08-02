import { describe, expect, it } from "vitest";

import {
  createAppServer,
  listenForHttp,
  readServerConfig,
  stopHttpServer,
} from "./index.js";
import type { ListeningServer } from "./index.js";

const NOW = "2026-08-01T06:00:00.000Z";

describe("HTTP server", () => {
  it("serves the health contract with a fresh, non-cacheable timestamp", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(response.json()).resolves.toEqual({ ok: true, time: NOW });
    });
  });

  it("matches /health independently of its query string", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/health?probe=readiness`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, time: NOW });
    });
  });

  it("returns a structured 404 without reflecting the requested path", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/private-value`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
    });
  });

  it("rejects unsupported health methods and advertises GET", async () => {
    await withServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/health`, { method: "POST" });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed",
        },
      });
    });
  });

  it("can stop cleanly and treats repeated stops as a no-op", async () => {
    const server = createAppServer();
    const listening = await listenForHttp(server, {
      host: "127.0.0.1",
      port: 0,
    });

    expect(listening.port).toBeGreaterThan(0);
    await stopHttpServer(server);
    await expect(stopHttpServer(server)).resolves.toBeUndefined();
  });
});

describe("server configuration", () => {
  it("uses safe development defaults", () => {
    expect(readServerConfig({})).toEqual({ host: "0.0.0.0", port: 3000 });
  });

  it("reads a configured host and port", () => {
    expect(readServerConfig({ HOST: "127.0.0.1", PORT: "8080" })).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
  });

  it.each(["0", "65536", "3.5", "not-a-port"])(
    "rejects invalid PORT=%s",
    (port) => {
      expect(() => readServerConfig({ PORT: port })).toThrow(
        "PORT must be an integer between 1 and 65535",
      );
    },
  );

  it("reads TLS paths and an explicit origin allowlist", () => {
    expect(
      readServerConfig({
        TLS_KEY_PATH: "certs/local-key.pem",
        TLS_CERT_PATH: "certs/local-cert.pem",
        ALLOWED_ORIGINS: "https://192.168.1.20:5173, https://coach.test",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 3000,
      allowedOrigins: ["https://192.168.1.20:5173", "https://coach.test"],
      tls: {
        keyPath: "certs/local-key.pem",
        certPath: "certs/local-cert.pem",
      },
    });
  });

  it("requires the TLS key and certificate to be configured together", () => {
    expect(() => readServerConfig({ TLS_KEY_PATH: "local-key.pem" })).toThrow(
      "TLS_KEY_PATH and TLS_CERT_PATH must be configured together",
    );
  });
});

async function withServer(
  run: (context: { baseUrl: string }) => Promise<void>,
): Promise<void> {
  const server = createAppServer({ now: () => new Date(NOW) });
  const listening: ListeningServer = await listenForHttp(server, {
    host: "127.0.0.1",
    port: 0,
  });

  try {
    await run({ baseUrl: `http://${listening.host}:${listening.port}` });
  } finally {
    await stopHttpServer(server);
  }
}
