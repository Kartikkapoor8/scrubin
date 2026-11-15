/**
 * Microphone capture for Gemini Live: mono, 16 kHz, 16-bit PCM, delivered in 100 ms chunks as base64
 * (the format the Live API takes: `audio/pcm;rate=16000`). Also keeps a rough input level for the UI.
 */

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1600);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.buffer.length - this.filled);
        this.buffer.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export class Mic {
  /** 0..1, smoothed loudness of what the microphone hears. */
  level = 0;
  /** A slow estimate of the room's own noise, so "someone is speaking" holds in a loud hall as in a quiet room. */
  floor = 0.02;
  /** The last two and a half seconds of audio, so the start of a question is never lost (see lastChunks). */
  private recent: string[] = [];

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  get running(): boolean {
    return this.node !== null;
  }

  /** Throws a DOMException (NotAllowedError, NotFoundError...) if the microphone cannot be opened. */
  async start(onChunk: (base64Pcm: string) => void): Promise<void> {
    if (this.node) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    // Asking for a 16 kHz context makes the browser do the resampling.
    this.context = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = this.context.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.context, 'pcm-capture');
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = event.data;
      const pcm = new Int16Array(samples.length);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / samples.length);
      this.level += (Math.min(1, rms * 6) - this.level) * 0.5;
      this.floor += (this.level - this.floor) * (this.level < this.floor ? 0.2 : 0.0015);
      const chunk = toBase64(new Uint8Array(pcm.buffer));
      this.recent.push(chunk);
      if (this.recent.length > 25) this.recent.shift();
      onChunk(chunk);
    };
    source.connect(node);
    this.node = node;
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
  }

  /** Someone is speaking (louder than the room). */
  get speaking(): boolean {
    return this.level > Math.max(0.05, this.floor * 2 + 0.03);
  }

  /**
   * The audio of the last `ms` milliseconds, oldest first. A turn that opens a moment after the speaker
   * started (the wake phrase is recognised late; a held key is told from a tap late) sends this first.
   * It lives in memory only and is overwritten as it goes.
   */
  lastChunks(ms: number): string[] {
    const count = Math.min(this.recent.length, Math.ceil(ms / 100));
    return count > 0 ? this.recent.slice(-count) : [];
  }

  /** Browsers hold audio back until the first key press or tap: call this from one. */
  resume(): void {
    if (this.context && this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  stop(): void {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.level = 0;
    this.recent = [];
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Plays the 24 kHz PCM that Gemini Live speaks with, chunk after chunk, with no gaps. */
export class VoicePlayer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scratch = new Float32Array(512);
  private nextAt = 0;
  private playing: AudioBufferSourceNode[] = [];

  /** Something is being spoken right now. */
  get speaking(): boolean {
    return this.playing.length > 0;
  }

  /** 0..1 loudness of what is being spoken right now (for the waveform). */
  get level(): number {
    if (!this.analyser || this.playing.length === 0) return 0;
    this.analyser.getFloatTimeDomainData(this.scratch);
    let sum = 0;
    for (let i = 0; i < this.scratch.length; i++) sum += this.scratch[i] * this.scratch[i];
    return Math.min(1, Math.sqrt(sum / this.scratch.length) * 4.5);
  }

  play(base64Pcm: string): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.context.destination);
    }
    const context = this.context;
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const binary = atob(base64Pcm);
    const samples = new Float32Array(binary.length >> 1);
    for (let i = 0; i < samples.length; i++) {
      const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
    }
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser ?? context.destination);
    const at = Math.max(context.currentTime + 0.02, this.nextAt);
    source.start(at);
    this.nextAt = at + buffer.duration;
    this.playing.push(source);
    source.onended = () => { this.playing = this.playing.filter((s) => s !== source); };
  }

  /** The trainee started talking over the answer: stop speaking at once. */
  stop(): void {
    for (const source of this.playing) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.playing = [];
    this.nextAt = 0;
  }
}
