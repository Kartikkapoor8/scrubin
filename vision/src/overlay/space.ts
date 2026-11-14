import type { Viewport } from '../core/viewport';
import type { WoundPose } from '../tracking/wound';

/**
 * Wound space: positions measured in millimetres from the centre of the wound. `along` runs from the first
 * end of the wound to the last; `across` is positive toward the far (thumb) side. This is what pins every
 * surgical overlay to the real marker line, at the right size, whatever the camera and the zoom are doing.
 */
export class WoundSpace {
  /** Screen pixels per millimetre. */
  readonly scale: number;
  /** Angle of the wound on screen, radians. */
  readonly angle: number;
  /** Brightness multiplier from tracking confidence, 0..1. */
  readonly confidence: number;

  constructor(private pose: WoundPose, private view: Viewport, private acrossScale = 1) {
    this.scale = pose.pxPerMm * view.scale;
    this.angle = Math.atan2(pose.dy, pose.dx);
    this.confidence = pose.confidence;
  }

  x(along: number, across = 0): number {
    const p = this.pose;
    return this.view.toScreenX(p.cx + (p.dx * along + p.sx * across * this.acrossScale) * p.pxPerMm);
  }

  y(along: number, across = 0): number {
    const p = this.pose;
    return this.view.toScreenY(p.cy + (p.dy * along + p.sy * across * this.acrossScale) * p.pxPerMm);
  }

  /** [x, y] on screen. */
  point(along: number, across = 0): [number, number] {
    return [this.x(along, across), this.y(along, across)];
  }

  /** Flat [x0, y0, x1, y1, ...] screen points for a list of [along, across] pairs. */
  points(pairs: Array<[number, number]>): number[] {
    const out: number[] = [];
    for (const [along, across] of pairs) out.push(this.x(along, across), this.y(along, across));
    return out;
  }

  /** Millimetres along / across for a video-pixel position (for example a fingertip). */
  toMm(videoX: number, videoY: number): { along: number; across: number } {
    const p = this.pose;
    const rx = (videoX - p.cx) / p.pxPerMm;
    const ry = (videoY - p.cy) / p.pxPerMm;
    return { along: rx * p.dx + ry * p.dy, across: (rx * p.sx + ry * p.sy) / this.acrossScale };
  }

  /** Half the wound's length in millimetres. */
  get half(): number {
    return this.pose.length / this.pose.pxPerMm / 2;
  }
}
