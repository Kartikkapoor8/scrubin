import type { Scene } from '../../app/scene';
import { clamp, damp } from '../../core/dom';
import { PROCEDURE, sutureOffsetMm } from '../../procedure/data';
import { C, circle, dot, glow, mix, polyline, segment, text } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/** MediaPipe hand landmarks joined into bones: thumb, the four fingers, and across the knuckles. */
const BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];

/** How close (mm) the working fingertip must be to the current target to count as aligned. */
const ALIGNED_MM = 7;
/** Beyond this distance (mm) from the wound a hand is ignored: it is the patient's own, or just passing. */
const NEAR_MM = 90;

/**
 * The trainee's hand: a small reticle on the working fingertip, a guide line to the current target as it
 * comes close, and "ALIGNED" when it is on the target. Never required: the stitch is registered by key.
 */
export class HandLayer implements Layer {
  private presence = 0;
  private aligned = 0;
  private x = 0;
  private y = 0;
  private has = false;

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const scene = this.scene;
    const { tracker, procedure, settings, hands } = scene;
    const pose = tracker.pose;
    const step = procedure.step.id;
    const w = new WoundSpace(pose, view, settings.acrossScale);

    // The fingertip nearest the wound, if any hand is close enough to matter.
    let best: { x: number; y: number; along: number; across: number } | null = null;
    let bestPoints: Array<{ x: number; y: number }> | null = null;
    let bestDistance = NEAR_MM;
    if (pose.locked && !scene.hidden) {
      for (const hand of hands.hands) {
        const mm = w.toMm(hand.tool.x, hand.tool.y);
        const distance = Math.hypot(mm.along, mm.across);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x: hand.tool.x, y: hand.tool.y, ...mm };
          bestPoints = hand.points;
        }
      }
    }

    if (best) {
      const k = this.has ? damp(22, dt) : 1;
      this.x += (best.x - this.x) * k;
      this.y += (best.y - this.y) * k;
      this.has = true;
    }
    this.presence += ((best ? 1 : 0) - this.presence) * damp(best ? 10 : 5, dt);
    if (this.presence < 0.004) {
      this.presence = 0;
      this.has = false;
      scene.aligned = false;
      scene.toolDistanceMm = -1;
      this.aligned += (0 - this.aligned) * damp(8, dt);
      return;
    }

    // Distance to the current target (the next suture's entry point) while stitching.
    const targeting = step === 'stitch' && !procedure.stitch && procedure.stitchesDone < procedure.count;
    let distance = -1;
    let targetX = 0;
    let targetY = 0;
    if (targeting && best) {
      const along = sutureOffsetMm(procedure.stitchesDone);
      const { biteMm } = PROCEDURE.sutures;
      // On the target means on the suture's line between entry and exit, or on either point.
      const dAlong = best.along - along;
      const dAcross = Math.max(0, Math.abs(best.across) - biteMm);
      distance = Math.hypot(dAlong, dAcross);
      [targetX, targetY] = w.point(along, clamp(best.across, -biteMm, biteMm));
    }
    scene.toolDistanceMm = distance;
    scene.aligned = distance >= 0 && distance <= ALIGNED_MM;
    this.aligned += ((scene.aligned ? 1 : 0) - this.aligned) * damp(12, dt);

    const sx = view.toScreenX(this.x);
    const sy = view.toScreenY(this.y);
    const color = mix(C.white, C.green, this.aligned);
    const alpha = this.presence * pose.confidence;
    const radius = 9 + this.aligned * 2 + Math.sin(t * 5) * 0.6 * this.aligned;

    // The hand itself, lightly: the bones the tracker sees, and a dot on each fingertip.
    if (bestPoints && bestPoints.length >= 21) {
      const flat: number[] = [];
      for (const chain of BONES) {
        flat.length = 0;
        for (const index of chain) flat.push(view.toScreenX(bestPoints[index].x), view.toScreenY(bestPoints[index].y));
        glow(ctx, polyline(flat), C.cyan, { width: 1.1, alpha: alpha * 0.42, bloom: 0.4, halo: 0.3 });
      }
      for (const tip of [4, 12, 16, 20]) {
        dot(ctx, view.toScreenX(bestPoints[tip].x), view.toScreenY(bestPoints[tip].y), 1.8, C.cyan, alpha * 0.6, 0.3);
      }
    }

    // Guide line from the fingertip to the target once it is within reach.
    if (distance >= 0 && distance < 45) {
      const reach = clamp(1 - distance / 45, 0, 1);
      glow(ctx, segment(sx, sy, targetX, targetY), mix(C.cyan, C.green, this.aligned), {
        width: 1.1, alpha: alpha * reach * 0.8, dash: [2, 5], bloom: 0.5, halo: 0.3,
      });
    }

    glow(ctx, circle(sx, sy, radius), color, { width: 1.5, alpha, bloom: 0.9 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      glow(ctx, polyline([sx + c * (radius + 3), sy + s * (radius + 3), sx + c * (radius + 8), sy + s * (radius + 8)]), color, {
        width: 1.5, alpha: alpha * 0.9, bloom: 0.6,
      });
    }

    if (this.aligned > 0.02) {
      text(ctx, 'ALIGNED', sx, sy - radius - 18, { size: 15, color: C.green, alpha: alpha * this.aligned, tracking: 0.24, weight: 700 });
    } else if (distance >= 0 && distance < 60) {
      text(ctx, `${Math.round(distance)} mm`, sx, sy - radius - 16, { size: 12.5, color: C.white, alpha: alpha * 0.85, weight: 500 });
    }
  }
}
