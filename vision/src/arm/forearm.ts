import { OneEuro } from '../tracking/filters';
import type { TrackedHand } from '../tracking/hands';

/** Mid-forearm width of an adult, in millimetres: the only thing that turns pixels into millimetres here. */
export const FOREARM_WIDTH_MM = 65;

/** One frame's fit of the forearm, in video pixels. */
export interface ForearmFit {
  /** Wrist: where the forearm's axis meets the wrist. */
  wx: number;
  wy: number;
  /** Unit vector along the forearm, wrist to elbow. */
  ux: number;
  uy: number;
  /** Visible length from the wrist (to the elbow, or to where the arm leaves the picture). */
  length: number;
  /** Full widths near the wrist, at the middle and near the far end. */
  wristWidth: number;
  midWidth: number;
  endWidth: number;
  /** The wrist came from MediaPipe's hand landmarks (true) or from the shape of the skin alone. */
  fromHand: boolean;
  /** Skin pixels in the fitted region (mask pixels). */
  pixels: number;
  /** The far end is inside the picture (false: the arm runs off the edge, so its real end is further on). */
  endInFrame: boolean;
}

/** A pixel inside the forearm, for other detectors (in mask coordinates). */
export interface ForearmRegion {
  mask: Uint8Array;
  width: number;
  height: number;
}

/**
 * Fits the forearm in a skin mask. With a hand in view, the wrist comes from the hand landmarks and only skin
 * joined to the wrist on the forearm's side counts (so a face, the other arm or the hand itself do not pull
 * the fit). Without one, the largest elongated patch of skin is taken and its narrower end (or the end that
 * is not cut off by the edge of the picture) is the wrist. Direction and width come from the pixels' spread
 * (principal component analysis), widths at the wrist, middle and far end from robust extents across it.
 */
export class ForearmFitter {
  /** The pixels the last fit used, for the debug view (1 = used). */
  readonly used: Uint8Array;
  private stack: Int32Array;
  private seen: Uint8Array;
  private along: Float32Array;
  private across: Float32Array;

  constructor(private mw: number, private mh: number) {
    this.used = new Uint8Array(mw * mh);
    this.stack = new Int32Array(mw * mh);
    this.seen = new Uint8Array(mw * mh);
    this.along = new Float32Array(mw * mh);
    this.across = new Float32Array(mw * mh);
  }

  /**
   * `prior`: where the forearm was a moment ago. In a frame where the hand detector reports nothing (it skips
   * frames, and loses a hand that turns side-on), the last wrist stands in for it, so the fit never jumps to
   * the shape-only guess while an arm is being tracked.
   */
  fit(mask: Uint8Array, hands: TrackedHand[], vw: number, vh: number, prior: ForearmFit | null = null, anchorOnPrior = false): ForearmFit | null {
    const mw = this.mw, mh = this.mh;
    const sx = vw / mw, sy = vh / mh;
    this.used.fill(0);
    const minPixels = Math.round(mw * mh * 0.012);

    // 1. With a hand: the skin joined to its wrist, on the forearm's side of it.
    let best: { count: number; wrist: { x: number; y: number }; hand: { x: number; y: number } } | null = null;
    let bestStart = 0, bestEnd = 0;
    let cursor = 0;
    this.seen.fill(0);
    // Anchors: each hand's wrist and the direction of its fingers; failing those, the last known wrist.
    const anchors: Array<{ w: { x: number; y: number }; hx: number; hy: number; span: number }> = [];
    for (const hand of hands) {
      const w = hand.points[0];
      const knuckles = [5, 9, 13, 17].map((i) => hand.points[i]);
      const fx = knuckles.reduce((s, p) => s + p.x, 0) / 4;
      const fy = knuckles.reduce((s, p) => s + p.y, 0) / 4;
      const span = Math.hypot(fx - w.x, fy - w.y);
      if (span >= 8) anchors.push({ w, hx: (fx - w.x) / span, hy: (fy - w.y) / span, span });
    }
    const usingPrior = anchors.length === 0 && prior !== null && anchorOnPrior;
    if (usingPrior && prior) {
      // A hand is about 1.45 forearm-widths from wrist to knuckles.
      anchors.push({ w: { x: prior.wx, y: prior.wy }, hx: -prior.ux, hy: -prior.uy, span: prior.midWidth * 1.45 });
    }
    for (const { w, hx, hy, span } of anchors) {
      const reach = (3.6 * span) / Math.min(sx, sy);
      const allowed = (x: number, y: number) => {
        const vx = x * sx - w.x, vy = y * sy - w.y;
        return vx * hx + vy * hy < 0.15 * span && vx * vx + vy * vy < (3.6 * span) ** 2;
      };
      // Seed: the skin pixel nearest a point a little way up the forearm from the wrist.
      const seedX = (w.x - hx * 0.45 * span) / sx, seedY = (w.y - hy * 0.45 * span) / sy;
      const seed = this.nearestSkin(mask, seedX, seedY, (0.6 * span) / Math.min(sx, sy), allowed);
      if (seed < 0 || reach < 4) continue;
      const start = cursor;
      const end = this.flood(mask, seed, allowed, start);
      cursor = end;
      const count = end - start;
      if (count >= minPixels && (!best || count > best.count)) {
        best = { count, wrist: { x: w.x, y: w.y }, hand: { x: hx, y: hy } };
        bestStart = start;
        bestEnd = end;
      }
    }

    // 2. Without one: the largest patch of skin.
    let fromHand = best !== null;
    if (!best) {
      this.seen.fill(0);
      cursor = 0;
      let bestCount = 0;
      for (let seed = 0; seed < mask.length; seed++) {
        if (!mask[seed] || this.seen[seed]) continue;
        const start = cursor;
        const end = this.flood(mask, seed, null, start);
        cursor = end;
        if (end - start > bestCount) {
          bestCount = end - start;
          bestStart = start;
          bestEnd = end;
        }
      }
      if (bestCount < minPixels * 1.5) return null;
      fromHand = false;
    }

    // 3. Principal axis of the region, in video pixels (the mask may not have square pixels).
    const stack = this.stack;
    const n = bestEnd - bestStart;
    let mx = 0, my = 0;
    for (let i = bestStart; i < bestEnd; i++) {
      const p = stack[i];
      const x = p % mw;
      mx += (x + 0.5) * sx;
      my += ((p - x) / mw + 0.5) * sy;
    }
    mx /= n; my /= n;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let i = bestStart; i < bestEnd; i++) {
      const p = stack[i];
      const x = p % mw;
      const dx = (x + 0.5) * sx - mx, dy = ((p - x) / mw + 0.5) * sy - my;
      cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
      this.used[p] = 1;
    }
    cxx /= n; cyy /= n; cxy /= n;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const spread = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    const l1 = (cxx + cyy) / 2 + spread;
    const l2 = Math.max(1e-3, (cxx + cyy) / 2 - spread);
    let ux = Math.cos(angle), uy = Math.sin(angle);

    // 4. Where the wrist is on that axis, and which way is the elbow.
    let ax: number, ay: number;
    if (best) {
      if ((mx - best.wrist.x) * ux + (my - best.wrist.y) * uy < 0) { ux = -ux; uy = -uy; }
      const t = (best.wrist.x - mx) * ux + (best.wrist.y - my) * uy;
      ax = mx + ux * t;
      ay = my + uy * t;
    } else {
      // Extent along the axis, from the centre.
      const { lo, hi, loWidth, hiWidth, loEdge, hiEdge } = this.ends(bestStart, bestEnd, mx, my, ux, uy, sx, sy);
      // The wrist is the end inside the picture; if both or neither are, the narrower one. While an arm is
      // being tracked, simply the end nearer the last wrist, so the direction can never flip.
      let wristAtLo = loWidth < hiWidth;
      if (loEdge !== hiEdge) wristAtLo = !loEdge;
      if (prior) {
        const dLo = Math.hypot(mx - ux * lo - prior.wx, my - uy * lo - prior.wy);
        const dHi = Math.hypot(mx + ux * hi - prior.wx, my + uy * hi - prior.wy);
        wristAtLo = dLo <= dHi;
      }
      if (!wristAtLo) { ux = -ux; uy = -uy; }
      const t = wristAtLo ? lo : -hi;
      ax = mx + ux * t;
      ay = my + uy * t;
      if (Math.sqrt(l1 / l2) < 2.2) return null; // a round patch of skin is not a forearm
    }

    // 5. Along and across the axis from the wrist: visible length and the widths.
    const nx = -uy, ny = ux;
    let m = 0;
    for (let i = bestStart; i < bestEnd; i++) {
      const p = stack[i];
      const x = p % mw;
      const vx = (x + 0.5) * sx - ax, vy = ((p - x) / mw + 0.5) * sy - ay;
      const t = vx * ux + vy * uy;
      if (t < 0) continue;
      this.along[m] = t;
      this.across[m] = vx * nx + vy * ny;
      m++;
    }
    if (m < minPixels) return null;
    const sorted = this.along.slice(0, m).sort();
    const length = sorted[Math.floor(m * 0.98)];
    // Does the far end touch the edge of the picture?
    let endInFrame = true;
    for (let i = bestStart; i < bestEnd && endInFrame; i++) {
      const p = stack[i];
      const x = p % mw, y = (p - x) / mw;
      if (x > 1 && y > 1 && x < mw - 2 && y < mh - 2) continue;
      const t = ((x + 0.5) * sx - ax) * ux + ((y + 0.5) * sy - ay) * uy;
      if (t > length * 0.85) endInFrame = false;
    }
    const bins: number[][] = [[], [], [], [], [], [], [], []];
    for (let i = 0; i < m; i++) {
      const k = Math.min(7, Math.floor((this.along[i] / Math.max(1, length)) * 8));
      bins[k].push(this.across[i]);
    }
    const widths = bins.map((values) => {
      if (values.length < 6) return 0;
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length * 0.96)] - values[Math.floor(values.length * 0.04)];
    });
    const pick = (a: number, b: number) => (widths[a] && widths[b] ? (widths[a] + widths[b]) / 2 : widths[a] || widths[b]);
    const midWidth = pick(3, 4);
    // Less than about 10 cm of forearm in view (an arm leaving, a hand on its own) is not enough to dress.
    if (midWidth <= 0 || length < midWidth * 1.6) return null;
    const wristWidth = Math.min(midWidth * 1.3, Math.max(midWidth * 0.6, pick(0, 1) || midWidth));
    const endWidth = Math.min(midWidth * 1.5, Math.max(midWidth * 0.7, pick(6, 7) || midWidth));
    return { wx: ax, wy: ay, ux, uy, length, wristWidth, midWidth, endWidth, fromHand: fromHand && !usingPrior, pixels: n, endInFrame };
  }

  /** Flood fill over skin from a seed; pixel indices go into the stack from `start`. Returns the end. */
  private flood(mask: Uint8Array, seed: number, allowed: ((x: number, y: number) => boolean) | null, start: number): number {
    const mw = this.mw, mh = this.mh;
    const stack = this.stack, seen = this.seen;
    let end = start;
    stack[end++] = seed;
    seen[seed] = 1;
    for (let read = start; read < end; read++) {
      const p = stack[read];
      const x = p % mw, y = (p - x) / mw;
      for (let k = 0; k < 4; k++) {
        const xx = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
        const yy = k === 2 ? y - 1 : k === 3 ? y + 1 : y;
        if (xx < 0 || yy < 0 || xx >= mw || yy >= mh) continue;
        const q = yy * mw + xx;
        if (seen[q] || !mask[q]) continue;
        if (allowed && !allowed(xx, yy)) continue;
        seen[q] = 1;
        stack[end++] = q;
      }
    }
    return end;
  }

  private nearestSkin(mask: Uint8Array, cx: number, cy: number, radius: number, allowed: (x: number, y: number) => boolean): number {
    const mw = this.mw, mh = this.mh;
    let best = -1, bestD = Infinity;
    const r = Math.ceil(radius);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(mh - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(mw - 1, Math.ceil(cx + r)); x++) {
        const p = y * mw + x;
        if (!mask[p] || this.seen[p] || !allowed(x, y)) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD && d <= radius * radius) { bestD = d; best = p; }
      }
    }
    return best;
  }

  /** Both ends of a region along an axis: where they are, how wide, and whether the picture's edge cuts them. */
  private ends(start: number, end: number, mx: number, my: number, ux: number, uy: number, sx: number, sy: number) {
    const mw = this.mw, mh = this.mh;
    const ts: number[] = [];
    for (let i = start; i < end; i++) {
      const p = this.stack[i];
      const x = p % mw;
      ts.push(((x + 0.5) * sx - mx) * ux + (((p - x) / mw + 0.5) * sy - my) * uy);
    }
    const sorted = ts.slice().sort((a, b) => a - b);
    const lo = -sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const nx = -uy, ny = ux;
    const band = (lo + hi) * 0.15;
    let loMin = Infinity, loMax = -Infinity, hiMin = Infinity, hiMax = -Infinity;
    let loEdge = false, hiEdge = false;
    for (let i = start; i < end; i++) {
      const p = this.stack[i];
      const x = p % mw, y = (p - x) / mw;
      const t = ts[i - start];
      const o = ((x + 0.5) * sx - mx) * nx + ((y + 0.5) * sy - my) * ny;
      const edge = x <= 1 || y <= 1 || x >= mw - 2 || y >= mh - 2;
      if (t < -lo + band) { loMin = Math.min(loMin, o); loMax = Math.max(loMax, o); if (edge) loEdge = true; }
      if (t > hi - band) { hiMin = Math.min(hiMin, o); hiMax = Math.max(hiMax, o); if (edge) hiEdge = true; }
    }
    return { lo, hi, loWidth: loMax - loMin, hiWidth: hiMax - hiMin, loEdge, hiEdge };
  }
}

/** The forearm as Arm mode draws it: steady, with presence decided with hysteresis. */
export interface ForearmPose extends ForearmFit {
  /** Video pixels per millimetre, from the mid-forearm width. */
  pxPerMm: number;
}

/**
 * Turns per-frame fits into a pose that feels glued on: One Euro filters on every number (steady when still,
 * quick when moving), and hysteresis on presence (an arm counts as there after about 0.4 s in view, and as gone
 * only after about a second without it), so the exoskeleton never flickers on and off.
 */
export class ForearmTracker {
  enterAfter = 0.4;
  exitAfter = 1.0;
  readonly pose: ForearmPose = {
    wx: 0, wy: 0, ux: 1, uy: 0, length: 1, wristWidth: 1, midWidth: 1, endWidth: 1, fromHand: false, pixels: 0, pxPerMm: 1, endInFrame: true,
  };
  /** The arm is there (with hysteresis). */
  present = false;
  /** Seconds of steady detection so far (until it counts as present). */
  seenFor = 0;
  missingFor = 99;
  private hasPose = false;
  private angle = 0;
  private sinceHand = 99;
  private fx = new OneEuro(1.4, 0.03, 1);
  private fy = new OneEuro(1.4, 0.03, 1);
  private fa = new OneEuro(1.1, 0.5, 1);
  private fl = new OneEuro(0.8, 0.01, 1);
  private fw0 = new OneEuro(0.6, 0.004, 1);
  private fw1 = new OneEuro(0.6, 0.004, 1);
  private fw2 = new OneEuro(0.6, 0.004, 1);

  reset(): void {
    this.present = false;
    this.seenFor = 0;
    this.missingFor = 99;
    this.hasPose = false;
    this.sinceHand = 99;
    for (const f of [this.fx, this.fy, this.fa, this.fl, this.fw0, this.fw1, this.fw2]) f.reset();
  }

  update(fit: ForearmFit | null, dt: number): void {
    this.sinceHand = fit && fit.fromHand ? 0 : this.sinceHand + dt;
    // While tracking, a fit that no hand vouches for must agree with the pose: same width and direction,
    // give or take. That turns away a hand on its own, or a sleeve, as the arm leaves the picture.
    if (fit && !fit.fromHand && this.present) {
      const pose = this.pose;
      const widthOff = Math.abs(fit.midWidth - pose.midWidth) / Math.max(1, pose.midWidth);
      const turn = Math.acos(clampUnit(fit.ux * pose.ux + fit.uy * pose.uy));
      if (widthOff > 0.3 || turn > 0.55) fit = null;
    }
    if (!fit) {
      this.missingFor += dt;
      this.seenFor = Math.max(0, this.seenFor - dt * 2);
      if (this.present && this.missingFor >= this.exitAfter) this.present = false;
      return;
    }
    const pose = this.pose;
    let angle = Math.atan2(fit.uy, fit.ux);
    if (this.hasPose) {
      while (angle - this.angle > Math.PI) angle -= 2 * Math.PI;
      while (angle - this.angle < -Math.PI) angle += 2 * Math.PI;
    }
    // Coming back after a gap, or turned right round: start the filters again from here.
    const fresh = !this.hasPose || this.missingFor > 0.6 || Math.abs(angle - this.angle) > 1.2;
    if (fresh) {
      for (const f of [this.fx, this.fy, this.fa, this.fl, this.fw0, this.fw1, this.fw2]) f.reset();
      angle = Math.atan2(fit.uy, fit.ux);
    }
    this.missingFor = 0;
    this.seenFor += dt;
    if (!this.present && this.seenFor >= this.enterAfter) this.present = true;

    pose.wx = this.fx.filter(fit.wx, dt);
    pose.wy = this.fy.filter(fit.wy, dt);
    this.angle = this.fa.filter(angle, dt);
    pose.ux = Math.cos(this.angle);
    pose.uy = Math.sin(this.angle);
    pose.length = this.fl.filter(fit.length, dt);
    // Widths measured on an arm that is half out of the picture are not to be trusted: keep the last ones.
    const partial = this.present && !fit.endInFrame && fit.length < pose.midWidth * 2.6;
    if (!partial || fresh) {
      pose.wristWidth = this.fw0.filter(fit.wristWidth, dt);
      pose.midWidth = this.fw1.filter(fit.midWidth, dt);
      pose.endWidth = this.fw2.filter(fit.endWidth, dt);
    }
    pose.fromHand = fit.fromHand;
    pose.endInFrame = fit.endInFrame;
    pose.pixels = fit.pixels;
    pose.pxPerMm = Math.max(0.2, pose.midWidth / FOREARM_WIDTH_MM);
    this.hasPose = true;
  }

  /** The pose to anchor the next fit to, while an arm is being tracked (null once it has been gone a while). */
  get prior(): ForearmFit | null {
    return this.hasPose && this.missingFor < 0.8 ? this.pose : null;
  }

  /** The last wrist may stand in for the hand only briefly: a hand that stays lost means the arm is going. */
  get anchorOnPrior(): boolean {
    return this.sinceHand < 0.6;
  }

  /** Width of the forearm (px) at a fraction of its visible length from the wrist. */
  widthAt(f: number): number {
    const p = this.pose;
    return f < 0.5 ? p.wristWidth + (p.midWidth - p.wristWidth) * (f / 0.5) : p.midWidth + (p.endWidth - p.midWidth) * ((f - 0.5) / 0.5);
  }
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
