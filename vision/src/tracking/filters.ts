/**
 * One Euro filter (Casiez, Roussel, Vogel 2012): smooths a noisy signal hard when it is still and lightly
 * when it moves, so a tracked point neither jitters at rest nor lags behind a moving head.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  /**
   * @param minCutoff  Hz. Lower = steadier at rest.
   * @param beta       How quickly smoothing is released as speed rises. Higher = less lag in motion.
   * @param dCutoff    Hz. Smoothing of the speed estimate.
   */
  constructor(private minCutoff = 1.5, private beta = 0.03, private dCutoff = 1) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  get value(): number {
    return this.x ?? 0;
  }

  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawSpeed = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawSpeed - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}
