export const sharedTypesPackageName = "@ai-doudizhu/shared-types" as const;

export {
  AUDIO_FRAME_HEADER_BYTES,
  AUDIO_FRAME_PROTOCOL_VERSION,
  decodePcm16Frame,
  encodePcm16Frame,
} from "./audio-frame.js";
export type {
  AudioFrameKind,
  DecodedPcm16Frame,
  EncodePcm16FrameOptions,
} from "./audio-frame.js";
