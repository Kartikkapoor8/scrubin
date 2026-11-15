import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { clamp, ease, progress } from '../../core/dom';
import { C, css, glow, polyline, segment, text } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * The opening scan: a bright line sweeps down the picture leaving fine scan lines in its wake, then a second
 * pass crosses the arm and leaves glowing contour arcs over it, and the wound lock snaps in as the sweep
 * passes the wound.
 */
export class ScanLayer implements Layer {
  private presence = new Appear(5, 2.5);
  private relocked = false;

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view, width, height } = frame;
    const scene = this.scene;
    const { procedure, tracker, settings } = scene;
    const on = !scene.hidden && procedure.step.id === 'scan';
    const presence = this.presence.update(on, t, dt);
    if (presence <= 0.003) return;

    const time = t - procedure.stepStartedAt;
    if (time < 0.05) this.relocked = false;
    const pose = tracker.pose;

    // Pass 1: top to bottom.
    const p1 = ease.inOutCubic(progress(time, 0.25, 2.1));
    const y = -0.04 * height + p1 * 1.08 * height;
    if (p1 > 0 && p1 < 1) {
      const band = height * 0.2;
      const trail = ctx.createLinearGradient(0, y - band, 0, y);
      trail.addColorStop(0, css(C.cyan, 0));
      trail.addColorStop(1, css(C.cyan, 0.16 * presence));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = trail;
      ctx.fillRect(0, y - band, width, band);
      // Fine scan lines in the wake.
      ctx.strokeStyle = css(C.cyan, 0.2 * presence);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let ly = Math.floor(y / 7) * 7; ly > y - band; ly -= 7) {
        ctx.moveTo(0, ly + 0.5);
        ctx.lineTo(width, ly + 0.5);
      }
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.restore();
      glow(ctx, segment(0, y, width, y), C.cyan, { width: 1.6, alpha: presence, bloom: 2.2, halo: 0 });
    }

    // The lock brackets snap in again as the sweep passes over the wound.
    if (pose.locked && !this.relocked && y > view.toScreenY(pose.cy)) {
      this.relocked = true;
      scene.relockAt = t;
    }

    // Pass 2: along the arm, leaving contour arcs across it.
    const p2 = ease.inOutCubic(progress(time, 2.2, 2.2));
    if (pose.confidence > 0.01) {
      const w = new WoundSpace(pose, view, settings.acrossScale);
      const from = -118;
      const to = 134;
      const head = from + (to - from) * p2;
      const alpha = presence * pose.confidence;

      for (let along = -104; along <= 130; along += 26) {
        if (Math.abs(along) < w.half + 9) continue; // keep the wound itself clear
        const passed = clamp((head - along) / 14, 0, 1);
        if (passed <= 0) continue;
        const flash = 1 - clamp((head - along) / 70, 0, 1);
        const halfWidth = 31 + (along + 104) * 0.038; // the forearm widens toward the elbow
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i <= 16; i++) {
          const u = -1 + (2 * i) / 16;
          pairs.push([along + (1 - u * u) * 5, u * halfWidth]);
        }
        const points = w.points(pairs);
        let length = 0;
        for (let i = 2; i < points.length; i += 2) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
        glow(ctx, polyline(points), C.cyan, {
          width: 1.2, alpha: alpha * (0.38 + 0.6 * flash), bloom: 0.7 + flash, reveal: passed, length, halo: 0.35,
        });
      }

      if (p2 > 0 && p2 < 1) {
        glow(ctx, polyline(w.points([[head, -46], [head, 46]])), C.white, { width: 1.4, alpha: alpha * 0.9, bloom: 0.9, halo: 0 });
      }
    }

    // Readout, bottom centre.
    const percent = Math.round(clamp((p1 * 0.5 + p2 * 0.5) * 100, 0, 100));
    const done = percent >= 100;
    const readY = height - Math.max(96, height * 0.135);
    text(ctx, done ? 'FIELD MAPPED' : 'SCANNING FIELD', width / 2, readY, {
      size: 17, color: done ? C.green : C.cyan, alpha: presence, font: 'body', tracking: 0.22, weight: 700,
    });
    const barWidth = Math.min(380, width * 0.26);
    const barY = readY + 27;
    glow(ctx, segment(width / 2 - barWidth / 2, barY, width / 2 + barWidth / 2, barY), C.white, {
      width: 1, alpha: presence * 0.25, bloom: 0, halo: 0.4,
    });
    if (percent > 0) {
      glow(ctx, segment(width / 2 - barWidth / 2, barY, width / 2 - barWidth / 2 + (barWidth * percent) / 100, barY), done ? C.green : C.cyan, {
        width: 2, alpha: presence, bloom: 1, halo: 0,
      });
    }
    text(ctx, `${percent}%`, width / 2 + barWidth / 2 + 40, barY, { size: 13, color: C.white, alpha: presence * 0.85, weight: 600 });
  }
}
