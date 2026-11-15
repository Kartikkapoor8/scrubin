/**
 * Small synthesised sounds: a blip when the wound locks, a tick as a stitch starts, a two-note chime as each
 * suture is confirmed (one step higher each time), an arpeggio at the end. No audio files; everything is a
 * few sine waves. Browsers only allow sound after the first key press or click, which the operator always
 * gives anyway.
 */
export class Sounds {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor() {
    // Made at load, suspended: creating an AudioContext takes about 80 ms, which on the first key press was the
    // one dropped frame of a whole run (the first Next of every demo). The first key press now only resumes it.
    this.create();
  }

  private create(): void {
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  /** Call from a key or click handler. */
  unlock(): void {
    if (!this.ctx) this.create();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(frequency: number, at: number, duration: number, level = 1, type: OscillatorType = 'sine', slideTo = 0): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const start = this.ctx.currentTime + at;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  lock(): void {
    this.tone(880, 0, 0.09, 0.5);
    this.tone(1320, 0.07, 0.14, 0.5);
  }

  step(): void {
    this.tone(660, 0, 0.1, 0.45);
    this.tone(990, 0.08, 0.2, 0.4);
  }

  stitchStart(): void {
    this.tone(520, 0, 0.06, 0.4, 'triangle');
    this.tone(420, 0.1, 0.9, 0.12, 'sine', 900); // the needle going through: a soft rising hum
  }

  /** Each suture's chime is one scale step above the last. */
  stitchDone(index: number): void {
    const scale = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];
    const base = 784 * scale[index % scale.length];
    this.tone(1900, 0, 0.03, 0.25, 'triangle'); // the knot
    this.tone(base, 0.03, 0.3, 0.6);
    this.tone(base * 1.5, 0.12, 0.45, 0.5);
    this.tone(base * 3, 0.12, 0.3, 0.12);
  }

  complete(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.11, 0.9, 0.5));
    this.tone(1568, 0.44, 1.2, 0.25);
  }
}
