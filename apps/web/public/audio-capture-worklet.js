class DoudizhuCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.frameSize = Math.max(128, Math.round(sampleRate * 0.02));
    this.frame = new Float32Array(this.frameSize);
    this.frameOffset = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "recording") {
        const wasRecording = this.recording;
        this.recording = Boolean(data.enabled);
        if (wasRecording && !this.recording) {
          this.flushFrame();
          this.port.postMessage({ type: "stopped" });
        }
      }
      if (data?.type === "reset") {
        this.frameOffset = 0;
      }
    };
  }

  process(inputs) {
    if (!this.recording) return true;
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const writable = Math.min(
        channel.length - sourceOffset,
        this.frame.length - this.frameOffset,
      );
      this.frame.set(
        channel.subarray(sourceOffset, sourceOffset + writable),
        this.frameOffset,
      );
      sourceOffset += writable;
      this.frameOffset += writable;
      if (this.frameOffset === this.frame.length) this.flushFrame();
    }
    return true;
  }

  flushFrame() {
    if (this.frameOffset === 0) return;
    const samples = this.frame.slice(0, this.frameOffset);
    this.port.postMessage({ type: "audio", samples }, [samples.buffer]);
    this.frame = new Float32Array(this.frameSize);
    this.frameOffset = 0;
  }
}

registerProcessor("doudizhu-capture", DoudizhuCaptureProcessor);
