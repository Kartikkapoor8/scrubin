import { add, el } from '../core/dom';

export interface LatencyEstimate {
  /** Glass to glass: from this screen changing to the change being shown in the picture, in milliseconds. */
  delayMs: number;
  /** 0..1: how well the picture follows the flashing (Pearson correlation at the best delay). */
  confidence: number;
}

const GRID_W = 32;
const GRID_H = 18;
/** Longest delay looked for, and the step between delays tried (ms). */
const MAX_DELAY = 3000;
const STEP = 10;
/** Seconds of history the estimate uses. */
const WINDOW = 9000;

/**
 * Measures the headset stream's real delay without anyone reading a clock: a white patch on this screen
 * flashes on and off at random moments; when the headset looks at the screen the flashes appear in its
 * picture, and the delay at which the picture best follows the flashing is the delay of the whole chain
 * (camera, encoder, network, relay, player, display). Random timing, so a 1.7 s delay cannot be mistaken
 * for 0.7 s, as it could with a regular blink.
 */
export class LatencyProbe {
  active = false;
  estimate: LatencyEstimate | null = null;
  private patch: HTMLDivElement;
  /** When the patch changed (performance.now() of the frame it was drawn in) and to what. */
  private toggles: Array<{ at: number; on: boolean }> = [];
  private nextToggle = 0;
  private on = false;
  private samples: Array<{ at: number; cells: Float32Array }> = [];
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private lastCompute = 0;
  private seed = 12345;

  constructor(parent: HTMLElement) {
    this.patch = add(parent, el('div', 'latency-patch'));
    this.canvas.width = GRID_W * 2;
    this.canvas.height = GRID_H * 2;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false })!;
  }

  start(): void {
    this.active = true;
    this.reset();
    this.patch.classList.add('latency-patch--on');
  }

  stop(): void {
    this.active = false;
    this.patch.classList.remove('latency-patch--on', 'latency-patch--lit');
  }

  /** Forget what was measured (after switching stream preset). The flashing carries on. */
  reset(): void {
    this.samples = [];
    this.estimate = null;
  }

  /** Every display frame: flash the patch on its random schedule. */
  tick(now: number): void {
    if (!this.active) return;
    if (now >= this.nextToggle) {
      this.on = !this.on;
      this.patch.classList.toggle('latency-patch--lit', this.on);
      this.toggles.push({ at: now, on: this.on });
      while (this.toggles.length > 2 && now - this.toggles[1].at > WINDOW + MAX_DELAY + 2000) this.toggles.shift();
      this.nextToggle = now + 180 + this.random() * 520;
    }
    if (now - this.lastCompute > 500) {
      this.lastCompute = now;
      this.estimate = this.compute() ?? this.estimate;
    }
  }

  /** Every video frame: brightness on a coarse grid. `shownAt`: when this frame is (expected to be) on screen. */
  sample(video: HTMLVideoElement, shownAt: number): void {
    if (!this.active || video.readyState < 2 || !video.videoWidth) return;
    try {
      this.ctx.drawImage(video, 0, 0, GRID_W * 2, GRID_H * 2);
    } catch {
      return;
    }
    const data = this.ctx.getImageData(0, 0, GRID_W * 2, GRID_H * 2).data;
    const cells = new Float32Array(GRID_W * GRID_H);
    for (let y = 0; y < GRID_H * 2; y++) {
      for (let x = 0; x < GRID_W * 2; x++) {
        const i = (y * GRID_W * 2 + x) * 4;
        cells[(y >> 1) * GRID_W + (x >> 1)] += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
    }
    this.samples.push({ at: shownAt, cells });
    while (this.samples.length && shownAt - this.samples[0].at > WINDOW) this.samples.shift();
  }

  /** Was the patch lit at time t? */
  private litAt(t: number): number {
    const toggles = this.toggles;
    let lit = 0;
    for (let i = toggles.length - 1; i >= 0; i--) {
      if (toggles[i].at <= t) { lit = toggles[i].on ? 1 : 0; break; }
    }
    return lit;
  }

  private compute(): LatencyEstimate | null {
    const samples = this.samples;
    if (samples.length < 60 || samples[samples.length - 1].at - samples[0].at < 4000) return null;
    const n = samples.length;
    // The cells that change the most are where the screen is in the picture.
    const cellCount = GRID_W * GRID_H;
    const variance = new Float32Array(cellCount);
    for (let c = 0; c < cellCount; c++) {
      let sum = 0, sum2 = 0;
      for (const s of samples) { sum += s.cells[c]; sum2 += s.cells[c] * s.cells[c]; }
      variance[c] = sum2 / n - (sum / n) ** 2;
    }
    const order = Array.from(variance.keys()).sort((a, b) => variance[b] - variance[a]).slice(0, 12);
    let best = { delay: 0, r: 0 };
    const curve: number[] = [];
    for (let delay = 0; delay <= MAX_DELAY; delay += STEP) {
      // The flash pattern as the picture would show it with this delay.
      const ref = new Float32Array(n);
      let rs = 0, rs2 = 0;
      for (let k = 0; k < n; k++) { ref[k] = this.litAt(samples[k].at - delay); rs += ref[k]; rs2 += ref[k] * ref[k]; }
      const rVar = rs2 / n - (rs / n) ** 2;
      if (rVar < 0.04) { curve.push(0); continue; } // the pattern barely changed over this stretch
      let top = 0;
      for (const c of order) {
        let xs = 0, xs2 = 0, xr = 0;
        for (let k = 0; k < n; k++) { const x = samples[k].cells[c]; xs += x; xs2 += x * x; xr += x * ref[k]; }
        const xVar = xs2 / n - (xs / n) ** 2;
        if (xVar <= 1e-6) continue;
        const r = (xr / n - (xs / n) * (rs / n)) / Math.sqrt(xVar * rVar);
        if (r > top) top = r;
      }
      curve.push(top);
      if (top > best.r) best = { delay, r: top };
    }
    // A clear winner only: nothing nearly as good well away from it.
    let rival = 0;
    curve.forEach((r, i) => { if (Math.abs(i * STEP - best.delay) > 200) rival = Math.max(rival, r); });
    if (best.r < 0.5 || rival > best.r * 0.85) return null;
    return { delayMs: best.delay, confidence: +best.r.toFixed(2) };
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * Self-test with no headset (from the console or dev/shot.mjs): pretend the picture shows the patch
   * `delayMs` late, with noise, and see what comes out.
   */
  selfTest(delayMs: number): LatencyEstimate | null {
    const saved = { samples: this.samples, toggles: this.toggles, estimate: this.estimate };
    this.samples = [];
    this.toggles = [];
    let on = false;
    let next = 0;
    for (let t = 0; t < 12000; t += 1000 / 60) {
      if (t >= next) { on = !on; this.toggles.push({ at: t, on }); next = t + 180 + this.random() * 520; }
    }
    for (let t = 2000; t < 12000; t += 1000 / 30) {
      const cells = new Float32Array(GRID_W * GRID_H);
      for (let c = 0; c < cells.length; c++) cells[c] = 400 + Math.random() * 60;
      const lit = this.litAt(t - delayMs);
      for (const c of [40, 41, 72, 73]) cells[c] += lit * 300;
      this.samples.push({ at: t, cells });
    }
    const result = this.compute();
    this.samples = saved.samples;
    this.toggles = saved.toggles;
    this.estimate = saved.estimate;
    return result;
  }
}
