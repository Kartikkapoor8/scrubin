import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { ease, lerp, progress, spring } from '../../core/dom';
import { C, dot, glow, measure, plate, polyline, text, textHeight } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * Shows that the wound has been found: four corner brackets that spring shut on the marker line the moment
 * tracking locks, a line of light that sweeps across them, and a "wound locked" tag. They then sit quietly
 * around the wound, swept now and then, and step aside while the plan and the stitches are showing.
 */
export class WoundLockLayer implements Layer {
  private presence = new Appear(4, 5);
  private lockedAt = -1e9;
  private wasLocked = false;
  private searching = 0;

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const { tracker, procedure, settings, hidden } = this.scene;
    const pose = tracker.pose;
    const step = procedure.step.id;

    if (pose.locked && !this.wasLocked) this.lockedAt = t;
    this.wasLocked = pose.locked;
    if (this.scene.relockAt > this.lockedAt) this.lockedAt = this.scene.relockAt;

    // Nothing found yet: say what the system is doing, quietly, instead of showing an empty picture.
    const searching = !hidden && !this.scene.attract && step === 'standby' && !pose.locked && pose.confidence < 0.05;
    this.searching += ((searching ? 1 : 0) - this.searching) * (1 - Math.exp(-(searching ? 1.2 : 6) * dt));
    if (this.searching > 0.01) {
      const dots = '.'.repeat(1 + (Math.floor(t * 2) % 3));
      // With no picture yet the thing being waited for is the picture, not the wound.
      const input = this.scene.input;
      // "Connecting" only while it is; a headset that cannot be reached as set up is simply waited for
      // (the operator's banner says why).
      const waiting = input.live ? 'LOOKING FOR THE WOUND'
        : input.label !== 'HoloLens' ? 'WAITING FOR THE PICTURE'
        : input.unavailable ? 'WAITING FOR THE HEADSET' : 'CONNECTING TO THE HEADSET';
      text(ctx, `${waiting}${dots.padEnd(3, ' ')}`, frame.width / 2, frame.height * 0.84, {
        size: 16, color: C.cyan, alpha: this.searching * (0.7 + 0.25 * Math.sin(t * 2.4)), font: 'body', tracking: 0.2, weight: 700, plate: 1,
      });
    }

    // The idle screen has the picture to itself: no brackets or tag showing through its lettering.
    const wanted = !hidden && !this.scene.attract && pose.locked && (step === 'standby' || step === 'scan');
    const presence = this.presence.update(wanted, t, dt) * pose.confidence;
    if (presence <= 0.003) return;

    const w = new WoundSpace(pose, view, settings.acrossScale);
    const since = t - this.lockedAt;
    const grow = 1 + (1 - spring(since)) * 1.4; // brackets start wide and spring shut
    const halfAlong = (w.half + 6) * grow;
    const halfAcross = 7.5 * grow;
    const leg = 5;
    const quiet = step === 'standby' ? 1 : 0.55;

    const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sa, sc] of corners) {
      const points = w.points([
        [sa * (halfAlong - leg), sc * halfAcross],
        [sa * halfAlong, sc * halfAcross],
        [sa * halfAlong, sc * (halfAcross - leg)],
      ]);
      glow(ctx, polyline(points), C.cyan, { width: 2, alpha: presence * quiet, bloom: 0.9 });
    }
    // A tick at the middle of each long side, pointing at the wound.
    for (const sc of [-1, 1]) {
      glow(ctx, polyline(w.points([[0, sc * halfAcross], [0, sc * (halfAcross - 2)]])), C.cyan, { width: 1.4, alpha: presence * quiet * 0.8, bloom: 0.6 });
    }

    // A line of light crosses the brackets as they lock, and again every few seconds while they wait.
    const pass = since < 1 ? since / 0.8 : ((since - 1) % 3.6) / 0.9;
    if (pass > 0 && pass < 1) {
      const along = lerp(-halfAlong, halfAlong, ease.inOutCubic(pass));
      const strength = Math.sin(Math.PI * pass) * (since < 1 ? 1 : 0.5);
      glow(ctx, polyline(w.points([[along, -halfAcross], [along, halfAcross]])), C.white, {
        width: 1.4, alpha: presence * quiet * strength, bloom: 1.8, halo: 0,
      });
    }

    // A small tag while standing by, so the audience can see the system has found its target.
    if (step === 'standby') {
      const tagAlpha = presence * ease.outCubic(progress(t, this.lockedAt + 0.4, 0.45));
      const [tx, ty] = w.point(0, halfAcross + 5.5);
      const options = { size: 13, font: 'body' as const, tracking: 0.18, weight: 700 };
      const wide = measure(ctx, 'WOUND LOCKED', options);
      const tall = textHeight(13);
      // The lock light and the words share one plate.
      plate(ctx, tx - wide / 2 - tall * 1.5, ty - tall * 0.68, tx + wide / 2 + tall * 0.42, ty + tall * 0.62, tagAlpha);
      text(ctx, 'WOUND LOCKED', tx, ty, { ...options, color: C.cyan, alpha: tagAlpha });
      dot(ctx, tx - wide / 2 - tall * 0.72, ty, 3.2, C.green, tagAlpha, 0);
    }
  }
}
