export type SpeechRecognitionEvent =
  | { readonly type: "speech.started" }
  | { readonly type: "speech.ended" }
  | {
      readonly type: "transcript.partial" | "transcript.final";
      readonly text: string;
      readonly rawText: string;
    }
  | {
      readonly type: "recognition.error";
      readonly code: string;
      readonly message: string;
      readonly recoverable: boolean;
    };

export interface SpeechRecognitionService {
  start(
    sessionId: string,
    sampleRate: number,
    onEvent: (event: SpeechRecognitionEvent) => void,
  ): void;
  acceptAudio(sessionId: string, samples: Float32Array): void;
  stop(sessionId: string): Promise<void>;
  remove(sessionId: string): void;
  close(): Promise<void>;
}

export function createUnavailableSpeechRecognitionService(
  message: string,
): SpeechRecognitionService {
  return {
    start(_sessionId, _sampleRate, onEvent) {
      onEvent({
        type: "recognition.error",
        code: "RECOGNITION_UNAVAILABLE",
        message,
        recoverable: false,
      });
    },
    acceptAudio() {},
    async stop() {},
    remove() {},
    async close() {},
  };
}
