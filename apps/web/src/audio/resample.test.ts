import { describe, expect, it } from "vitest";

import { resampleLinear, StreamingLinearResampler } from "./resample";

describe("resampleLinear", () => {
  it("returns an independent copy at the same sample rate", () => {
    const input = new Float32Array([0, 0.5, 1]);
    const output = resampleLinear(input, 48_000, 48_000);
    expect([...output]).toEqual([0, 0.5, 1]);
    expect(output).not.toBe(input);
  });

  it("changes sample count while preserving endpoints closely", () => {
    const input = new Float32Array([0, 0.5, 1, 0.5]);
    const output = resampleLinear(input, 4, 8);
    expect(output).toHaveLength(8);
    expect(output[0]).toBeCloseTo(0);
    expect(output[6]).toBeCloseTo(0.5);
  });

  it("rejects invalid sample rates", () => {
    expect(() => resampleLinear(new Float32Array(1), 0, 48_000)).toThrow(
      "Invalid source rate",
    );
  });
});

describe("StreamingLinearResampler", () => {
  it("preserves interpolation phase across input chunks", () => {
    const input = Float32Array.from({ length: 40 }, (_, index) => index / 40);
    const whole = resampleLinear(input, 44_100, 48_000);
    const streaming = new StreamingLinearResampler(44_100, 48_000);
    const first = streaming.process(input.slice(0, 17));
    const second = streaming.process(input.slice(17));
    const tail = streaming.flush();
    const combined = [...first, ...second, ...tail];

    expect(combined.length).toBeGreaterThanOrEqual(whole.length - 1);
    for (
      let index = 0;
      index < Math.min(combined.length, whole.length);
      index += 1
    ) {
      expect(combined[index]).toBeCloseTo(whole[index] ?? 0, 5);
    }
  });
});
