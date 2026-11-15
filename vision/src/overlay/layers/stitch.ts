import type { Scene } from '../../app/scene';
import { clamp, ease, lerp, pop, progress } from '../../core/dom';
import { PROCEDURE, sutureOffsetMm } from '../../procedure/data';
import { STITCH_SECONDS } from '../../procedure/machine';
import { C, check, circle, dot, glow, mix, polyline, text, type RGB } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/** How far the needle's circular path is "opened up" on screen, as if seen a little from the side. */
const TILT = 0.5;
/** Arc of the path the needle covers, in radians (a 3/8-circle suture needle, more or less). */
const NEEDLE_SPAN = Math.PI * 0.62;

/**
 * One stitch, animated: the target tightens, a curved needle swings in at the entry point, passes under the
 * wound (drawn fainter there) and out at the exit, drawing the thread behind it; the loop is pulled flat,
 * the knot pops, and the suture turns green with a burst and a check mark.
 *
 * The needle really moves on a circle through the entry and exit points, centred on the wound, which is how
 * a curved needle is driven. From above that circle would be a straight line, so it is drawn opened into an
 * ellipse, the way a ring looks when you see it at an angle.
 */
export class StitchLayer implements Layer {
  /** App time each suture was completed (for the burst and the check mark), or -1. */
  private doneAt: number[] = [];
  private now = 0;

  constructor(private scene: Scene) {
    scene.procedure.on((event) => {
      if (event.type === 'stitch-done') this.doneAt[event.index] = this.now;
      if (event.type === 'reset') this.doneAt = [];
      if (event.type === 'step' && this.scene.procedure.stitchesDone === 0) this.doneAt = [];
    });
  }

  draw(frame: Frame): void {
    const { ctx, t, view } = frame;
    this.now = t;
    const { tracker, procedure, settings, hidden } = this.scene;
    const pose = tracker.pose;
    const step = procedure.step.id;
    if (hidden || pose.confidence <= 0.003) return;
    if (step !== 'stitch' && step !== 'complete') return;

    const w = new WoundSpace(pose, view, settings.acrossScale);
    const { biteMm, count } = PROCEDURE.sutures;
    const px = w.scale;
    const conf = pose.confidence;

    // Check marks over the sutures already placed, and the burst for the latest.
    for (let i = 0; i < Math.min(procedure.stitchesDone, count); i++) {
      const along = sutureOffsetMm(i);
      const since = this.doneAt[i] === undefined ? 10 : t - this.doneAt[i];
      const [kx, ky] = w.point(along, biteMm + 4.4);
      check(ctx, kx, ky, clamp(2.6 * px, 9, 16), C.green, conf, ease.outCubic(progress(since, 0.1, 0.4)));
      if (since < 0.9) this.burst(frame, w, along, since / 0.9, conf);
      if (i > 0 && step === 'stitch') this.spacing(frame, w, i, since, conf);
    }

    const run = procedure.stitch;
    if (!run) return;
    const time = t - run.startedAt;
    const along = sutureOffsetMm(run.index);

    // The path: across runs entry (-bite) to exit (+bite); the "depth" of the circle is opened along the wound.
    const tie = ease.inOutCubic(progress(time, STITCH_SECONDS - 0.62, 0.4)); // the loop being pulled flat
    const tilt = TILT * (1 - tie);
    const onPath = (phi: number): [number, number] => [along - Math.sin(phi) * tilt * biteMm, -Math.cos(phi) * biteMm];
    const pathPoints = (from: number, to: number, steps: number): number[] => {
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i <= steps; i++) pairs.push(onPath(lerp(from, to, i / steps)));
      return w.points(pairs);
    };

    // 1. Engage: the target ring tightens onto the suture.
    const engage = ease.outCubic(progress(time, 0, 0.32));
    const [cx, cy] = w.point(along, 0);
    const ringFade = 1 - progress(time, 0.5, 0.5);
    glow(ctx, circle(cx, cy, lerp(biteMm + 8, biteMm + 1.6, engage) * px), mix(C.amber, C.white, engage * 0.6), {
      width: 1.5, alpha: conf * engage * ringFade, bloom: 1.1, halo: 0.3,
    });

    // 2. Drive: the needle's tip travels from above the entry point, under the wound, and out past the exit.
    const drive = ease.inOutCubic(progress(time, 0.2, 1.05));
    const tip = lerp(-0.42 * Math.PI, Math.PI + NEEDLE_SPAN + 0.12, drive);
    const tail = tip - NEEDLE_SPAN;
    const needleAlpha = conf * ease.outCubic(progress(time, 0.05, 0.25)) * (1 - progress(time, 1.22, 0.3));

    // 3. Thread: laid down behind the needle, entry to wherever the needle's tail has reached.
    const threadTo = clamp(tail, 0, Math.PI);
    if (threadTo > 0.02) {
      const bright = 0.5 + 0.5 * tie;
      glow(ctx, polyline(pathPoints(0, threadTo, 18)), C.white, {
        width: lerp(1.3, 2, tie), alpha: conf * bright, bloom: 0.6 + 0.4 * tie, dash: tie > 0.5 ? [] : [2.5, 3],
      });
    }
    // The free end of the thread still trailing the needle above the skin.
    if (tail > Math.PI && needleAlpha > 0.01) {
      glow(ctx, polyline(pathPoints(Math.PI, tail, 8)), C.white, { width: 1.1, alpha: needleAlpha * 0.7, bloom: 0.4 });
    }

    if (needleAlpha > 0.01) {
      // Under the skin the needle is fainter; above it, bright steel.
      const underFrom = clamp(tail, 0, Math.PI);
      const underTo = clamp(tip, 0, Math.PI);
      if (tail < 0) glow(ctx, polyline(pathPoints(tail, Math.min(tip, 0), 8)), C.white, { width: 2.4, alpha: needleAlpha, bloom: 1.2 });
      if (underTo > underFrom) glow(ctx, polyline(pathPoints(underFrom, underTo, 10)), C.white, { width: 1.7, alpha: needleAlpha * 0.55, bloom: 0.7 });
      if (tip > Math.PI) glow(ctx, polyline(pathPoints(Math.max(tail, Math.PI), tip, 8)), C.white, { width: 2.4, alpha: needleAlpha, bloom: 1.2 });
      const [tx, ty] = w.point(...onPath(tip));
      dot(ctx, tx, ty, 2.1, C.white, needleAlpha);

      // A flash where the needle pierces the skin, going in and coming out.
      for (const [phi, at] of [[0, 0], [Math.PI, Math.PI]] as Array<[number, number]>) {
        const near = 1 - clamp(Math.abs(tip - at) / 0.5, 0, 1);
        if (near > 0.01) {
          const [fx, fy] = w.point(...onPath(phi));
          glow(ctx, circle(fx, fy, (1.4 + near * 2.2) * px * 0.6 + 3), C.white, { width: 1.3, alpha: needleAlpha * near, bloom: 1.2, halo: 0 });
        }
      }
    }

    // 4. The knot pops as the loop comes tight.
    const knot = pop(time - (STITCH_SECONDS - 0.34));
    if (knot > 0.01) {
      const [kx, ky] = w.point(along, biteMm);
      dot(ctx, kx, ky, clamp(1.25 * px, 3.2, 9) * 0.62 * knot, C.white, conf);
    }
  }

  /**
   * The measured gap between a suture and the one before it: a dimension line on the near side that draws
   * itself as the suture is confirmed, with the number counting up to the measurement.
   */
  private spacing(frame: Frame, w: WoundSpace, index: number, since: number, conf: number): void {
    const { ctx } = frame;
    const { biteMm, measuredSpacingMm, spacingMm } = PROCEDURE.sutures;
    const px = w.scale;
    const measured = measuredSpacingMm[index] > 0 ? measuredSpacingMm[index] : spacingMm;
    // Only when there is room for the number between two sutures.
    if (spacingMm * px < 46) return;
    const across = -(biteMm + 9.2);
    const from = sutureOffsetMm(index - 1);
    const to = sutureOffsetMm(index);
    const drawn = ease.outCubic(progress(since, 0.15, 0.45));
    if (drawn <= 0.003) return;
    const [ax, ay] = w.point(from, across);
    const [bx, by] = w.point(to, across);
    glow(ctx, polyline([ax, ay, bx, by]), C.green, { width: 1.2, alpha: conf * 0.9, bloom: 0.5, reveal: drawn, length: Math.hypot(bx - ax, by - ay) });
    for (const end of [from, to]) {
      glow(ctx, polyline(w.points([[end, across - 1.2], [end, across + 1.2]])), C.green, { width: 1.2, alpha: conf * drawn, bloom: 0.5 });
    }
    const counted = measured * ease.outQuart(progress(since, 0.25, 0.7));
    const [tx, ty] = w.point((from + to) / 2, across - 3.2);
    text(ctx, counted.toFixed(1), tx, ty, { size: clamp(1.9 * px, 11, 14), color: C.green, alpha: conf * drawn, weight: 600, tracking: 0 });
  }

  /** The moment a suture is confirmed: a ring and sparks thrown outward. */
  private burst(frame: Frame, w: WoundSpace, along: number, p: number, conf: number): void {
    const { ctx } = frame;
    const { biteMm } = PROCEDURE.sutures;
    const px = w.scale;
    const [cx, cy] = w.point(along, 0);
    const out = ease.outCubic(p);
    const fade = (1 - p) * (1 - p);
    const color: RGB = C.green;

    glow(ctx, circle(cx, cy, (biteMm + 1.5 + out * 12) * px), color, { width: 1.8, alpha: conf * fade, bloom: 1.4, halo: 0.2 });
    glow(ctx, circle(cx, cy, (biteMm + 1 + out * 5) * px), C.white, { width: 1, alpha: conf * fade * 0.7, bloom: 0.8, halo: 0 });

    const sparks = 12;
    for (let i = 0; i < sparks; i++) {
      const angle = (i / sparks) * Math.PI * 2 + 0.26;
      const r1 = (biteMm + 3 + out * 9) * px;
      const r2 = r1 + (1 - p) * 4.2 * px;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      glow(ctx, polyline([cx + c * r1, cy + s * r1, cx + c * r2, cy + s * r2]), i % 2 ? color : C.white, {
        width: 1.4, alpha: conf * fade, bloom: 0.9, halo: 0,
      });
    }
  }
}
