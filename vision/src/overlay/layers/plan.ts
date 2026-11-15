import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { clamp, pop } from '../../core/dom';
import { PROCEDURE, sutureOffsetMm } from '../../procedure/data';
import { C, circle, dot, glow, polyline, quantity, segment, text, type RGB } from '../draw';
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
        const scale = this.presence.isOn ? Math.max(0, pop(t - (this.presence.since + 0.1 + i * 0.17))) : 1;
        glow(ctx, circle(ex, ey, ringRadius * scale), color, { width: 1.5, alpha: alpha * (isActive ? 0.4 : 1), bloom: 0.8 });
        glow(ctx, circle(xx, xy, ringRadius * scale), color, { width: 1.5, alpha: alpha * (isActive ? 0.4 : 0.85), bloom: 0.8 });
        dot(ctx, ex, ey, ringRadius * 0.28, color, alpha * (isActive ? 0.4 : 1), 0);
      }

      if (isCurrent) {
        // "Here next": the entry point is where the needle goes. A reticle turns slowly around it and a
        // pulse spreads from it. Both stay on the near side, clear of the danger zone.
        const phase = (t % 1.5) / 1.5;
        const reticle = ringRadius * 2.1;
        glow(ctx, circle(ex, ey, reticle * (1 + phase * 0.75)), C.amber, {
          width: 1.4, alpha: alpha * (1 - phase) * 0.8, bloom: 1.1, halo: 0.25,
        });
        const unit = (Math.PI * 2 * reticle) / 8;
        glow(ctx, circle(ex, ey, reticle), C.amber, {
          width: 1.5, alpha: alpha * 0.95, bloom: 0.9, halo: 0.3, dash: [unit * 0.62, unit * 0.38], dashOffset: -t * unit * 0.9, cap: 'butt',
        });
      }

      // The number, on the near side, beyond the entry point: on a plate when the sutures are far enough
      // apart on screen for the plates not to touch.
      const [nx, ny] = w.point(along, -(biteMm + 4.6));
      text(ctx, String(i + 1), nx, ny, {
        size: numberSize, color: isDone ? C.green : isCurrent || isActive ? C.amber : C.white, alpha, weight: 700, tracking: 0,
        plate: spacingMm * px > 52 ? 1 : 0,
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
      const [lx, ly] = w.point((first + sutureOffsetMm(1)) / 2, across - 4.2);
      quantity(ctx, String(spacingMm), 'mm', lx, ly, { size: clamp(2.8 * px, 14, 19), alpha: labelAlpha });

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
      // Clear of its own bracket: the label's right edge stops short of it.
      const biteSize = clamp(2.8 * px, 14, 19);
      const biteAlpha = rulerOn * this.ruler.part(t, 1.6, 0.5);
      const [bx0, by0] = w.point(biteAlong - 1.6, -biteMm / 2);
      const wide = quantity(ctx, String(biteMm), 'mm', -9999, -9999, { size: biteSize, alpha: 0 });
      const away = wide / 2 + 6;
      quantity(ctx, String(biteMm), 'mm', bx0 - Math.cos(w.angle) * away, by0 - Math.sin(w.angle) * away, { size: biteSize, alpha: biteAlpha });
    }
  }
}
