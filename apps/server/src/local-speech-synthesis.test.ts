import { describe, expect, it } from "vitest";

import { resolveTtsWorkerConfig } from "./local-speech-synthesis.js";

describe("resolveTtsWorkerConfig", () => {
  it("reports a missing model before starting a worker", () => {
    expect(() => resolveTtsWorkerConfig("Z:\\missing-voice-models", 4)).toThrow(
      /Missing modelPath/,
    );
  });

  it("rejects unsafe thread counts", () => {
    expect(() => resolveTtsWorkerConfig(".", 0)).toThrow(/VOICE_TTS_THREADS/);
  });
});
