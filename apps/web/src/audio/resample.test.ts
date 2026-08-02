import { describe, expect, it } from "vitest";

import { resampleLinear } from "./resample";

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
