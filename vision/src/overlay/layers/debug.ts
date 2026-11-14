import type { Scene } from '../../app/scene';
import { C, glow, segment, text } from '../draw';
import type { Frame, Layer } from '../renderer';

/** Operator's view of what tracking sees (key D): the colour mask, the fitted line and the numbers. */
export class DebugLayer implements Layer {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private image: ImageData | null = null;

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    if (!this.scene.debug) return;
    const { ctx, view } = frame;
    const { detector, tracker, hands, marker, settings } = this.scene;
    const mask = detector.debugMask;

    if (mask.width > 0) {
      if (!this.image || this.image.width !== mask.width || this.image.height !== mask.height) {
        this.canvas.width = mask.width;
        this.canvas.height = mask.height;
        this.image = this.ctx.createImageData(mask.width, mask.height);
      }
      const out = this.image.data;
      for (let p = 0, i = 0; p < mask.data.length; p++, i += 4) {
        const m = mask.data[p];
        if (m === 2) { out[i] = 255; out[i + 1] = 40; out[i + 2] = 220; out[i + 3] = 230; }
        else if (m !== 0) { out[i] = 255; out[i + 1] = 225; out[i + 2] = 77; out[i + 3] = 150; }
        else out[i + 3] = 0;
      }
      this.ctx.putImageData(this.image, 0, 0);
      const x0 = view.toScreenX(0);
      const y0 = view.toScreenY(0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.canvas, x0, y0, view.videoW * view.scale, view.videoH * view.scale);
      ctx.imageSmoothingEnabled = true;
    }

    const pose = tracker.pose;
    if (pose.confidence > 0) {
      const half = pose.length / 2;
      glow(ctx, segment(
        view.toScreenX(pose.cx - pose.dx * half), view.toScreenY(pose.cy - pose.dy * half),
        view.toScreenX(pose.cx + pose.dx * half), view.toScreenY(pose.cy + pose.dy * half),
      ), C.white, { width: 1, alpha: 0.9, bloom: 0 });
    }

    const lines = [
      `marker  hue ${marker.hue}° ±${marker.hueTolerance}  sat>${marker.minSaturation.toFixed(2)}  val>${marker.minValue.toFixed(2)}`,
      `mask ${detector.lastMaskCount} px   analysis ${detector.lastMs.toFixed(1)} ms @ ${detector.analysisWidth}px`,
      `blobs ${detector.lastReport.blobs}   not a line ${detector.lastReport.notLine}   glowing (hologram) ${detector.lastReport.glowing}`
        + `   chosen: hue ${detector.lastReport.hue}° sat ${detector.lastReport.saturation.toFixed(2)} val ${detector.lastReport.value.toFixed(2)} vs skin x${detector.lastReport.contrast.toFixed(2)}`,
      `wound  ${pose.locked ? 'LOCKED' : 'searching'}  conf ${pose.confidence.toFixed(2)}  ${pose.length.toFixed(0)} px  ${pose.pxPerMm.toFixed(2)} px/mm  stale ${pose.staleFor.toFixed(1)}s`,
      `hands  ${hands.state}  ${hands.hands.length} seen  ${hands.lastMs.toFixed(1)} ms`,
      `zoom ${view.zoom.toFixed(2)}  across ${settings.acrossScale.toFixed(2)}  flip ${settings.flipAlong ? 'along ' : ''}${settings.flipSide ? 'side' : ''}`,
    ];
    lines.forEach((line, i) => {
      text(ctx, line, frame.width / 2, 86 + i * 18, { size: 12, color: C.yellow, tracking: 0.02, weight: 500 });
    });
  }
}
