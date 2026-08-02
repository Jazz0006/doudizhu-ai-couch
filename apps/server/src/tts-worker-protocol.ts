export interface TtsWorkerConfig {
  readonly modelPath: string;
  readonly tokensPath: string;
  readonly lexiconPath: string;
  readonly ruleFsts: string;
  readonly numThreads: number;
}

export type TtsWorkerRequest =
  | { readonly type: "initialize"; readonly config: TtsWorkerConfig }
  | {
      readonly type: "synthesize";
      readonly requestId: string;
      readonly sessionId: string;
      readonly generationId: number;
      readonly text: string;
    }
  | { readonly type: "cancel"; readonly sessionId: string };

export type TtsWorkerResponse =
  | { readonly type: "ready"; readonly sampleRate: number }
  | {
      readonly type: "audio";
      readonly requestId: string;
      readonly sampleRate: number;
      readonly samples: Float32Array;
    }
  | { readonly type: "completed"; readonly requestId: string }
  | { readonly type: "cancelled"; readonly requestId: string }
  | {
      readonly type: "error";
      readonly requestId: string;
      readonly message: string;
    }
  | { readonly type: "fatal"; readonly message: string };
