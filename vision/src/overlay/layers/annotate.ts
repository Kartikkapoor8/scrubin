import type { Scene } from '../../app/scene';
import { clamp, ease, pop, progress } from '../../core/dom';
import { C, dot, glow, measure, polyline, text, textHeight, type RGB } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * Auto-annotate: the moment a real marker line has been tracked steadily (or on key Y), a crisp white line
 * draws itself over it and the repair is labelled around it: the incision and its length, its two ends,
 * five suture points, bite, depth, technique, and the artery to keep clear of. Everything hangs off the
 * tracked line, so it follows the arm. The figures are the scripted plan, and the ones that would need
 * measuring say "est.". It works from any state and steps aside when the line is lost.
 */
export class AnnotateLayer implements Layer {
  /** Seconds of steady tracking before it fires by itself (0 = only on the key). */
  autoAfter = 3;
  /** On screen now (the procedure's own overlays step aside while it is). */
  showing = false;
  onShow: () => void = () => {};
  onClear: () => void = () => {};

  private startedAt = -1;
  private presence = 0;
  private lockedSince = -1;
  private lostSince = -1;
  private now = 0;
  /** After a clear, it does not fire by itself again until the line has been lost or re-found. */
  private armed = true;

  constructor(private scene: Scene) {}

  /** Key Y: now, whatever the state (it still needs a tracked line to hang on). */
  trigger(): void {
    this.startedAt = this.now;
    this.lostSince = -1;
    if (!this.showing) { this.showing = true; this.onShow(); }
  }

  clear(rearm = true): void {
    if (this.showing) { this.showing = false; this.onClear(); }
    this.startedAt = -1;
    this.lockedSince = -1;
    this.armed = rearm;
  }

  /** Every frame, before drawing: decides when to appear and when to go. */
  update(t: number, auto: boolean): void {
    this.now = t;
    const locked = this.scene.tracker.pose.locked;
    if (locked) {
      if (this.lockedSince < 0) this.lockedSince = t;
      this.lostSince = -1;
    } else {
      if (this.lostSince < 0) this.lostSince = t;
      // A dropout of a few frames does not restart the count.
      if (t - this.lostSince > 0.35) { this.lockedSince = -1; this.armed = true; }
    }
    if (this.showing && !locked && t - this.lostSince > 1) this.clear();
    if (!this.showing && auto && this.armed && this.autoAfter > 0 && this.lockedSince >= 0 && t - this.lockedSince >= this.autoAfter) this.trigger();
  }

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const pose = this.scene.tracker.pose;
    this.presence += ((this.showing ? 1 : 0) - this.presence) * (1 - Math.exp(-(this.showing ? 10 : 5) * dt));
    const alpha = this.presence * clamp(pose.confidence * 1.4, 0, 1);
    if (alpha <= 0.01 || this.startedAt < 0 && !this.showing && this.presence < 0.02) return;

    const w = new WoundSpace(pose, view, this.scene.settings.acrossScale);
    const age = Math.max(0, t - (this.startedAt < 0 ? t - 10 : this.startedAt));
    const half = w.half;
    const px = w.scale;
    const [ax, ay] = w.point(-half, 0);
    const [bx, by] = w.point(half, 0);
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 12) return;
    // Screen directions: along the line, and across it toward the thumb side.
    const dx = (bx - ax) / length;
    const dy = (by - ay) / length;
    const [px0, py0] = w.point(0, 0);
    const [px1, py1] = w.point(0, 10);
    const an = Math.hypot(px1 - px0, py1 - py0) || 1;
    const nx = (px1 - px0) / an;
    const ny = (py1 - py0) / an;
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;

    // 1. The white line, end to end, then its end ticks.
    const drawn = ease.inOutCubic(progress(age, 0, 0.5));
    glow(ctx, polyline([ax, ay, bx, by]), C.white, { width: 1.7, alpha, bloom: 0.45, halo: 0.7, reveal: drawn, length, cap: 'butt' });
    const tick = 7;
    for (const [ex, ey, at] of [[ax, ay, 0.05], [bx, by, 0.5]] as Array<[number, number, number]>) {
      const k = pop(age - at);
      if (k <= 0.01) continue;
      glow(ctx, polyline([ex - nx * tick * k, ey - ny * tick * k, ex + nx * tick * k, ey + ny * tick * k]), C.white, { width: 1.7, alpha, bloom: 0.4, halo: 0.6 });
    }

    // 2. Labels, one after another, each on a thin leader. Collected first, so every leader is drawn
    // under every label and none crosses another's lettering.
    const size = 12.5;
    const style = { size, font: 'body' as const, weight: 700, tracking: 0.1 };
    const row = textHeight(size) * 1.8;
    const gap = Math.max(40, 5 * px); // from the line to the first row
    const width = (words: string) => measure(ctx, words, style);
    interface Tag { words: string; ax: number; ay: number; x: number; y: number; color: RGB }
    const tags: Tag[] = [];
    const label = (words: string, anchor: [number, number], x: number, y: number, color: RGB = C.white) => {
      const wide = width(words);
      tags.push({
        words, ax: anchor[0], ay: anchor[1], color,
        x: clamp(x, wide / 2 + 18, frame.width - wide / 2 - 18), y: clamp(y, row, frame.height - row),
      });
    };
    const on = (along: number, across = 0): [number, number] => w.point(along, across);
    // A spot `rows` rows off the line on one side (1 = thumb side, -1 = near side), `shift` px along it.
    const spot = (side: number, rows: number, shift: number): [number, number] => [
      cx + side * nx * (gap + rows * row) + dx * shift, cy + side * ny * (gap + rows * row) + dy * shift,
    ];
    const beside = (words: string, sign: number) => sign * (width(words) / 2 + 22);

    // Five suture points along the line, numbered on the near side.
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) {
      const along = (i - 2) * 8;
      const [sx, sy] = on(along, 0);
      points.push([sx, sy]);
      const k = pop(age - (1.05 + i * 0.09));
      if (k <= 0.01) continue;
      dot(ctx, sx, sy, 3.2 * k, C.cyan, alpha);
      const offset = Math.max(17, 3.2 * px);
      text(ctx, String(i + 1), sx - nx * offset, sy - ny * offset, { size: 12.5, color: C.white, alpha: alpha * Math.min(1, k), weight: 700, tracking: 0, plate: length > 150 ? 1 : 0 });
    }
    // Thumb side: what it is, and (in red, a centimetre off) what to keep clear of.
    label('INCISION \u00B7 42 mm', [cx, cy], ...spot(1, 0, beside('INCISION \u00B7 42 mm', -1)));
    const artery = 'RADIAL ARTERY \u00B7 KEEP 1 cm CLEAR';
    const off = Math.max(10 * px, gap + row * 0.2);
    const arteryIn = ease.outCubic(progress(age, 1.0, 0.5));
    if (arteryIn > 0.01) {
      const reach = length * 0.62;
      glow(ctx, polyline([cx + nx * off - dx * reach, cy + ny * off - dy * reach, cx + nx * off + dx * reach, cy + ny * off + dy * reach]), C.red, {
        width: 1.6, alpha: alpha * arteryIn * 0.9, bloom: 0.7, halo: 0.5, dash: [9, 7],
      });
    }
    // Its warning sits over the middle of the dashed line (clear of the panels in the corners).
    label(artery, [cx + nx * off + dx * length * 0.2, cy + ny * off + dy * length * 0.2], cx + nx * (off + row * 0.95), cy + ny * (off + row * 0.95), C.red);
    // The ends, beyond the ends. (Along the line runs toward the elbow.)
    label('DISTAL END', [ax, ay], ax + dx * beside('DISTAL END', -1) - dx * 26, ay + dy * beside('DISTAL END', -1) - dy * 26);
    label('PROXIMAL END', [bx, by], bx + dx * beside('PROXIMAL END', 1) + dx * 26, by + dy * beside('PROXIMAL END', 1) + dy * 26);
    // Near side, two rows of two: the plan.
    const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    label('8 mm SPACING', mid(points[1], points[2]), ...spot(-1, 1, beside('8 mm SPACING', -1)));
    label('BITE 4 mm FROM EDGE', on(16, -4), ...spot(-1, 1, beside('BITE 4 mm FROM EDGE', 1)));
    label('DEPTH ~3 mm EST.', points[1], ...spot(-1, 2, beside('DEPTH ~3 mm EST.', -1)));
    const technique = 'TECHNIQUE: SIMPLE INTERRUPTED \u00D75';
    label(technique, points[3], ...spot(-1, 2, beside(technique, 1)));

    const shown = tags.map((_, i) => ease.outCubic(progress(age, 0.62 + i * 0.13, 0.34)));
    tags.forEach((tag, i) => {
      const k = shown[i];
      if (k <= 0.01) return;
      glow(ctx, polyline([tag.ax, tag.ay, tag.x, tag.y]), tag.color, { width: 1, alpha: alpha * k * 0.85, bloom: 0.25, halo: 0.5, reveal: k, length: Math.hypot(tag.x - tag.ax, tag.y - tag.ay) });
      dot(ctx, tag.ax, tag.ay, 2.4, tag.color, alpha * k);
    });
    tags.forEach((tag, i) => {
      if (shown[i] > 0.01) text(ctx, tag.words, tag.x, tag.y, { ...style, color: tag.color, alpha: alpha * shown[i], plate: 1 });
    });
  }
}
