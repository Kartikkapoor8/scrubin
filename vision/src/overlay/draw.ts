/**
 * Drawing primitives for the overlays. Everything luminous is drawn as light: a soft dark halo first (so a
 * thin line still reads on bright skin), then additive glow, then a hot, slightly whiter core.
 * All coordinates and widths are CSS pixels on the stage.
 */

export type RGB = readonly [number, number, number];

export const C = {
  cyan: [63, 224, 255],
  white: [255, 255, 255],
  green: [77, 255, 176],
  amber: [255, 181, 71],
  red: [255, 77, 94],
  blue: [77, 139, 255],
  yellow: [255, 225, 77],
  ink: [5, 8, 12],
} as const satisfies Record<string, RGB>;

export function css(color: RGB, alpha = 1): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Table mode: lines and lettering drawn on the picture are scaled up so they carry across a room.
let strokeScale = 1;
let textScale = 1;

/** Thickness multiplier for every glowing line, and size multiplier for every piece of text on the picture. */
export function setReadability(lines: number, lettering: number): void {
  strokeScale = lines;
  textScale = lettering;
}

export interface GlowOptions {
  /** Core width in pixels. */
  width?: number;
  /** Overall opacity, 0..1. */
  alpha?: number;
  /** Size of the bloom relative to the default (0 = none). */
  bloom?: number;
  /** Strength of the dark halo underneath, 0..1 (0 = none). */
  halo?: number;
  dash?: number[];
  dashOffset?: number;
  cap?: CanvasLineCap;
  /**
   * Draw only the first part of the path: 0..1. Needs `length` (the path's length in pixels).
   * Used to trace lines on instead of popping them in.
   */
  reveal?: number;
  length?: number;
}

/** Strokes a path as a glowing line. */
export function glow(ctx: CanvasRenderingContext2D, path: Path2D, color: RGB, options: GlowOptions = {}): void {
  const width = (options.width ?? 1.6) * strokeScale;
  const alpha = options.alpha ?? 1;
  if (alpha <= 0.003) return;
  const bloom = options.bloom ?? 1;
  const halo = options.halo ?? 0.55;

  let dash = options.dash ?? [];
  let dashOffset = options.dashOffset ?? 0;
  if (options.reveal !== undefined && options.length !== undefined) {
    const shown = Math.max(0, Math.min(1, options.reveal)) * options.length;
    if (shown <= 0.01) return;
    if (options.reveal < 1) {
      dash = [shown, options.length + 20];
      dashOffset = 0;
    }
  }

  ctx.save();
  ctx.lineCap = options.cap ?? 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  ctx.lineDashOffset = dashOffset;

  if (halo > 0) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = css(C.ink, 0.42 * halo * alpha);
    ctx.lineWidth = width + 5;
    ctx.stroke(path);
  }

  ctx.globalCompositeOperation = 'lighter';
  if (bloom > 0) {
    ctx.strokeStyle = css(color, 0.075 * alpha);
    ctx.lineWidth = width + 11 * bloom;
    ctx.stroke(path);
    ctx.strokeStyle = css(color, 0.17 * alpha);
    ctx.lineWidth = width + 4.5 * bloom;
    ctx.stroke(path);
  }
  ctx.strokeStyle = css(mix(color, C.white, 0.28), 0.95 * alpha);
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.restore();
}

/** A glowing filled dot. */
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: RGB, alpha = 1, halo = 0.55): void {
  if (alpha <= 0.003 || radius <= 0) return;
  ctx.save();
  if (halo > 0) {
    ctx.fillStyle = css(C.ink, 0.4 * halo * alpha);
    ctx.beginPath();
    ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  const bloom = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.2 + 4);
  bloom.addColorStop(0, css(color, 0.32 * alpha));
  bloom.addColorStop(1, css(color, 0));
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x, y, radius * 3.2 + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(mix(color, C.white, 0.3), 0.96 * alpha);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function segment(x1: number, y1: number, x2: number, y2: number): Path2D {
  const path = new Path2D();
  path.moveTo(x1, y1);
  path.lineTo(x2, y2);
  return path;
}

export function polyline(points: ArrayLike<number>, closed = false): Path2D {
  const path = new Path2D();
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (i === 0) path.moveTo(points[0], points[1]);
    else path.lineTo(points[i], points[i + 1]);
  }
  if (closed) path.closePath();
  return path;
}

export function circle(x: number, y: number, radius: number): Path2D {
  const path = new Path2D();
  path.arc(x, y, Math.max(0.01, radius), 0, Math.PI * 2);
  return path;
}

export function arc(x: number, y: number, radius: number, from: number, to: number, anticlockwise = false): Path2D {
  const path = new Path2D();
  path.arc(x, y, Math.max(0.01, radius), from, to, anticlockwise);
  return path;
}

const FONTS = {
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
  display: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif',
  body: '"Inter Variable", "Inter", system-ui, sans-serif',
};

export interface TextOptions {
  size?: number;
  color?: RGB;
  alpha?: number;
  font?: keyof typeof FONTS;
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Letter spacing in em. */
  tracking?: number;
  /** Rotation in radians about the text's anchor. */
  rotate?: number;
}

/** Text on the picture: a dark outline for contrast, then the letters. */
export function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: TextOptions = {}): void {
  const alpha = options.alpha ?? 1;
  if (alpha <= 0.003 || !value) return;
  const size = (options.size ?? 12) * textScale;
  ctx.save();
  ctx.font = `${options.weight ?? 500} ${size}px ${FONTS[options.font ?? 'mono']}`;
  ctx.textAlign = options.align ?? 'center';
  ctx.textBaseline = options.baseline ?? 'middle';
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${((options.tracking ?? 0.06) * size).toFixed(2)}px`;
  if (options.rotate) {
    ctx.translate(x, y);
    ctx.rotate(options.rotate);
    x = 0;
    y = 0;
  }
  // Contrast comes from a soft dark shadow drawn twice, not a hard outline: the letters stay thin and clean.
  ctx.shadowColor = css(C.ink, 0.95 * alpha);
  ctx.shadowBlur = Math.max(4, size * 0.5);
  ctx.fillStyle = css(C.ink, 0.55 * alpha);
  ctx.fillText(value, x, y);
  ctx.fillStyle = css(options.color ?? C.white, alpha);
  ctx.fillText(value, x, y);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.fillText(value, x, y);
  ctx.restore();
}

/** Width of a string as `text` would draw it. */
export function measure(ctx: CanvasRenderingContext2D, value: string, options: TextOptions = {}): number {
  const size = (options.size ?? 12) * textScale;
  ctx.save();
  ctx.font = `${options.weight ?? 500} ${size}px ${FONTS[options.font ?? 'mono']}`;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${((options.tracking ?? 0.06) * size).toFixed(2)}px`;
  const width = ctx.measureText(value).width;
  ctx.restore();
  return width;
}

/** A small check mark, drawn rather than typed, centred on (x, y). */
export function check(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: RGB, alpha = 1, reveal = 1): void {
  const points = [x - size * 0.5, y + size * 0.02, x - size * 0.12, y + size * 0.38, x + size * 0.52, y - size * 0.4];
  const length = Math.hypot(points[2] - points[0], points[3] - points[1]) + Math.hypot(points[4] - points[2], points[5] - points[3]);
  glow(ctx, polyline(points), color, { width: Math.max(1.6, size * 0.16), alpha, reveal, length, bloom: 0.7 });
}
