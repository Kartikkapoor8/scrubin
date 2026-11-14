import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { ease, progress } from '../../core/dom';
import { C, glow, polyline, text } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * Shows that the wound has been found: four corner brackets that close in on the marker line the moment
 * tracking locks, then sit quietly around it. They step aside while the plan and the stitches are showing.
 */
export class WoundLockLayer implements Layer {
  private presence = new Appear(4, 5);
  private lockedAt = -1e9;
  private wasLocked = false;

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const { tracker, procedure, settings, hidden } = this.scene;
    const pose = tracker.pose;
    const step = procedure.step.id;

    if (pose.locked && !this.wasLocked) this.lockedAt = t;
    this.wasLocked = pose.locked;

    const wanted = !hidden && pose.locked && (step === 'standby' || step === 'scan' || step === 'assess' || step === 'anatomy');
    const presence = this.presence.update(wanted, t, dt) * pose.confidence;
    if (presence <= 0.003) return;

    const w = new WoundSpace(pose, view, settings.acrossScale);
    const closing = ease.outQuart(progress(t, this.lockedAt, 0.7));
    const grow = 1 + (1 - closing) * 1.4; // brackets start wide and close in
    const halfAlong = (w.half + 6) * grow;
    const halfAcross = 7.5 * grow;
    const leg = 4.2;
    const quiet = step === 'standby' ? 1 : 0.55;

    const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sa, sc] of corners) {
      const points = w.points([
        [sa * (halfAlong - leg), sc * halfAcross],
        [sa * halfAlong, sc * halfAcross],
        [sa * halfAlong, sc * (halfAcross - leg)],
      ]);
      glow(ctx, polyline(points), C.cyan, { width: 1.6, alpha: presence * quiet, bloom: 0.8 });
    }

    // A small tag while standing by, so the audience can see the system has found its target.
    if (step === 'standby') {
      const tagAlpha = presence * ease.outCubic(progress(t, this.lockedAt + 0.45, 0.5));
      const [tx, ty] = w.point(0, halfAcross + 5.5);
      text(ctx, 'WOUND LOCKED', tx, ty, { size: 11, color: C.cyan, alpha: tagAlpha, tracking: 0.22, weight: 600 });
    }
  }
}
