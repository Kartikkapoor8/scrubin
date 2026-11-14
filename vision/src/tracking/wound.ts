import { clamp } from '../core/dom';
import { OneEuro } from './filters';

/** What colour the marker "wound" is, and how long the line really is. Saved between sessions. */
export interface MarkerSettings {
  /** Centre hue in degrees (0 red, 120 green, 240 blue). */
  hue: number;
  /** Accepted hue distance either side, in degrees. */
  hueTolerance: number;
  /** Minimum saturation, 0..1. Marker ink is far more saturated than skin. */
  minSaturation: number;
  /** Minimum brightness, 0..1. */
  minValue: number;
  /** Real length of the drawn line in millimetres: this is what turns pixels into millimetres. */
  lengthMm: number;
}

export const MARKER_PRESETS: Record<string, MarkerSettings> = {
  green: { hue: 128, hueTolerance: 34, minSaturation: 0.42, minValue: 0.3, lengthMm: 42 },
  magenta: { hue: 318, hueTolerance: 26, minSaturation: 0.42, minValue: 0.3, lengthMm: 42 },
  blue: { hue: 222, hueTolerance: 26, minSaturation: 0.45, minValue: 0.25, lengthMm: 42 },
  orange: { hue: 24, hueTolerance: 14, minSaturation: 0.62, minValue: 0.45, lengthMm: 42 },
};

const STORAGE_KEY = 'viper.marker.v1';

export function loadMarker(): MarkerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved.hue === 'number') return { ...MARKER_PRESETS.green, ...saved };
  } catch { /* fall through to the default */ }
  return { ...MARKER_PRESETS.green };
}

export function saveMarker(settings: MarkerSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode: not saved */ }
}

/** One frame's raw finding, in video pixels. */
export interface WoundObservation {
  found: boolean;
  cx: number;
  cy: number;
  /** Angle of the line in radians, in (-pi/2, pi/2]. A line has no direction; the tracker gives it one. */
  angle: number;
  length: number;
  thickness: number;
  /** 0..1: how line-like and how substantial the marker blob is. */
  quality: number;
}

/**
 * Finds the marker line in a video frame: keep the pixels close to the marker's colour, take the most
 * line-like connected blob (preferring the one near where the wound was last seen), and fit a line to it.
 */
export class WoundDetector {
  /** Width the frame is analysed at. 960 keeps a 3 to 4 pixel marker line intact; lowered if the Mac is slow. */
  analysisWidth = 960;
  /** Milliseconds the last analysis took (shown in the debug view). */
  lastMs = 0;
  /** Number of marker-coloured pixels in the last frame (debug view). */
  lastMaskCount = 0;

  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false })!;
  private mask = new Uint8Array(0);
  private stack = new Int32Array(0);
  private width = 0;
  private height = 0;
  private slowFrames = 0;

  /** The colour mask of the last frame, for the debug view: 0 = not marker, 1 = marker, 2 = the chosen blob. */
  get debugMask(): { data: Uint8Array; width: number; height: number } {
    return { data: this.mask, width: this.width, height: this.height };
  }

  /** Average colour of a small patch of the frame (for picking the marker colour with a click), as HSV. */
  sample(video: HTMLVideoElement, videoX: number, videoY: number): { h: number; s: number; v: number } | null {
    if (!video.videoWidth) return null;
    const size = 7;
    const probe = document.createElement('canvas');
    probe.width = probe.height = size;
    const pctx = probe.getContext('2d', { willReadFrequently: true })!;
    pctx.drawImage(video, videoX - size / 2, videoY - size / 2, size, size, 0, 0, size, size);
    const data = pctx.getImageData(0, 0, size, size).data;
    // The most saturated third of the patch: a click is rarely dead centre on a thin line.
    const pixels: Array<{ h: number; s: number; v: number }> = [];
    for (let i = 0; i < data.length; i += 4) pixels.push(rgbToHsv(data[i], data[i + 1], data[i + 2]));
    pixels.sort((a, b) => b.s * b.v - a.s * a.v);
    const top = pixels.slice(0, Math.max(3, Math.floor(pixels.length / 3)));
    let x = 0, y = 0, s = 0, v = 0;
    for (const p of top) {
      x += Math.cos((p.h * Math.PI) / 180);
      y += Math.sin((p.h * Math.PI) / 180);
      s += p.s;
      v += p.v;
    }
    const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    return { h, s: s / top.length, v: v / top.length };
  }

  analyze(video: HTMLVideoElement, marker: MarkerSettings, near: { x: number; y: number } | null): WoundObservation {
    const none: WoundObservation = { found: false, cx: 0, cy: 0, angle: 0, length: 0, thickness: 0, quality: 0 };
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return none;

    const started = performance.now();
    const w = Math.min(this.analysisWidth, vw);
    const h = Math.max(2, Math.round((w * vh) / vw));
    if (w !== this.width || h !== this.height) {
      this.width = this.canvas.width = w;
      this.height = this.canvas.height = h;
      this.mask = new Uint8Array(w * h);
      this.stack = new Int32Array(w * h);
    }

    let data: Uint8ClampedArray;
    try {
      this.ctx.drawImage(video, 0, 0, w, h);
      data = this.ctx.getImageData(0, 0, w, h).data;
    } catch {
      return none; // frame not readable yet
    }

    // 1. Colour mask.
    const mask = this.mask;
    const hue = marker.hue;
    const tolerance = marker.hueTolerance;
    const minSat = marker.minSaturation;
    const minMax = marker.minValue * 255;
    let maskCount = 0;
    for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (max < minMax) { mask[p] = 0; continue; }
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      const delta = max - min;
      if (delta < minSat * max) { mask[p] = 0; continue; }
      let hh: number;
      if (max === r) hh = ((g - b) / delta) * 60;
      else if (max === g) hh = ((b - r) / delta) * 60 + 120;
      else hh = ((r - g) / delta) * 60 + 240;
      if (hh < 0) hh += 360;
      let d = hh - hue;
      if (d < 0) d = -d;
      if (d > 180) d = 360 - d;
      if (d <= tolerance) { mask[p] = 1; maskCount++; } else mask[p] = 0;
    }
    this.lastMaskCount = maskCount;

    // 2. Connected blobs; score each one by how much it looks like a drawn line.
    const scale = vw / w;
    const nearX = near ? near.x / scale : 0;
    const nearY = near ? near.y / scale : 0;
    const minPixels = Math.max(10, Math.round((w / 960) * (w / 960) * 26));
    const maxPixels = Math.round(mask.length * 0.012);
    const maxThickness = h * 0.035;
    const stack = this.stack;
    let best: { score: number; n: number; mx: number; my: number; angle: number; l1: number; l2: number; start: number; end: number } | null = null;
    let cursor = 0; // blobs' pixel indices are kept back to back in `stack`

    for (let seed = 0; seed < mask.length; seed++) {
      if (mask[seed] !== 1) continue;
      const start = cursor;
      let end = cursor;
      stack[end++] = seed;
      mask[seed] = 3; // visited
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let read = start; read < end; read++) {
        const p = stack[read];
        const x = p % w;
        const y = (p - x) / w;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        // 8-connected, and bridging one-pixel gaps so a hologram line crossing the marker does not split it
        for (let oy = -2; oy <= 2; oy++) {
          const yy = y + oy;
          if (yy < 0 || yy >= h) continue;
          for (let ox = -2; ox <= 2; ox++) {
            const xx = x + ox;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (mask[q] === 1) { mask[q] = 3; stack[end++] = q; }
          }
        }
      }
      cursor = end;
      if (n < minPixels) continue;
      // A drawn line is a small thing. A big patch of the marker's colour (a drape, a sleeve) is not it.
      if (n > maxPixels) continue;

      const mx = sx / n;
      const my = sy / n;
      const cxx = sxx / n - mx * mx;
      const cyy = syy / n - my * my;
      const cxy = sxy / n - mx * my;
      const spread = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
      const l1 = (cxx + cyy) / 2 + spread; // variance along the blob
      const l2 = Math.max(1e-3, (cxx + cyy) / 2 - spread); // variance across it
      const elongation = Math.sqrt(l1 / l2);
      if (elongation < 2.2) continue; // not a line
      if (Math.sqrt(12 * l2) > maxThickness) continue; // far too thick to be a marker stroke

      let score = n * Math.min(elongation, 12);
      if (near) {
        const dist2 = (mx - nearX) ** 2 + (my - nearY) ** 2;
        const sigma = w * 0.09;
        score *= 1 + 3 * Math.exp(-dist2 / (2 * sigma * sigma));
      }
      if (!best || score > best.score) {
        best = { score, n, mx, my, angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy), l1, l2, start, end };
      }
    }

    if (!best) {
      this.finish(started);
      return none;
    }

    // 3. Fit: direction from the blob's spread, extent from its farthest pixels along that direction.
    const dx = Math.cos(best.angle);
    const dy = Math.sin(best.angle);
    let lo = Infinity, hi = -Infinity;
    for (let i = best.start; i < best.end; i++) {
      const p = stack[i];
      const x = p % w;
      const y = (p - x) / w;
      const along = (x - best.mx) * dx + (y - best.my) * dy;
      if (along < lo) lo = along;
      if (along > hi) hi = along;
      mask[p] = 2;
    }
    const mid = (lo + hi) / 2;
    const length = hi - lo + 1;
    const thickness = Math.max(1, Math.sqrt(12 * best.l2));
    const elongation = Math.sqrt(best.l1 / best.l2);
    const quality = clamp((elongation - 2.2) / 5, 0, 1) * clamp(best.n / (minPixels * 3), 0, 1);

    this.finish(started);
    return {
      found: length * scale > 14,
      cx: (best.mx + dx * mid + 0.5) * scale,
      cy: (best.my + dy * mid + 0.5) * scale,
      angle: best.angle,
      length: length * scale,
      thickness: thickness * scale,
      quality,
    };
  }

  private finish(started: number): void {
    this.lastMs = performance.now() - started;
    // If analysis is eating the frame budget, look at fewer pixels. Never climbs back up mid-show.
    if (this.lastMs > 11) this.slowFrames++;
    else if (this.slowFrames > 0) this.slowFrames--;
    if (this.slowFrames > 20 && this.analysisWidth > 640) {
      this.analysisWidth = 640;
      this.slowFrames = 0;
    }
  }
}

/** The wound as the overlays use it: steady, with a direction, and with a confidence that fades in and out. */
export interface WoundPose {
  /** Centre of the wound in video pixels. */
  cx: number;
  cy: number;
  /** Unit vector along the wound, from its first end to its last. */
  dx: number;
  dy: number;
  /** Unit vector across the wound, pointing to the far (thumb) side. */
  sx: number;
  sy: number;
  /** Length of the wound in video pixels. */
  length: number;
  /** Video pixels per millimetre. */
  pxPerMm: number;
  /** 0..1, eased. Overlays multiply their brightness by this, so nothing pops when tracking comes or goes. */
  confidence: number;
  /** True once the wound has been found steadily. */
  locked: boolean;
  /** Seconds since the last frame in which the marker was actually seen. */
  staleFor: number;
}

/**
 * Turns per-frame observations into a steady pose. Holds the last pose through short dropouts (a hand
 * passing over the marker), then lets confidence fall so overlays fade rather than stick to nothing.
 */
export class WoundTracker {
  /** Flip which end of the wound is "first" (suture 1). */
  flipAlong = false;
  /** Flip which side counts as the far (thumb) side. */
  flipSide = false;

  readonly pose: WoundPose = {
    cx: 0, cy: 0, dx: 1, dy: 0, sx: 0, sy: -1, length: 0, pxPerMm: 1, confidence: 0, locked: false, staleFor: 999,
  };

  private fx = new OneEuro(1.6, 0.012, 1);
  private fy = new OneEuro(1.6, 0.012, 1);
  private fa = new OneEuro(1.2, 0.6, 1);
  private fl = new OneEuro(0.7, 0.004, 1);
  private angle = 0;
  private hasPose = false;
  private seenFor = 0;

  get hasEverLocked(): boolean {
    return this.hasPose;
  }

  reset(): void {
    this.hasPose = false;
    this.seenFor = 0;
    this.pose.confidence = 0;
    this.pose.locked = false;
    this.pose.staleFor = 999;
    this.fx.reset(); this.fy.reset(); this.fa.reset(); this.fl.reset();
  }

  /** Where to prefer looking next frame, or null if there is nothing to go on. */
  get hint(): { x: number; y: number } | null {
    return this.hasPose && this.pose.staleFor < 2.5 ? { x: this.pose.cx, y: this.pose.cy } : null;
  }

  update(observation: WoundObservation, marker: MarkerSettings, dt: number): void {
    const pose = this.pose;

    if (observation.found && observation.quality > 0.08) {
      // A line's angle is only defined up to half a turn: pick the reading nearest to where it was.
      let angle = observation.angle;
      if (this.hasPose) {
        while (angle - this.angle > Math.PI / 2) angle -= Math.PI;
        while (angle - this.angle < -Math.PI / 2) angle += Math.PI;
      }
      // A jump (first sighting, or the marker reappearing somewhere else): start again from the new place.
      const jumped = !this.hasPose || pose.staleFor > 1.2
        || Math.hypot(observation.cx - pose.cx, observation.cy - pose.cy) > Math.max(120, pose.length * 1.5);
      if (jumped) {
        this.fx.reset(); this.fy.reset(); this.fa.reset(); this.fl.reset();
        if (!this.hasPose || pose.staleFor > 1.2) angle = observation.angle; // re-derive direction: left to right
      }

      pose.cx = this.fx.filter(observation.cx, dt);
      pose.cy = this.fy.filter(observation.cy, dt);
      this.angle = this.fa.filter(angle, dt);
      pose.length = this.fl.filter(observation.length, dt);
      pose.pxPerMm = Math.max(0.2, pose.length / Math.max(1, marker.lengthMm));
      pose.staleFor = 0;
      this.hasPose = true;
      this.seenFor += dt;
    } else {
      pose.staleFor += dt;
      this.seenFor = 0;
    }

    const sign = this.flipAlong ? -1 : 1;
    pose.dx = Math.cos(this.angle) * sign;
    pose.dy = Math.sin(this.angle) * sign;
    // Across the wound. With the wound running left to right this points up the screen: the far side of an
    // arm lying across the wearer's view, which is its thumb side.
    const side = this.flipSide ? -1 : 1;
    pose.sx = Math.sin(this.angle) * side;
    pose.sy = -Math.cos(this.angle) * side;

    // Confidence: quick to arrive once the marker has been seen for a moment, held through short dropouts,
    // then a slow fade.
    const target = this.hasPose && pose.staleFor < 0.7 && (this.seenFor > 0.12 || pose.locked) ? 1 : 0;
    const rate = target > pose.confidence ? 4.5 : 1.6;
    pose.confidence += (target - pose.confidence) * (1 - Math.exp(-rate * dt));
    if (pose.confidence < 0.002) pose.confidence = 0;
    pose.locked = pose.confidence > 0.5;
  }
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) * 60;
    else if (max === g) h = ((b - r) / delta) * 60 + 120;
    else h = ((r - g) / delta) * 60 + 240;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

/** Tightens the marker settings around a colour picked from the picture. */
export function markerFromSample(sample: { h: number; s: number; v: number }, lengthMm: number): MarkerSettings {
  return {
    hue: Math.round(sample.h),
    hueTolerance: 24,
    minSaturation: clamp(sample.s * 0.55, 0.22, 0.7),
    minValue: clamp(sample.v * 0.45, 0.15, 0.6),
    lengthMm,
  };
}
