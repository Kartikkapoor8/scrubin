import type { Scene } from '../../app/scene';
import { Appear } from '../../app/scene';
import { clamp, damp, ease, progress } from '../../core/dom';
import { C, css, dot, glow, measure, polyline, text, textHeight, type RGB } from '../draw';
import type { Frame, Layer } from '../renderer';
import { WoundSpace } from '../space';

/**
 * What lies under the wound, drawn in wound space (millimetres from the centre of the wound; `along` runs
 * toward the elbow, `across` toward the thumb side). It is a teaching diagram, not a scan: positions are
 * plausible, simplified, and arranged so the radial artery passes close beside the wound, which is what the
 * danger zone is about.
 *
 * The headset already shows a holographic body, so nothing here redraws the arm. The structures are shown
 * only in a window around the wound: each line fades out a couple of centimetres beyond either end of it.
 */
type Point = [number, number];

interface Structure {
  /** Name used by the attending's highlight_structure tool. */
  id: string;
  label: string;
  color: RGB;
  width: number;
  paths: Point[][];
  flow?: boolean;
  /** Fades out toward its last point (tendons disappearing into muscle). */
  fadeOut?: boolean;
  /** Drawn in the anatomy step without a name (it would crowd the others). */
  unnamed?: boolean;
  /** Not part of the anatomy step's picture: shown only when the attending points at it. */
  onRequest?: boolean;
}

const WRIST = -121;
const ELBOW = 139;
/** How far beyond each end of the wound the structures are drawn, and how far either side of it (mm). */
const BEYOND = 24;
const BESIDE = 25;
/** Length of the fade at each end of the window (mm). */
const FADE = 10;

const RADIAL: Point[] = [[WRIST, 21], [-90, 19], [-55, 15.5], [-25, 12.6], [0, 11.6], [28, 12.6], [60, 15], [100, 15.5], [ELBOW, 11]];

const STRUCTURES: Structure[] = [
  {
    id: 'flexor_tendons', label: 'Flexor tendons', color: C.white, width: 1.1, fadeOut: true, onRequest: true,
    paths: [-12.5, -5, 3.5, 10.5].map((c): Point[] => [[WRIST, c], [-92, c * 0.94], [-62, c * 0.84], [-34, c * 0.74]]),
  },
  {
    id: 'veins', label: 'Superficial vein', color: C.blue, width: 1.6, unnamed: true,
    paths: [
      [[WRIST, 30.5], [-72, 31.5], [-22, 29.5], [28, 31.5], [78, 34.5], [ELBOW, 37]],
      [[WRIST, -30], [-62, -31.5], [0, -29.5], [60, -31.5], [ELBOW, -31]],
      [[WRIST, -7], [-74, -9.6], [-24, -8.8], [26, -10], [74, -6.5], [112, 6], [ELBOW, 17]],
    ],
  },
  {
    id: 'median_nerve', label: 'Median nerve', color: C.yellow, width: 1.5,
    paths: [[[WRIST, -1.2], [-62, -2.8], [0, -3.4], [62, -2.6], [ELBOW, -1]]],
  },
  {
    id: 'ulnar_artery', label: 'Ulnar artery', color: C.red, width: 2, flow: true,
    paths: [[[WRIST, -22], [-82, -21], [-42, -19.4], [0, -18.2], [50, -16], [100, -10.5], [ELBOW, -3.5]]],
  },
  {
    id: 'radial_artery', label: 'Radial artery', color: C.red, width: 2.2, flow: true,
    paths: [RADIAL],
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

/** The stretch of a wrist-to-elbow path between two positions along the arm, with exact ends. */
function between(path: Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  if (to <= from) return out;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const before = i > 0 ? path[i - 1] : null;
    if (before && before[0] < from && p[0] >= from) {
      const k = (from - before[0]) / Math.max(1e-6, p[0] - before[0]);
      out.push([from, before[1] + (p[1] - before[1]) * k]);
    }
    if (p[0] >= from && p[0] <= to) out.push(p);
    if (before && before[0] <= to && p[0] > to) {
      const k = (to - before[0]) / Math.max(1e-6, p[0] - before[0]);
      out.push([to, before[1] + (p[1] - before[1]) * k]);
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

interface Tag {
  index: number;
  name: string;
  color: RGB;
  alpha: number;
  size: number;
  /** Where the structure leaves the window (screen), and where its name wants to be. */
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  width: number;
}

export class AnatomyLayer implements Layer {
  private presence = new Appear(3, 4);
  private zone = new Appear(3, 4);
  private highlight = 0;
  private highlighted = '';
  /** Presence of the window's corner marks (they step aside as a set when a panel covers one). */
  private corners = 1;
  /** How far each label is currently pushed out from under a HUD panel (pixels), eased. */
  private nudges: Array<[number, number]> = STRUCTURES.map(() => [0, 0]);

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
    // The window: the wound plus a margin at each end.
    const reachOut = w.half + BEYOND;

    // The reveal: a scan line crosses the window and the anatomy appears behind it.
    const wipe = this.presence.isOn ? ease.inOutCubic(progress(t, this.presence.since + 0.2, 1.5)) : 1;
    const reach = -reachOut - 3 + (reachOut * 2 + 6) * wipe;
    if (full > 0.01 && wipe > 0 && wipe < 1) {
      glow(ctx, polyline(w.points([[reach, -BESIDE], [reach, BESIDE]])), C.cyan, { width: 1.6, alpha: full * conf, bloom: 1.7, halo: 0 });
    }
    this.drawWindow(frame, w, reachOut, full * conf);

    this.drawDangerZone(frame, w, Math.max(zoneOn * (step === 'anatomy' ? clamp((reach + 30) / 30, 0, 1) : 1), this.isPointedAt('danger_zone') ? this.highlight : 0) * conf, step === 'anatomy');

    // Names sit where each structure leaves the window, on whichever end is further right on screen.
    const [leftX] = w.point(-reachOut, 0);
    const [rightX] = w.point(reachOut, 0);
    const end = rightX >= leftX ? 1 : -1;
    const tags: Tag[] = [];

    for (let s = 0; s < STRUCTURES.length; s++) {
      const structure = STRUCTURES[s];
      const mine = this.highlighted === structure.id;
      // In the anatomy step everything shows, the pointed-at structure brighter and the rest dimmed.
      // Outside it, only the pointed-at structure appears.
      const inStepAlpha = structure.onRequest ? 0 : full * (this.highlight > 0.01 ? (mine ? 1 : 1 - 0.65 * this.highlight) : 1);
      const outAlpha = (structure.onRequest ? 1 : 1 - full) * (mine ? this.highlight : 0);
      const alpha = Math.min(1, inStepAlpha + outAlpha) * conf;
      if (alpha <= 0.004) continue;
      const boost = mine ? this.highlight : 0;
      const limit = full > 0.01 && !structure.onRequest ? Math.min(reach, reachOut) : reachOut;
      const width = structure.width + boost * 1.3;
      let exit: Point | null = null;

      for (const path of SAMPLED[s]) {
        // Only what runs through the window, and only what is beside the wound.
        const inside = between(path, -reachOut, limit);
        if (inside.length < 2 || inside.every((p) => Math.abs(p[1]) > BESIDE)) continue;
        const first = inside[0][0];
        const last = inside[inside.length - 1][0];
        // Each line is solid beside the wound and fades out toward the ends of the window.
        const pieces: Array<[number, number, number]> = [
          [-reachOut, -reachOut + FADE * 0.5, 0.22],
          [-reachOut + FADE * 0.5, -reachOut + FADE, 0.55],
          [-reachOut + FADE, reachOut - FADE, 1],
          [reachOut - FADE, reachOut - FADE * 0.5, 0.55],
          [reachOut - FADE * 0.5, reachOut, 0.22],
        ];
        for (const [from, to, strength] of pieces) {
          const piece = between(inside, Math.max(from, first), Math.min(to, last));
          if (piece.length < 2) continue;
          const points = w.points(piece);
          const fade = structure.fadeOut ? 0.55 : 0.92;
          glow(ctx, polyline(points), structure.color, { width, alpha: alpha * strength * fade, bloom: (0.8 + boost * 0.9) * strength, halo: 0.5 * strength, cap: 'butt' });
          if (structure.flow && strength === 1) {
            // Pulses of blood running toward the hand.
            const length = lengthOf(points);
            const beat = 0.5 + 0.5 * Math.sin(t * 7.54); // about 72 beats a minute
            glow(ctx, polyline(points), [255, 196, 196], {
              width: width * 0.8, alpha: alpha * (0.55 + 0.45 * beat), bloom: 1 + beat * 0.6, halo: 0,
              dash: [Math.max(6, 3.6 * px), Math.max(26, 15 * px)], dashOffset: (t * Math.max(46, 30 * px)) % Math.max(1, length + 400),
            });
          }
        }
        const tip = end > 0 ? inside[inside.length - 1] : inside[0];
        if (Math.abs(tip[0]) > reachOut - 0.5 || structure.fadeOut) exit = tip;
      }

      // The name, once the wipe has reached the end it sits at.
      if (!exit || (structure.unnamed && !mine)) continue;
      const labelIn = full > 0.01 && !structure.onRequest ? ease.outCubic(progress(reach, end > 0 ? reachOut - 6 : -reachOut + 8, 8)) : 1;
      const labelAlpha = alpha * labelIn;
      if (labelAlpha <= 0.01) continue;
      const size = clamp(2.6 * px, 14.5, 17) + boost * 2;
      const name = structure.label.toUpperCase();
      const [fromX, fromY] = w.point(exit[0], exit[1]);
      const [x, y] = w.point(exit[0] + end * 5, exit[1]);
      tags.push({
        index: s, name, color: mine ? C.white : structure.color, alpha: labelAlpha, size, fromX, fromY, x, y,
        width: measure(ctx, name, { size, font: 'body', weight: 700, tracking: 0.12 }),
      });
    }

    this.drawTags(frame, tags);

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

  /** Four small corners marking the part of the arm being looked under. */
  private drawWindow(frame: Frame, w: WoundSpace, reachOut: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const leg = 4;
    const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Array<[number, number]>).map(([sa, sc]) => w.points([
      [sa * (reachOut - leg), sc * BESIDE],
      [sa * reachOut, sc * BESIDE],
      [sa * reachOut, sc * (BESIDE - leg)],
    ]));
    // All four or none: a frame with one corner under a HUD panel reads as broken.
    const hidden = corners.some((points) => this.scene.keepOut.some((zone) => points[2] > zone.x0 - 12 && points[2] < zone.x1 + 12 && points[3] > zone.y0 - 12 && points[3] < zone.y1 + 12));
    this.corners += ((hidden ? 0 : 1) - this.corners) * damp(6, frame.dt);
    if (this.corners <= 0.01) return;
    for (const points of corners) glow(frame.ctx, polyline(points), C.cyan, { width: 1.2, alpha: alpha * 0.6 * this.corners, bloom: 0.5 });
  }

  /**
   * The names, in a column at the end of the window. They are spread so no two touch, kept out from under
   * the HUD panels, and joined to their structures by a short leader.
   */
  private drawTags(frame: Frame, tags: Tag[]): void {
    if (tags.length === 0) return;
    const { ctx } = frame;
    tags.sort((a, b) => a.y - b.y);
    const gap = textHeight(tags[0].size) * 1.25;
    // Push apart, then recentre the column on where it wanted to be.
    const wanted = tags.reduce((sum, tag) => sum + tag.y, 0) / tags.length;
    for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + gap);
    const shift = wanted - tags.reduce((sum, tag) => sum + tag.y, 0) / tags.length;
    for (const tag of tags) tag.y += shift;

    // The column is placed as one piece: on the side with room, and moved clear of any HUD panel together,
    // so the names keep their order and their spacing (and their leaders never cross).
    const widest = Math.max(...tags.map((tag) => tag.width));
    const toRight = tags[0].x >= tags[0].fromX;
    const fits = tags.every((tag) => (toRight ? tag.x + tag.width < frame.width - 12 : tag.x - tag.width > 12));
    const side = fits ? (toRight ? 1 : -1) : (toRight ? -1 : 1);
    const height = textHeight(tags[0].size);
    const top = tags[0].y - height * 0.7;
    const bottom = tags[tags.length - 1].y + height * 0.7;
    const middleX = tags.reduce((sum, tag) => sum + tag.x, 0) / tags.length + side * (widest / 2 + 6);
    const [movedX, movedY] = this.clearOfPanels(0, middleX, (top + bottom) / 2, widest / 2 + 6, (bottom - top) / 2, frame);
    const dx = movedX - middleX;
    const dy = movedY - (top + bottom) / 2;
    // One left (or right) edge for the whole column, at the name that starts furthest out.
    const edge = side > 0 ? Math.max(...tags.map((tag) => tag.x)) : Math.min(...tags.map((tag) => tag.x));

    for (const tag of tags) {
      const startX = edge + dx;
      const y = tag.y + dy;
      glow(ctx, polyline([tag.fromX, tag.fromY, startX, y]), tag.color, { width: 1, alpha: tag.alpha * 0.7, bloom: 0.3, halo: 0.4 });
      dot(ctx, tag.fromX, tag.fromY, 2.2, tag.color, tag.alpha);
      // On a dark plate, in the structure's own colour: red letters straight on skin do not carry.
      text(ctx, tag.name, startX + side * 10, y, {
        size: tag.size, color: tag.color, alpha: tag.alpha, font: 'body', weight: 700, tracking: 0.12, align: side > 0 ? 'left' : 'right', plate: 1,
      });
    }
  }

  /**
   * Where a label should be drawn so that no HUD panel covers it: the wanted position, pushed the shortest
   * way out of any panel it would sit under and kept on the screen. The push eases, so a label slides clear
   * instead of jumping as the arm moves.
   */
  private clearOfPanels(index: number, x: number, y: number, halfWidth: number, halfHeight: number, frame: Frame): [number, number] {
    const margin = 14;
    let pushX = 0;
    let pushY = 0;
    for (const zone of this.scene.keepOut) {
      const left = zone.x0 - margin - halfWidth;
      const right = zone.x1 + margin + halfWidth;
      const top = zone.y0 - margin - halfHeight;
      const bottom = zone.y1 + margin + halfHeight;
      const cx = x + pushX;
      const cy = y + pushY;
      if (cx <= left || cx >= right || cy <= top || cy >= bottom) continue;
      // Out through the nearest side that keeps the label on the screen.
      const options: Array<[number, number]> = [];
      if (right + halfWidth < frame.width - 8) options.push([right - cx, 0]);
      if (left - halfWidth > 8) options.push([left - cx, 0]);
      if (bottom + halfHeight < frame.height - 8) options.push([0, bottom - cy]);
      if (top - halfHeight > 8) options.push([0, top - cy]);
      if (options.length === 0) continue;
      options.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
      pushX += options[0][0];
      pushY += options[0][1];
    }
    // Never off the edge of the picture either.
    const edgeX = clamp(x + pushX, halfWidth + 10, Math.max(halfWidth + 10, frame.width - halfWidth - 10));
    const edgeY = clamp(y + pushY, halfHeight + 10, Math.max(halfHeight + 10, frame.height - halfHeight - 10));
    const nudge = this.nudges[index];
    const k = damp(7, frame.dt);
    nudge[0] += (edgeX - x - nudge[0]) * k;
    nudge[1] += (edgeY - y - nudge[1]) * k;
    return [x + nudge[0], y + nudge[1]];
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

    const [tx, ty] = w.point(0, centre[Math.floor(centre.length / 2)][1] + halfWidth + 5.2);
    text(ctx, 'DANGER ZONE', tx, ty, {
      size: clamp(2.6 * px, 14.5, 18), color: C.red, alpha: alpha * (0.85 + 0.15 * pulse), font: 'body', weight: 800, tracking: 0.2, plate: 1,
    });
  }
}
