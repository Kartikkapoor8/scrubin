import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { clamp, damp, ease, progress } from '../../core/dom';
import { C, css, dot, glow, polyline, text, type RGB } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * Stylised anatomy of the volar forearm, laid along the arm in wound space (millimetres from the centre of
 * the wound; `along` runs toward the elbow, `across` toward the thumb side). It is a teaching diagram, not
 * a scan: positions are plausible, simplified, and arranged so the radial artery passes close beside the
 * wound, which is what the danger zone is about. The wound sits 121 mm from the wrist.
 */
type Point = [number, number];

interface Structure {
  /** Name used by the attending's highlight_structure tool. */
  id: string;
  label: string;
  color: RGB;
  width: number;
  paths: Point[][];
  /** Where the label's leader touches the structure, and where the label sits. */
  anchor: Point;
  labelAt: Point;
  flow?: boolean;
  /** Fades out toward its last point (tendons disappearing into muscle). */
  fadeOut?: boolean;
}

const WRIST = -121;
const ELBOW = 139;

const RADIAL: Point[] = [[WRIST, 21], [-90, 19], [-55, 15.5], [-25, 12.6], [0, 11.6], [28, 12.6], [60, 15], [100, 15.5], [ELBOW, 11]];

const STRUCTURES: Structure[] = [
  {
    id: 'flexor_tendons', label: 'Flexor tendons', color: C.white, width: 1.1, fadeOut: true,
    paths: [-12.5, -5, 3.5, 10.5].map((c): Point[] => [[WRIST, c], [-92, c * 0.94], [-62, c * 0.84], [-34, c * 0.74]]),
    anchor: [-96, -4.8], labelAt: [-103, -50],
  },
  {
    id: 'veins', label: 'Superficial veins', color: C.blue, width: 1.6,
    paths: [
      [[WRIST, 30.5], [-72, 31.5], [-22, 29.5], [28, 31.5], [78, 34.5], [ELBOW, 37]],
      [[WRIST, -30], [-62, -31.5], [0, -29.5], [60, -31.5], [ELBOW, -31]],
      [[WRIST, -7], [-74, -9.6], [-24, -8.8], [26, -10], [74, -6.5], [112, 6], [ELBOW, 17]],
    ],
    anchor: [66, 33.6], labelAt: [78, 50],
  },
  {
    id: 'median_nerve', label: 'Median nerve', color: C.yellow, width: 1.5,
    paths: [[[WRIST, -1.2], [-62, -2.8], [0, -3.4], [62, -2.6], [ELBOW, -1]]],
    anchor: [44, -3], labelAt: [34, -50],
  },
  {
    id: 'ulnar_artery', label: 'Ulnar artery', color: C.red, width: 2, flow: true,
    paths: [[[WRIST, -22], [-82, -21], [-42, -19.4], [0, -18.2], [50, -16], [100, -10.5], [ELBOW, -3.5]]],
    anchor: [-48, -19.6], labelAt: [-40, -50],
  },
  {
    id: 'radial_artery', label: 'Radial artery', color: C.red, width: 2.2, flow: true,
    paths: [RADIAL],
    anchor: [-40, 14], labelAt: [-54, 50],
  },
];

/** Smooth curve through the control points, sampled into [along, across] pairs. */
function smooth(points: Point[], perSegment = 10): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

const SAMPLED = STRUCTURES.map((s) => s.paths.map((p) => smooth(p)));
const RADIAL_SAMPLED = smooth(RADIAL, 14);

/** The part of a wrist-to-elbow path that the reveal wipe has reached. */
function upTo(path: Point[], along: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i][0] <= along) {
      out.push(path[i]);
    } else {
      if (i > 0) {
        const a = path[i - 1];
        const b = path[i];
        const k = (along - a[0]) / Math.max(1e-6, b[0] - a[0]);
        out.push([along, a[1] + (b[1] - a[1]) * k]);
      }
      break;
    }
  }
  return out;
}

function lengthOf(points: number[]): number {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return length;
}

export class AnatomyLayer implements Layer {
  private presence = new Appear(3, 4);
  private zone = new Appear(3, 4);
  private highlight = 0;
  private highlighted = '';

  constructor(private scene: Scene) {}

  draw(frame: Frame): void {
    const { ctx, t, dt, view } = frame;
    const scene = this.scene;
    const { procedure, tracker, settings, hidden } = scene;
    const pose = tracker.pose;
    const step = procedure.step.id;

    // The attending pointing at something keeps the layer up for a few seconds in any step.
    const pointing = !hidden && scene.highlight.structure !== '' && t < scene.highlight.until;
    if (pointing) this.highlighted = scene.highlight.structure;
    this.highlight += ((pointing ? 1 : 0) - this.highlight) * damp(pointing ? 6 : 3, dt);
    if (this.highlight < 0.004) this.highlight = 0;

    const inStep = !hidden && step === 'anatomy';
    const full = this.presence.update(inStep, t, dt, procedure.replayedAt);
    const zoneOn = this.zone.update(!hidden && (step === 'anatomy' || step === 'plan' || step === 'stitch'), t, dt);
    const conf = pose.confidence;
    if ((full <= 0.003 && this.highlight <= 0.003 && zoneOn <= 0.003) || conf <= 0.003) return;

    const w = new WoundSpace(pose, view, settings.acrossScale);
    const px = w.scale;

    // The reveal: a scan line runs wrist to elbow and the anatomy appears behind it.
    const wipe = this.presence.isOn ? ease.inOutCubic(progress(t, this.presence.since + 0.2, 1.9)) : 1;
    const reach = WRIST - 6 + (ELBOW - WRIST + 12) * wipe;
    if (full > 0.01 && wipe > 0 && wipe < 1) {
      glow(ctx, polyline(w.points([[reach, -47], [reach, 47]])), C.cyan, { width: 1.5, alpha: full * conf, bloom: 1.6, halo: 0 });
    }

    this.drawDangerZone(frame, w, Math.max(zoneOn * (step === 'anatomy' ? clamp((reach + 30) / 30, 0, 1) : 1), this.isPointedAt('danger_zone') ? this.highlight : 0) * conf, step === 'anatomy');

    for (let s = 0; s < STRUCTURES.length; s++) {
      const structure = STRUCTURES[s];
      const mine = this.highlighted === structure.id;
      // In the anatomy step everything shows, the pointed-at structure brighter and the rest dimmed.
      // Outside it, only the pointed-at structure appears.
      const inStepAlpha = full * (this.highlight > 0.01 ? (mine ? 1 : 1 - 0.65 * this.highlight) : 1);
      const outAlpha = (1 - full) * (mine ? this.highlight : 0);
      const alpha = (inStepAlpha + outAlpha) * conf;
      if (alpha <= 0.004) continue;
      const boost = mine ? this.highlight : 0;
      const limit = full > 0.01 ? reach : ELBOW + 10;

      for (const path of SAMPLED[s]) {
        const visible = upTo(path, limit);
        if (visible.length < 2) continue;
        const points = w.points(visible);
        const width = structure.width + boost * 1.3;
        if (structure.fadeOut) {
          // Drawn in three pieces of falling brightness, so the tendons melt away into the forearm.
          const third = Math.floor(points.length / 6) * 2;
          for (let k = 0; k < 3; k++) {
            const piece = points.slice(Math.max(0, k * third - 2), k === 2 ? points.length : (k + 1) * third + 2);
            if (piece.length >= 4) glow(ctx, polyline(piece), structure.color, { width, alpha: alpha * (0.62 - k * 0.2), bloom: 0.5, halo: 0.3 });
          }
        } else {
          glow(ctx, polyline(points), structure.color, { width, alpha: alpha * 0.92, bloom: 0.8 + boost * 0.9 });
        }
        if (structure.flow) {
          // Pulses of blood running toward the hand.
          const length = lengthOf(points);
          const beat = 0.5 + 0.5 * Math.sin(t * 7.54); // about 72 beats a minute
          glow(ctx, polyline(points), [255, 196, 196], {
            width: width * 0.8, alpha: alpha * (0.55 + 0.45 * beat), bloom: 1 + beat * 0.6, halo: 0,
            dash: [Math.max(6, 3.6 * px), Math.max(26, 15 * px)], dashOffset: (t * Math.max(46, 30 * px)) % Math.max(1, length + 400),
          });
        }
      }

      // Label on a leader, once the wipe has passed its anchor.
      const labelIn = full > 0.01 ? ease.outCubic(progress(reach, structure.anchor[0] + 4, 26)) : 1;
      const labelAlpha = alpha * labelIn;
      if (labelAlpha > 0.01) {
        const [ax, ay] = w.point(structure.anchor[0], structure.anchor[1]);
        // In the anatomy step labels sit outside the arm. When a single structure is being pointed at in a
        // closer view, its label comes in next to it instead, so it cannot end up under a HUD panel.
        const side = structure.labelAt[1] > 0 ? 1 : -1;
        const nearAlong = structure.anchor[0] + 5;
        const nearAcross = structure.anchor[1] + side * 9.5;
        const [lx, ly] = w.point(
          nearAlong + (structure.labelAt[0] - nearAlong) * full,
          nearAcross + (structure.labelAt[1] - nearAcross) * full,
        );
        const points = [ax, ay, lx, ly];
        glow(ctx, polyline(points), structure.color, {
          width: 1, alpha: labelAlpha * 0.7, bloom: 0.3, reveal: labelIn, length: Math.hypot(lx - ax, ly - ay), halo: 0.4,
        });
        dot(ctx, ax, ay, 2 + boost, structure.color, labelAlpha);
        const above = structure.labelAt[1] > 0;
        text(ctx, structure.label.toUpperCase(), lx, ly + (above ? -9 : 10), {
          size: clamp(2.2 * px, 10.5, 14) + boost * 2, color: mine ? C.white : structure.color, alpha: labelAlpha, weight: 600, tracking: 0.16,
        });
      }
    }

    // "The wound": a pulse around it when the attending points at it.
    if (this.isPointedAt('wound') && this.highlight > 0.01) {
      const phase = (t % 1.2) / 1.2;
      const half = w.half + 5 + phase * 6;
      const across = 6 + phase * 5;
      glow(ctx, polyline(w.points([[-half, -across], [half, -across], [half, across], [-half, across]]), true), C.amber, {
        width: 1.5, alpha: this.highlight * conf * (1 - phase), bloom: 1.2, halo: 0.3,
      });
    }
  }

  private isPointedAt(id: string): boolean {
    return this.highlighted === id;
  }

  /** The stretch of the radial artery that runs beside the wound: keep the needle out of here. */
  private drawDangerZone(frame: Frame, w: WoundSpace, alpha: number, detailed: boolean): void {
    if (alpha <= 0.004) return;
    const { ctx, t } = frame;
    const px = w.scale;
    const halfWidth = 4.4;
    const from = -30;
    const to = 30;

    const centre = RADIAL_SAMPLED.filter((p) => p[0] >= from && p[0] <= to);
    if (centre.length < 2) return;
    const upper: Point[] = centre.map((p): Point => [p[0], p[1] + halfWidth]);
    const lower: Point[] = centre.map((p): Point => [p[0], p[1] - halfWidth]).reverse();
    const outline = w.points([...upper, ...lower]);
    const pulse = 0.62 + 0.38 * Math.sin(t * 3.2);
    const path = polyline(outline, true);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = css(C.red, 0.15 * alpha * (0.7 + 0.3 * pulse));
    ctx.fill(path);
    // Hatching, clipped to the zone.
    ctx.clip(path);
    ctx.strokeStyle = css(C.red, 0.34 * alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [x0, y0] = w.point(from, 0);
    const [x1, y1] = w.point(to, 0);
    const span = Math.hypot(x1 - x0, y1 - y0) + 80 * px;
    const gap = Math.max(6, 2.2 * px);
    const angle = w.angle + Math.PI / 4;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    for (let d = -span; d <= span; d += gap) {
      const ox = cx - uy * d;
      const oy = cy + ux * d;
      ctx.moveTo(ox - ux * span, oy - uy * span);
      ctx.lineTo(ox + ux * span, oy + uy * span);
    }
    ctx.stroke();
    ctx.restore();

    glow(ctx, path, C.red, { width: 1.5, alpha: alpha * pulse, bloom: 1.1, dash: detailed ? [] : [5, 5], halo: 0.35 });

    const [tx, ty] = w.point(0, centre[Math.floor(centre.length / 2)][1] + halfWidth + 3.6);
    text(ctx, 'DANGER ZONE', tx, ty, {
      size: clamp(2.2 * px, 10.5, 14), color: [255, 138, 148], alpha: alpha * (0.85 + 0.15 * pulse), weight: 700, tracking: 0.24,
    });
  }
}
