export interface SynthesizedAudioChunk {
  readonly sampleRate: number;
  readonly samples: Float32Array;
}

export interface SpeechSynthesisService {
  synthesize(
    sessionId: string,
    generationId: number,
    text: string,
    onAudio: (chunk: SynthesizedAudioChunk) => void,
  ): Promise<void>;
  cancel(sessionId: string): void;
  remove(sessionId: string): void;
  close(): Promise<void>;
}

export function createUnavailableSpeechSynthesisService(
  message: string,
): SpeechSynthesisService {
  return {
    async synthesize() {
      throw new Error(message);
    },
    cancel() {},
    remove() {},
    async close() {},
  };
}
