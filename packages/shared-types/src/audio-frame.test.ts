import { describe, expect, it } from "vitest";

import {
  AUDIO_FRAME_HEADER_BYTES,
  decodePcm16Frame,
  encodePcm16Frame,
} from "./audio-frame.js";

describe("PCM16 audio frame", () => {
  it("round-trips metadata, samples and end-of-stream state", () => {
    const encoded = encodePcm16Frame({
      kind: "input",
      sequence: 42,
      generationId: 7,
      sampleRate: 48_000,
      samples: new Float32Array([-1, -0.25, 0, 0.25, 1]),
      endOfStream: true,
    });

    expect(encoded.byteLength).toBe(AUDIO_FRAME_HEADER_BYTES + 10);
    const decoded = decodePcm16Frame(encoded);
    expect(decoded).toMatchObject({
      kind: "input",
      sequence: 42,
      generationId: 7,
      sampleRate: 48_000,
      endOfStream: true,
    });
    expect([...decoded.samples]).toEqual(
      expect.arrayContaining([
        expect.closeTo(-1, 4),
        expect.closeTo(-0.25, 4),
        0,
        expect.closeTo(0.25, 4),
        expect.closeTo(1, 4),
      ]),
    );
  });

  it("clamps samples outside the normalized range", () => {
    const decoded = decodePcm16Frame(
      encodePcm16Frame({
        kind: "output",
        sequence: 0,
        generationId: 0,
        sampleRate: 24_000,
        samples: new Float32Array([-2, 2]),
      }),
    );

    expect(decoded.kind).toBe("output");
    expect([...decoded.samples]).toEqual([-1, 1]);
  });

  it("rejects truncated, corrupt and unsupported frames", () => {
    expect(() => decodePcm16Frame(new ArrayBuffer(4))).toThrow("truncated");

    const corrupt = encodePcm16Frame({
      kind: "input",
      sequence: 0,
      generationId: 0,
      sampleRate: 16_000,
      samples: new Float32Array(4),
    });
    new DataView(corrupt).setUint32(0, 0, false);
    expect(() => decodePcm16Frame(corrupt)).toThrow("magic");
  });

  it("rejects unsafe metadata before allocating the frame", () => {
    expect(() =>
      encodePcm16Frame({
        kind: "input",
        sequence: -1,
        generationId: 0,
        sampleRate: 16_000,
        samples: new Float32Array(),
      }),
    ).toThrow("sequence");
  });
});
