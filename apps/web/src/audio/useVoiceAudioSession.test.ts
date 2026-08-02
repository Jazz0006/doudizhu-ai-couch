import { describe, expect, it } from "vitest";

import {
  buildWebSocketUrl,
  describeSessionCreationFailure,
} from "./useVoiceAudioSession";

describe("buildWebSocketUrl", () => {
  it("uses secure WebSocket on an HTTPS page", () => {
    expect(
      buildWebSocketUrl("/api/voice/ws", "https://192.168.4.38:5173/game"),
    ).toBe("wss://192.168.4.38:5173/api/voice/ws");
  });

  it("keeps localhost HTTP development usable", () => {
    expect(buildWebSocketUrl("/api/voice/ws", "http://localhost:5173/")).toBe(
      "ws://localhost:5173/api/voice/ws",
    );
  });
});

describe("describeSessionCreationFailure", () => {
  it("explains how to recover when the local proxy cannot reach the backend", () => {
    expect(describeSessionCreationFailure(502)).toContain(
      "npm run voice:dev:server",
    );
  });

  it("keeps other HTTP failures generic", () => {
    expect(describeSessionCreationFailure(400)).toBe(
      "创建语音会话失败（HTTP 400）",
    );
  });
});
