export const VOICE_PROTOCOL_VERSION = 1 as const;

export interface SessionStartMessage {
  readonly type: "session.start";
  readonly protocolVersion: typeof VOICE_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly token: string;
}

export interface TurnCancelMessage {
  readonly type: "turn.cancel";
  readonly generationId?: number;
}

export interface SessionCloseMessage {
  readonly type: "session.close";
}

export interface PingMessage {
  readonly type: "ping";
  readonly timestamp?: number;
}

export interface InputStartMessage {
  readonly type: "input.start";
  readonly sampleRate: number;
}

export interface InputStopMessage {
  readonly type: "input.stop";
}

export type VoiceClientControlMessage =
  | SessionStartMessage
  | TurnCancelMessage
  | SessionCloseMessage
  | PingMessage
  | InputStartMessage
  | InputStopMessage;

export interface SessionReadyEvent {
  readonly type: "session.ready";
  readonly protocolVersion: typeof VOICE_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly expiresAt: string;
}

export interface TurnCancelledEvent {
  readonly type: "turn.cancelled";
  readonly generationId: number;
}

export interface PongEvent {
  readonly type: "pong";
  readonly timestamp?: number;
}

export interface VoiceErrorEvent {
  readonly type: "error";
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

export interface InputReadyEvent {
  readonly type: "input.ready";
  readonly sampleRate: number;
}

export interface InputAudioAckEvent {
  readonly type: "input.audio.ack";
  readonly sequence: number;
  readonly sampleCount: number;
  readonly totalSamples: number;
}

export interface InputStoppedEvent {
  readonly type: "input.stopped";
  readonly totalSamples: number;
}

export type VoiceServerControlEvent =
  | SessionReadyEvent
  | TurnCancelledEvent
  | PongEvent
  | InputReadyEvent
  | InputAudioAckEvent
  | InputStoppedEvent
  | VoiceErrorEvent;

export function parseVoiceClientMessage(
  value: unknown,
): VoiceClientControlMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "session.start":
      if (
        value.protocolVersion !== VOICE_PROTOCOL_VERSION ||
        typeof value.sessionId !== "string" ||
        typeof value.token !== "string"
      ) {
        return null;
      }
      return {
        type: "session.start",
        protocolVersion: value.protocolVersion,
        sessionId: value.sessionId,
        token: value.token,
      };
    case "turn.cancel":
      if (
        value.generationId !== undefined &&
        (typeof value.generationId !== "number" ||
          !Number.isSafeInteger(value.generationId) ||
          value.generationId < 0)
      ) {
        return null;
      }
      return value.generationId === undefined
        ? { type: "turn.cancel" }
        : { type: "turn.cancel", generationId: value.generationId as number };
    case "session.close":
      return { type: "session.close" };
    case "ping":
      if (value.timestamp !== undefined && typeof value.timestamp !== "number")
        return null;
      return value.timestamp === undefined
        ? { type: "ping" }
        : { type: "ping", timestamp: value.timestamp };
    case "input.start":
      if (
        typeof value.sampleRate !== "number" ||
        !Number.isInteger(value.sampleRate) ||
        value.sampleRate < 8_000 ||
        value.sampleRate > 96_000
      ) {
        return null;
      }
      return { type: "input.start", sampleRate: value.sampleRate };
    case "input.stop":
      return { type: "input.stop" };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
