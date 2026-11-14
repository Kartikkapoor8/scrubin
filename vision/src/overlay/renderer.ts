import type { Viewport } from '../core/viewport';

/** What a layer is given every frame. Positions are CSS pixels on the stage; use `view` to place video points. */
export interface Frame {
  ctx: CanvasRenderingContext2D;
  /** Seconds since the app started. */
  t: number;
  /** Seconds since the previous frame. */
  dt: number;
  view: Viewport;
  width: number;
  height: number;
}

export interface Layer {
  draw(frame: Frame): void;
}

/**
 * The drawn overlays: one canvas over the picture, cleared and redrawn every display frame by a stack of
 * layers. Everything luminous is drawn additively, like light on glass.
 */
export class OverlayRenderer {
  private ctx: CanvasRenderingContext2D;
  private layers: Layer[] = [];
  private width = 0;
  private height = 0;
  private ratio = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  add(layer: Layer): void {
    this.layers.push(layer);
  }

  /** Match the canvas to the stage. Retina sharpness, capped so a 5K display does not cost frame rate. */
  resize(cssWidth: number, cssHeight: number): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (cssWidth === this.width && cssHeight === this.height && ratio === this.ratio) return;
    this.width = cssWidth;
    this.height = cssHeight;
    this.ratio = ratio;
    this.canvas.width = Math.round(cssWidth * ratio);
    this.canvas.height = Math.round(cssHeight * ratio);
  }

  draw(t: number, dt: number, view: Viewport): void {
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const frame: Frame = { ctx, t, dt, view, width: this.width, height: this.height };
    for (const layer of this.layers) {
      ctx.save();
      try {
        layer.draw(frame);
      } catch (err) {
        // One broken layer must never blank the rest of the picture on stage.
        console.error('[overlay] a layer failed to draw', err);
      }
      ctx.restore();
    }
  }
}
