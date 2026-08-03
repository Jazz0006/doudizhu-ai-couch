import {
  parseCoachGameContextUpdate,
  parseCoachStyle,
} from "@ai-doudizhu/coach-protocol";
import type {
  CoachGameContextUpdate,
  CoachStyle,
} from "@ai-doudizhu/coach-protocol";

export const VOICE_PROTOCOL_VERSION = 4 as const;

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

export interface GameContextMessage {
  readonly type: "game.context";
  readonly update: CoachGameContextUpdate;
}

export interface CoachSettingsMessage {
  readonly type: "coach.settings";
  readonly style: CoachStyle;
}

export type VoiceClientControlMessage =
  | SessionStartMessage
  | TurnCancelMessage
  | SessionCloseMessage
  | PingMessage
  | InputStartMessage
  | InputStopMessage
  | CoachSettingsMessage
  | GameContextMessage;

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

export interface GameContextAcceptedEvent {
  readonly type: "game.context.accepted";
  readonly status: "accepted" | "idempotent";
  readonly revision: number;
  readonly actionIndex: number;
  readonly gameId: string;
  readonly stateChecksum: string;
}

export interface GameContextRejectedEvent {
  readonly type: "game.context.rejected";
  readonly reason: "stale" | "conflict";
  readonly revision: number;
  readonly gameId: string;
  readonly stateChecksum: string;
}

export interface CoachSettingsAcceptedEvent {
  readonly type: "coach.settings.accepted";
  readonly style: CoachStyle;
}

export interface SpeechStartedEvent {
  readonly type: "speech.started" | "speech.ended";
}

export interface TranscriptEvent {
  readonly type: "transcript.partial" | "transcript.final";
  readonly text: string;
  readonly rawText: string;
}

export interface CoachResponseStartedEvent {
  readonly type: "coach.response.started";
  readonly generationId: number;
  readonly context?: CoachResponseContext;
}

export interface CoachToolCalledEvent {
  readonly type: "coach.tool.called";
  readonly generationId: number;
  readonly name:
    | "get_current_visible_state"
    | "get_legal_actions"
    | "analyze_selected_cards"
    | "highlight_cards";
}

export interface CoachHighlightEvent {
  readonly type: "coach.highlight";
  readonly generationId: number;
  readonly instruction: {
    readonly cardIds: string[];
    readonly reason: string;
    readonly expiresInMs: number;
  };
}

export interface CoachHighlightClearEvent {
  readonly type: "coach.highlight.clear";
  readonly generationId: number;
}

export interface CoachResponseDeltaEvent {
  readonly type: "coach.response.delta";
  readonly generationId: number;
  readonly delta: string;
}

export interface CoachResponseCompletedEvent {
  readonly type: "coach.response.completed";
  readonly generationId: number;
  readonly text: string;
  readonly context?: CoachResponseContext;
}

export interface CoachResponseContext {
  readonly gameId: string;
  readonly revision: number;
  readonly actionIndex: number;
  readonly stateChecksum: string;
}

export interface CoachErrorEvent {
  readonly type: "coach.error";
  readonly generationId: number;
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface TtsStartedEvent {
  readonly type: "tts.started";
  readonly generationId: number;
}

export interface TtsCompletedEvent {
  readonly type: "tts.completed";
  readonly generationId: number;
}

export interface TtsErrorEvent {
  readonly type: "tts.error";
  readonly generationId: number;
  readonly message: string;
}

export type VoiceServerControlEvent =
  | SessionReadyEvent
  | TurnCancelledEvent
  | PongEvent
  | InputReadyEvent
  | InputAudioAckEvent
  | InputStoppedEvent
  | GameContextAcceptedEvent
  | GameContextRejectedEvent
  | CoachSettingsAcceptedEvent
  | SpeechStartedEvent
  | TranscriptEvent
  | CoachResponseStartedEvent
  | CoachToolCalledEvent
  | CoachHighlightEvent
  | CoachHighlightClearEvent
  | CoachResponseDeltaEvent
  | CoachResponseCompletedEvent
  | CoachErrorEvent
  | TtsStartedEvent
  | TtsCompletedEvent
  | TtsErrorEvent
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
    case "coach.settings": {
      const style = parseCoachStyle(value.style);
      return style ? { type: "coach.settings", style } : null;
    }
    case "game.context": {
      const update = parseCoachGameContextUpdate(value.update);
      return update ? { type: "game.context", update } : null;
    }
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
