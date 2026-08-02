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
