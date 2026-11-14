import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { clamp, ease, progress } from '../../core/dom';
import { PROCEDURE, sutureOffsetMm } from '../../procedure/data';
import { C, circle, dot, glow, polyline, segment, text, type RGB } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * The suture plan, pinned to the wound: numbered targets with an entry and an exit point either side of the
 * line, the planned pass between them, a spacing ruler, and a bite dimension. During the stitch step the
 * current target pulses; placed sutures turn green. The stitch animation itself is drawn by StitchLayer.
 */
export class PlanLayer implements Layer {
  private presence = new Appear(3, 5);
  private ruler = new Appear(3, 6);

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const { tracker, procedure, settings, hidden } = this.scene;
    const pose = tracker.pose;
    const step = procedure.step.id;

    const wanted = !hidden && (step === 'plan' || step === 'stitch' || step === 'complete');
    const presence = this.presence.update(wanted, t, dt, procedure.replayedAt) * pose.confidence;
    const rulerOn = this.ruler.update(wanted && step === 'plan', t, dt, procedure.replayedAt) * pose.confidence;
    if (presence <= 0.003) return;

    const w = new WoundSpace(pose, view, settings.acrossScale);
    const { count, biteMm, spacingMm } = PROCEDURE.sutures;
    const px = w.scale;
    const ringRadius = clamp(1.25 * px, 3.2, 9);
    const numberSize = clamp(2.5 * px, 10, 17);
    const done = procedure.stitchesDone;
    const active = procedure.stitch ? procedure.stitch.index : -1;

    for (let i = 0; i < count; i++) {
      const arrive = this.presence.part(t, 0.1 + i * 0.17, 0.6);
      if (arrive <= 0.003) continue;
      const alpha = presence * arrive;
      const along = sutureOffsetMm(i);
      const [ex, ey] = w.point(along, -biteMm);
      const [xx, xy] = w.point(along, biteMm);
      const length = Math.hypot(xx - ex, xy - ey);

      const isDone = i < done;
      const isActive = i === active;
      const isCurrent = !isDone && !isActive && step === 'stitch' && i === done;
      const color: RGB = isDone ? C.green : isCurrent || isActive ? C.amber : C.cyan;

      if (isDone) {
        // A placed suture: the thread across the wound and its knot.
        glow(ctx, segment(ex, ey, xx, xy), C.green, { width: 2.1, alpha, bloom: 0.9 });
        dot(ctx, ex, ey, ringRadius * 0.42, C.green, alpha);
        const [kx, ky] = w.point(along, biteMm);
        dot(ctx, kx, ky, ringRadius * 0.62, C.green, alpha);
      } else {
        // The planned pass, traced on from the entry point, and the two points themselves.
        glow(ctx, segment(ex, ey, xx, xy), color, {
          width: 1.2, alpha: alpha * (isActive ? 0.35 : 0.8), bloom: 0.5, dash: [3, 4.5], reveal: arrive, length,
        });
        const pop = ease.outBack(progress(t, this.presence.since + 0.1 + i * 0.17, 0.5));
        const scale = this.presence.isOn ? Math.max(0, pop) : 1;
        glow(ctx, circle(ex, ey, ringRadius * scale), color, { width: 1.5, alpha: alpha * (isActive ? 0.4 : 1), bloom: 0.8 });
        glow(ctx, circle(xx, xy, ringRadius * scale), color, { width: 1.5, alpha: alpha * (isActive ? 0.4 : 0.85), bloom: 0.8 });
        dot(ctx, ex, ey, ringRadius * 0.28, color, alpha * (isActive ? 0.4 : 1), 0);
      }

      if (isCurrent) {
        // "Here next": a slow pulse spreading from the target.
        const phase = (t % 1.5) / 1.5;
        const [cx, cy] = w.point(along, 0);
        glow(ctx, circle(cx, cy, (biteMm + 2 + phase * 5) * px), C.amber, {
          width: 1.4, alpha: alpha * (1 - phase) * 0.8, bloom: 1.1, halo: 0.25,
        });
        glow(ctx, circle(cx, cy, (biteMm + 2) * px), C.amber, { width: 1.2, alpha: alpha * 0.5, bloom: 0.6, halo: 0.25 });
      }

      // The number, on the near side, beyond the entry point.
      const [nx, ny] = w.point(along, -(biteMm + 4.6));
      text(ctx, String(i + 1), nx, ny, {
        size: numberSize, color: isDone ? C.green : isCurrent || isActive ? C.amber : C.white, alpha, weight: 700, tracking: 0,
      });
    }

    // Spacing ruler on the near side, below the numbers (the far side belongs to the danger zone): a tick
    // under every suture and the distance between neighbours.
    if (rulerOn > 0.003) {
      const across = -(biteMm + 9.4);
      const first = sutureOffsetMm(0);
      const last = sutureOffsetMm(count - 1);
      const draw = this.ruler.part(t, 0.9, 0.7);
      const [ax, ay] = w.point(first, across);
      const [bx, by] = w.point(last, across);
      glow(ctx, segment(ax, ay, bx, by), C.cyan, {
        width: 1.1, alpha: rulerOn * 0.85, bloom: 0.5, reveal: draw, length: Math.hypot(bx - ax, by - ay),
      });
      for (let i = 0; i < count; i++) {
        const tick = this.ruler.part(t, 1.0 + i * 0.09, 0.35);
        const along = sutureOffsetMm(i);
        glow(ctx, polyline(w.points([[along, across - 1.3], [along, across + 1.3]])), C.cyan, {
          width: 1.1, alpha: rulerOn * tick, bloom: 0.5,
        });
      }
      const labelAlpha = rulerOn * this.ruler.part(t, 1.5, 0.5);
      const [lx, ly] = w.point((first + sutureOffsetMm(1)) / 2, across - 3.6);
      text(ctx, `${spacingMm} mm`, lx, ly, { size: clamp(2.3 * px, 10, 14), color: C.cyan, alpha: labelAlpha, weight: 600 });

      // Bite: how far from the wound edge the needle goes in, shown once, beside the first suture.
      const biteAlong = first - 4.4;
      const biteDraw = this.ruler.part(t, 1.3, 0.5);
      glow(ctx, polyline(w.points([[biteAlong, 0], [biteAlong, -biteMm]])), C.cyan, {
        width: 1.1, alpha: rulerOn * 0.85 * biteDraw, bloom: 0.5,
      });
      for (const c of [0, -biteMm]) {
        glow(ctx, polyline(w.points([[biteAlong - 1.1, c], [biteAlong + 1.1, c]])), C.cyan, {
          width: 1.1, alpha: rulerOn * biteDraw, bloom: 0.5,
        });
      }
      const [tx, ty] = w.point(biteAlong - 5.4, -biteMm / 2);
      text(ctx, `${biteMm} mm`, tx, ty, { size: clamp(2.3 * px, 10, 14), color: C.cyan, alpha: rulerOn * this.ruler.part(t, 1.6, 0.5), weight: 600 });
    }
  }
}
