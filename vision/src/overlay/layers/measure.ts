import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { clamp, progress } from '../../core/dom';
import { PROCEDURE } from '../../procedure/data';
import { C, dot, glow, polyline, text, textHeight, measure, plate, quantity } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * Assessing the wound: extension lines from both ends of the laceration, a dimension line between them with
 * its length counting up in millimetres, and a short description on a leader.
 */
export class MeasureLayer implements Layer {
  private presence = new Appear(3, 5);

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const { procedure, tracker, settings, hidden, marker } = this.scene;
    const pose = tracker.pose;
    const on = !hidden && procedure.step.id === 'assess';
    const presence = this.presence.update(on, t, dt, procedure.replayedAt) * pose.confidence;
    if (presence <= 0.003) return;

    const w = new WoundSpace(pose, view, settings.acrossScale);
    const half = w.half;
    const px = w.scale;
    const offset = 9.5; // how far the dimension line sits from the wound, on the near side
    const p = (delay: number, duration: number) => this.presence.part(t, delay, duration);

    // Extension lines out from each end of the wound.
    for (const end of [-half, half]) {
      const reveal = p(0.15, 0.45);
      const points = w.points([[end, -2.2], [end, -(offset + 2)]]);
      glow(ctx, polyline(points), C.cyan, {
        width: 1.1, alpha: presence * 0.9, bloom: 0.5, reveal,
        length: Math.hypot(points[2] - points[0], points[3] - points[1]),
      });
    }

    // The dimension line grows from the middle outward, with a slash at each end.
    const grow = p(0.45, 0.7);
    if (grow > 0) {
      glow(ctx, polyline(w.points([[-half * grow, -offset], [half * grow, -offset]])), C.cyan, {
        width: 1.3, alpha: presence, bloom: 0.7,
      });
      const tick = p(1.0, 0.3);
      for (const end of [-half, half]) {
        glow(ctx, polyline(w.points([[end - 1.2, -offset - 1.2], [end + 1.2, -offset + 1.2]])), C.cyan, {
          width: 1.4, alpha: presence * tick, bloom: 0.7,
        });
      }
    }

    // The number counts up as the line grows.
    const counted = Math.round(marker.lengthMm * clamp(progress(t, this.presence.since + 0.45, 0.9), 0, 1));
    const value = this.presence.isOn ? counted : marker.lengthMm;
    const [nx, ny] = w.point(0, -(offset + 5.2));
    quantity(ctx, String(value), 'mm', nx, ny, { size: clamp(3.6 * px, 17, 25), alpha: presence * p(0.45, 0.4) });

    // What it is, on a leader from the wound to the far side.
    const tag = p(1.2, 0.5);
    if (tag > 0) {
      const anchorAlong = half * 0.55;
      const [ax, ay] = w.point(anchorAlong, 1.2);
      const [bx, by] = w.point(anchorAlong + 7, 12);
      const [cx, cy] = w.point(anchorAlong + 13, 12);
      const points = [ax, ay, bx, by, cx, cy];
      const length = Math.hypot(bx - ax, by - ay) + Math.hypot(cx - bx, cy - by);
      glow(ctx, polyline(points), C.cyan, { width: 1.1, alpha: presence * 0.9, bloom: 0.5, reveal: tag, length });
      dot(ctx, ax, ay, 2.2, C.cyan, presence * tag);
      const labelAlpha = presence * p(1.5, 0.5);
      const size = clamp(2.6 * px, 14, 17);
      // Two lines on one plate: what it is, and where.
      const name = PROCEDURE.wound.label.toUpperCase();
      const where = `linear · ${PROCEDURE.patient.site}`;
      const nameStyle = { size, font: 'body' as const, weight: 700, tracking: 0.16 };
      const whereStyle = { size: size * 0.86, font: 'body' as const, weight: 500, tracking: 0.01 };
      const wide = Math.max(measure(ctx, name, nameStyle), measure(ctx, where, whereStyle));
      const line = textHeight(size);
      plate(ctx, cx + 8 - line * 0.42, cy - line * 1.0, cx + 8 + wide + line * 0.3, cy + line * 1.36, labelAlpha);
      text(ctx, name, cx + 8, cy - line * 0.3, { ...nameStyle, color: C.cyan, alpha: labelAlpha, align: 'left' });
      text(ctx, where, cx + 8, cy + line * 0.72, { ...whereStyle, color: C.white, alpha: labelAlpha * 0.88, align: 'left' });
    }
  }
}
