class DoudizhuPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.generationId = 0;
    this.queue = [];
    this.queuedSamples = 0;
    this.wasPlaying = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "generation") {
        this.generationId = data.generationId;
        this.clearQueue();
      }
      if (
        data?.type === "enqueue" &&
        data.generationId === this.generationId &&
        data.samples instanceof Float32Array
      ) {
        this.queue.push({ samples: data.samples, offset: 0 });
        this.queuedSamples += data.samples.length;
      }
      if (data?.type === "flush") {
        this.generationId = data.generationId;
        this.clearQueue();
        this.port.postMessage({
          type: "flushed",
          generationId: this.generationId,
        });
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0].length;

    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      let sample = 0;
      const current = this.queue[0];
      if (current) {
        sample = current.samples[current.offset] ?? 0;
        current.offset += 1;
        this.queuedSamples -= 1;
        if (current.offset >= current.samples.length) this.queue.shift();
      }
      for (const channel of output) channel[frameIndex] = sample;
    }

    const isPlaying = this.queue.length > 0;
    if (this.wasPlaying && !isPlaying) {
      this.port.postMessage({
        type: "drained",
        generationId: this.generationId,
      });
    }
    this.wasPlaying = isPlaying;
    return true;
  }

  clearQueue() {
    this.queue = [];
    this.queuedSamples = 0;
    this.wasPlaying = false;
  }
}

registerProcessor("doudizhu-playback", DoudizhuPlaybackProcessor);
