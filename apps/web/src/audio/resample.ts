export function resampleLinear(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0)
    throw new Error("Invalid source rate");
  if (!Number.isFinite(targetRate) || targetRate <= 0)
    throw new Error("Invalid target rate");
  if (samples.length === 0 || sourceRate === targetRate) return samples.slice();

  const outputLength = Math.max(
    1,
    Math.round((samples.length * targetRate) / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    output[index] =
      (samples[leftIndex] ?? 0) * (1 - fraction) +
      (samples[rightIndex] ?? 0) * fraction;
  }
  return output;
}

export class StreamingLinearResampler {
  private pending = new Float32Array();
  private sourcePosition = 0;

  constructor(
    readonly sourceRate: number,
    readonly targetRate: number,
  ) {
    if (!Number.isFinite(sourceRate) || sourceRate <= 0)
      throw new Error("Invalid source rate");
    if (!Number.isFinite(targetRate) || targetRate <= 0)
      throw new Error("Invalid target rate");
  }

  process(samples: Float32Array): Float32Array {
    if (this.sourceRate === this.targetRate) return samples.slice();
    this.pending = concatenate(this.pending, samples);
    return this.takeOutput(false);
  }

  flush(): Float32Array {
    if (this.sourceRate === this.targetRate) return new Float32Array();
    const output = this.takeOutput(true);
    this.pending = new Float32Array();
    this.sourcePosition = 0;
    return output;
  }

  private takeOutput(flush: boolean): Float32Array {
    const output: number[] = [];
    const ratio = this.sourceRate / this.targetRate;
    const limit = flush ? this.pending.length : this.pending.length - 1;
    while (this.sourcePosition < limit) {
      const leftIndex = Math.floor(this.sourcePosition);
      const rightIndex = Math.min(this.pending.length - 1, leftIndex + 1);
      const fraction = this.sourcePosition - leftIndex;
      output.push(
        (this.pending[leftIndex] ?? 0) * (1 - fraction) +
          (this.pending[rightIndex] ?? 0) * fraction,
      );
      this.sourcePosition += ratio;
    }
    const consumed = Math.min(
      this.pending.length,
      Math.floor(this.sourcePosition),
    );
    if (consumed > 0) {
      this.pending = this.pending.slice(consumed);
      this.sourcePosition -= consumed;
    }
    return Float32Array.from(output);
  }
}

function concatenate(
  left: Float32Array,
  right: Float32Array,
): Float32Array<ArrayBuffer> {
  const joined = new Float32Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}
