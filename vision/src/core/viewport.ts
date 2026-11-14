import { clamp, damp } from './dom';

export type FitMode = 'cover' | 'contain';

/**
 * Maps positions in the video (in video pixels) to positions on the screen (in CSS pixels), including the
 * slow zoom toward the wound. The video element and the overlay canvas both use this one mapping, so drawn
 * overlays stay glued to the picture however the window is sized, fitted or zoomed.
 */
export class Viewport {
  stageW = 1;
  stageH = 1;
  videoW = 1280;
  videoH = 720;
  fit: FitMode = 'cover';

  /** Current zoom (1 = whole picture) and the video point shown at the centre of the screen. */
  zoom = 1;
  centerX = 640;
  centerY = 360;

  private targetZoom = 1;
  private targetX = 640;
  private targetY = 360;
  private hasFocus = false;

  setSize(stageW: number, stageH: number, videoW: number, videoH: number): void {
    this.stageW = Math.max(1, stageW);
    this.stageH = Math.max(1, stageH);
    if (videoW > 0 && videoH > 0 && (videoW !== this.videoW || videoH !== this.videoH)) {
      this.videoW = videoW;
      this.videoH = videoH;
      if (!this.hasFocus) {
        this.centerX = this.targetX = videoW / 2;
        this.centerY = this.targetY = videoH / 2;
      }
    }
  }

  /** CSS pixels per video pixel with no zoom. */
  get baseScale(): number {
    const sx = this.stageW / this.videoW;
    const sy = this.stageH / this.videoH;
    return this.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  }

  /** CSS pixels per video pixel, zoom included. */
  get scale(): number {
    return this.baseScale * this.zoom;
  }

  /** Ask for a zoom level around a point in the video. Call every frame with the latest point; it eases. */
  focusOn(zoom: number, videoX: number, videoY: number): void {
    this.targetZoom = Math.max(1, zoom);
    this.targetX = videoX;
    this.targetY = videoY;
    this.hasFocus = true;
  }

  /** Back to the whole picture. */
  release(): void {
    this.targetZoom = 1;
    this.targetX = this.videoW / 2;
    this.targetY = this.videoH / 2;
    this.hasFocus = false;
  }

  step(dt: number): void {
    const k = damp(2.2, dt);
    this.zoom += (this.targetZoom - this.zoom) * k;
    if (Math.abs(this.targetZoom - this.zoom) < 0.0005) this.zoom = this.targetZoom;

    // Never show beyond the edge of the picture: keep the visible window inside the video.
    const halfW = Math.min(this.videoW / 2, this.stageW / (2 * this.scale));
    const halfH = Math.min(this.videoH / 2, this.stageH / (2 * this.scale));
    const tx = clamp(this.targetX, halfW, this.videoW - halfW);
    const ty = clamp(this.targetY, halfH, this.videoH - halfH);
    this.centerX += (tx - this.centerX) * k;
    this.centerY += (ty - this.centerY) * k;
    this.centerX = clamp(this.centerX, halfW, this.videoW - halfW);
    this.centerY = clamp(this.centerY, halfH, this.videoH - halfH);
  }

  /** Video pixels -> CSS pixels on the stage. */
  toScreenX(videoX: number): number {
    return this.stageW / 2 + (videoX - this.centerX) * this.scale;
  }

  toScreenY(videoY: number): number {
    return this.stageH / 2 + (videoY - this.centerY) * this.scale;
  }

  toVideoX(screenX: number): number {
    return this.centerX + (screenX - this.stageW / 2) / this.scale;
  }

  toVideoY(screenY: number): number {
    return this.centerY + (screenY - this.stageH / 2) / this.scale;
  }

  /**
   * The CSS transform that puts an element laid out with object-fit (filling the stage) in the same place
   * this mapping describes. Use with `transform-origin: 0 0`.
   */
  cssTransform(): string {
    const s0 = this.baseScale;
    const z = this.zoom;
    const offsetX = (this.stageW - this.videoW * s0) / 2;
    const offsetY = (this.stageH - this.videoH * s0) / 2;
    const tx = this.stageW / 2 - z * s0 * this.centerX - z * offsetX;
    const ty = this.stageH / 2 - z * s0 * this.centerY - z * offsetY;
    return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(4)})`;
  }
}
