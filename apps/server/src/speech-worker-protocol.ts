import type { SpeechRecognitionEvent } from "./speech-recognition.js";

export interface SpeechWorkerConfig {
  readonly vadModelPath: string;
  readonly asrEncoderPath: string;
  readonly asrDecoderPath: string;
  readonly asrTokensPath: string;
}

export type SpeechWorkerRequest =
  | { readonly type: "initialize"; readonly config: SpeechWorkerConfig }
  | {
      readonly type: "session.start";
      readonly sessionId: string;
      readonly sampleRate: number;
    }
  | {
      readonly type: "audio";
      readonly sessionId: string;
      readonly samples: Float32Array;
    }
  | { readonly type: "session.stop"; readonly sessionId: string }
  | { readonly type: "session.remove"; readonly sessionId: string };

export type SpeechWorkerResponse =
  | { readonly type: "ready" }
  | {
      readonly type: "event";
      readonly sessionId: string;
      readonly event: SpeechRecognitionEvent;
    }
  | { readonly type: "audio.processed"; readonly sessionId: string }
  | { readonly type: "session.stopped"; readonly sessionId: string }
  | { readonly type: "fatal"; readonly message: string };
