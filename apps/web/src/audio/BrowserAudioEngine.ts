import { StreamingLinearResampler } from "./resample";

const CAPTURE_WORKLET_URL = "/audio-capture-worklet.js";
const PLAYBACK_WORKLET_URL = "/audio-playback-worklet.js";

export interface CapturedAudioChunk {
  readonly sampleRate: number;
  readonly samples: Float32Array;
}

export type CapturedAudioHandler = (chunk: CapturedAudioChunk) => void;
export type PlaybackDrainedHandler = (generationId: number) => void;

export class BrowserAudioEngine {
  readonly sampleRate: number;

  private captureEnabled = false;
  private generationId = 0;
  private playbackResampler: StreamingLinearResampler | undefined;
  private readonly stopWaiters = new Set<() => void>();

  private constructor(
    private readonly context: AudioContext,
    private readonly mediaStream: MediaStream,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly captureNode: AudioWorkletNode,
    private readonly playbackNode: AudioWorkletNode,
    onCapturedAudio: CapturedAudioHandler,
    onPlaybackDrained: PlaybackDrainedHandler,
  ) {
    this.sampleRate = context.sampleRate;
    this.captureNode.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!isRecord(data)) return;
      if (data.type === "audio" && data.samples instanceof Float32Array) {
        onCapturedAudio({ sampleRate: this.sampleRate, samples: data.samples });
      }
      if (data.type === "stopped") {
        for (const resolve of this.stopWaiters) resolve();
        this.stopWaiters.clear();
      }
    };
    this.playbackNode.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (
        isRecord(data) &&
        data.type === "drained" &&
        typeof data.generationId === "number"
      ) {
        onPlaybackDrained(data.generationId);
      }
    };
  }

  static async create(
    onCapturedAudio: CapturedAudioHandler,
    onPlaybackDrained: PlaybackDrainedHandler = () => undefined,
  ): Promise<BrowserAudioEngine> {
    if (!window.isSecureContext) {
      throw new Error("手机麦克风需要 HTTPS 安全连接");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风访问");
    }

    const context = new AudioContext({ latencyHint: "interactive" });
    let mediaStream: MediaStream | undefined;
    try {
      await context.resume();
      await Promise.all([
        context.audioWorklet.addModule(CAPTURE_WORKLET_URL),
        context.audioWorklet.addModule(PLAYBACK_WORKLET_URL),
      ]);
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });

      const source = context.createMediaStreamSource(mediaStream);
      const captureNode = new AudioWorkletNode(context, "doudizhu-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      const playbackNode = new AudioWorkletNode(context, "doudizhu-playback", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      source.connect(captureNode);
      playbackNode.connect(context.destination);
      return new BrowserAudioEngine(
        context,
        mediaStream,
        source,
        captureNode,
        playbackNode,
        onCapturedAudio,
        onPlaybackDrained,
      );
    } catch (error) {
      for (const track of mediaStream?.getTracks() ?? []) track.stop();
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  startCapture(): void {
    if (this.captureEnabled) return;
    this.captureEnabled = true;
    this.captureNode.port.postMessage({ type: "recording", enabled: true });
  }

  async stopCapture(): Promise<void> {
    if (!this.captureEnabled) return;
    this.captureEnabled = false;
    const stopped = new Promise<void>((resolve) =>
      this.stopWaiters.add(resolve),
    );
    this.captureNode.port.postMessage({ type: "recording", enabled: false });
    await Promise.race([stopped, wait(300)]);
    this.stopWaiters.clear();
  }

  enqueuePlayback(
    samples: Float32Array,
    sourceSampleRate: number,
    generationId: number,
  ): void {
    if (generationId !== this.generationId) return;
    if (
      !this.playbackResampler ||
      this.playbackResampler.sourceRate !== sourceSampleRate
    ) {
      this.playbackResampler = new StreamingLinearResampler(
        sourceSampleRate,
        this.sampleRate,
      );
    }
    const converted = this.playbackResampler.process(samples);
    this.postPlayback(converted, generationId);
  }

  finishPlayback(generationId: number): void {
    if (generationId !== this.generationId || !this.playbackResampler) return;
    const tail = this.playbackResampler.flush();
    this.playbackResampler = undefined;
    this.postPlayback(tail, generationId);
  }

  private postPlayback(samples: Float32Array, generationId: number): void {
    if (samples.length === 0) return;
    this.playbackNode.port.postMessage(
      { type: "enqueue", generationId, samples },
      [samples.buffer],
    );
  }

  flushPlayback(generationId = this.generationId + 1): void {
    this.generationId = generationId;
    this.playbackResampler = undefined;
    this.playbackNode.port.postMessage({ type: "flush", generationId });
  }

  playTestTone(): void {
    const durationSeconds = 0.22;
    const samples = new Float32Array(
      Math.round(this.sampleRate * durationSeconds),
    );
    for (let index = 0; index < samples.length; index += 1) {
      const fade = Math.min(1, index / 240, (samples.length - index) / 240);
      samples[index] =
        Math.sin((2 * Math.PI * 440 * index) / this.sampleRate) * 0.1 * fade;
    }
    this.enqueuePlayback(samples, this.sampleRate, this.generationId);
  }

  async close(): Promise<void> {
    await this.stopCapture();
    this.flushPlayback();
    this.source.disconnect();
    this.captureNode.disconnect();
    this.playbackNode.disconnect();
    for (const track of this.mediaStream.getTracks()) track.stop();
    if (this.context.state !== "closed") await this.context.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
