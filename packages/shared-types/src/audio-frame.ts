export const AUDIO_FRAME_HEADER_BYTES = 24;
export const AUDIO_FRAME_PROTOCOL_VERSION = 1;

const AUDIO_FRAME_MAGIC = 0x44444156;
const PCM16_BYTES_PER_SAMPLE = 2;
const END_OF_STREAM_FLAG = 1;

export type AudioFrameKind = "input" | "output";

export interface EncodePcm16FrameOptions {
  readonly kind: AudioFrameKind;
  readonly sequence: number;
  readonly generationId: number;
  readonly sampleRate: number;
  readonly samples: Float32Array;
  readonly endOfStream?: boolean;
}

export interface DecodedPcm16Frame {
  readonly kind: AudioFrameKind;
  readonly sequence: number;
  readonly generationId: number;
  readonly sampleRate: number;
  readonly samples: Float32Array;
  readonly endOfStream: boolean;
}

export function encodePcm16Frame(
  options: EncodePcm16FrameOptions,
): ArrayBuffer {
  assertUnsignedInteger(options.sequence, "sequence");
  assertUnsignedInteger(options.generationId, "generationId");
  assertSampleRate(options.sampleRate);

  const buffer = new ArrayBuffer(
    AUDIO_FRAME_HEADER_BYTES + options.samples.length * PCM16_BYTES_PER_SAMPLE,
  );
  const view = new DataView(buffer);
  view.setUint32(0, AUDIO_FRAME_MAGIC, false);
  view.setUint8(4, AUDIO_FRAME_PROTOCOL_VERSION);
  view.setUint8(5, encodeKind(options.kind));
  view.setUint8(6, 1);
  view.setUint8(7, options.endOfStream ? END_OF_STREAM_FLAG : 0);
  view.setUint32(8, options.sequence, true);
  view.setUint32(12, options.generationId, true);
  view.setUint32(16, options.sampleRate, true);
  view.setUint32(20, options.samples.length, true);

  let offset = AUDIO_FRAME_HEADER_BYTES;
  for (const sample of options.samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const pcm =
      clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
    view.setInt16(offset, pcm, true);
    offset += PCM16_BYTES_PER_SAMPLE;
  }
  return buffer;
}

export function decodePcm16Frame(
  data: ArrayBuffer | ArrayBufferView,
): DecodedPcm16Frame {
  const bytes = toUint8Array(data);
  if (bytes.byteLength < AUDIO_FRAME_HEADER_BYTES)
    throw new Error("Audio frame is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== AUDIO_FRAME_MAGIC)
    throw new Error("Invalid audio frame magic");
  if (view.getUint8(4) !== AUDIO_FRAME_PROTOCOL_VERSION) {
    throw new Error("Unsupported audio frame protocol version");
  }
  if (view.getUint8(6) !== 1)
    throw new Error("Unsupported audio sample format");

  const sampleCount = view.getUint32(20, true);
  const expectedBytes =
    AUDIO_FRAME_HEADER_BYTES + sampleCount * PCM16_BYTES_PER_SAMPLE;
  if (bytes.byteLength !== expectedBytes)
    throw new Error("Audio frame payload length does not match header");

  const samples = new Float32Array(sampleCount);
  let offset = AUDIO_FRAME_HEADER_BYTES;
  for (let index = 0; index < sampleCount; index += 1) {
    const pcm = view.getInt16(offset, true);
    samples[index] = pcm < 0 ? pcm / 32_768 : pcm / 32_767;
    offset += PCM16_BYTES_PER_SAMPLE;
  }

  const sampleRate = view.getUint32(16, true);
  assertSampleRate(sampleRate);
  return {
    kind: decodeKind(view.getUint8(5)),
    sequence: view.getUint32(8, true),
    generationId: view.getUint32(12, true),
    sampleRate,
    samples,
    endOfStream: (view.getUint8(7) & END_OF_STREAM_FLAG) !== 0,
  };
}

function encodeKind(kind: AudioFrameKind): number {
  return kind === "input" ? 1 : 2;
}

function decodeKind(kind: number): AudioFrameKind {
  if (kind === 1) return "input";
  if (kind === 2) return "output";
  throw new Error("Unsupported audio frame kind");
}

function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function assertUnsignedInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${field} must be an unsigned 32-bit integer`);
  }
}

function assertSampleRate(sampleRate: number): void {
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 96_000
  ) {
    throw new Error("sampleRate must be between 8000 and 96000 Hz");
  }
}
