import { describe, expect, it } from "vitest";

import { resolveWorkerConfig } from "./local-speech-recognition.js";

describe("resolveWorkerConfig", () => {
  it("reports a missing model before starting a worker", () => {
    expect(() => resolveWorkerConfig("Z:\\missing-voice-models")).toThrow(
      /Missing vadModelPath/,
    );
  });
});
