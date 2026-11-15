import type { Sounds } from '../app/audio';
import type { Scene } from '../app/scene';
import { add, clamp, el, ease } from '../core/dom';
import type { Viewport } from '../core/viewport';
import { C, css, glow, monoWidth, segment, text, textHeight } from '../overlay/draw';
import type { HandTracker } from '../tracking/hands';
import type { Hud, StatusChip } from '../ui/hud';
import type { ExoPlacement } from './exo';
import { FOREARM_WIDTH_MM, ForearmFitter, ForearmTracker } from './forearm';
import { SkinMask } from './skin';

/**
 * Arm mode: the backup demo that needs only a forearm in front of a camera (the HoloLens stream or the Mac
 * webcam). A holographic exoskeleton assembles around the forearm, red marker "cuts" on it are measured and
 * given a suture plan, and the Gemini attending walks through it. Toggled with M, or ?mode=arm.
 *
 * It reuses the app around it: inputs, hand tracking, captions, the attending, presenter keys and the phone
 * remote. What it draws lives in three canvases between the picture and the HUD: a soft shadow under the
 * hologram, the hologram itself (three.js with bloom), and crisp labels on top.
 */
export class ArmMode {
  active = false;
  readonly skin = new SkinMask();
  readonly tracker = new ForearmTracker();
  private fitter = new ForearmFitter(this.skin.width, this.skin.height);
  /** The three.js layer, loaded the first time Arm mode is switched on (the table demo never pays for it). */
  private exo: ExoLike = standIn();
  private exoLoading = false;
  private under: HTMLCanvasElement;
  private over: HTMLCanvasElement;
  private underCtx: CanvasRenderingContext2D;
  private overCtx: CanvasRenderingContext2D;
  private idle: HTMLDivElement;
  private chip: StatusChip;
  private corner: HTMLElement | null;
  private cornerTable = '';
  private width = 0;
  private height = 0;
  private ratio = 1;
  private lastMaskAt = 0;
  private absentFor = 99;
  private wasPresent = false;
  private lastPlace: ExoPlacement | null = null;
  private debugCanvas = document.createElement('canvas');
  private fitMs = 0;
  private strength = 1;

  constructor(
    private stage: HTMLElement,
    private hud: Hud,
    private scene: Scene,
    private view: Viewport,
    private hands: HandTracker,
    private sounds: Sounds,
  ) {
    const before = hud.root;
    this.under = el('canvas', 'arm-canvas arm-canvas--under');
    stage.insertBefore(this.under, before);
    this.over = el('canvas', 'arm-canvas arm-canvas--over');
    stage.insertBefore(this.over, before);
    this.underCtx = this.under.getContext('2d')!;
    this.overCtx = this.over.getContext('2d')!;

    this.idle = add(hud.root, el('div', 'arm-idle'));
    const box = add(this.idle, el('div', 'arm-idle__box'));
    // A forearm and an open hand, palm up, with rings that close round it in turn and a scan passing along.
    box.innerHTML =
      '<svg class="arm-idle__glyph" viewBox="0 0 240 90" aria-hidden="true">' +
      '<path class="arm-idle__arm" d="M238 26 L150 31 C134 32 122 33 112 35 C106 33 100 30 94 26 C90 23 84 18 78 17 ' +
      'C73 16 71 21 75 24 C80 28 84 31 86 34 L70 34 C56 33 40 33 26 34 C16 35 13 43 17 46 C13 49 16 56 26 56 ' +
      'C40 57 56 58 70 59 C84 62 98 61 112 56 C122 57 134 58 150 59 L238 64"/>' +
      '<path class="arm-idle__ring" d="M128 31 C134 31 134 60 128 60"/>' +
      '<path class="arm-idle__ring" d="M158 28 C164 28 164 63 158 63"/>' +
      '<path class="arm-idle__ring" d="M188 27 C194 27 194 64 188 64"/>' +
      '<path class="arm-idle__ring" d="M218 25 C224 25 224 66 218 66"/>' +
      '<line class="arm-idle__scan" x1="114" y1="18" x2="114" y2="72"/>' +
      '</svg>';
    add(box, el('div', 'arm-idle__title', 'Show an arm'));
    add(box, el('div', 'arm-idle__rule'));
    add(box, el('div', 'arm-idle__sub', 'Hold a forearm in view, palm up'));

    this.chip = hud.addChip('Show an arm');
    this.chip.show(false);
    this.corner = hud.root.querySelector('.corner-label');
    this.cornerTable = this.corner?.textContent || '';
  }

  toggle(): void {
    this.setActive(!this.active);
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.stage.classList.toggle('stage--arm', on);
    this.chip.show(on);
    if (this.corner) this.corner.textContent = on ? 'Training simulator · concept' : this.cornerTable;
    this.reset();
    if (on) {
      void this.skin.start();
      this.loadExo();
    }
    if (!on) this.clear();
  }

  private loadExo(): void {
    if (this.exoLoading) return;
    this.exoLoading = true;
    import('./exo')
      .then(({ ExoLayer }) => { this.exo = new ExoLayer(this.stage, this.over); })
      .catch((err) => console.warn('[arm] the exoskeleton could not load:', err));
  }

  /** Back to "Show an arm" at once. */
  reset(): void {
    this.tracker.reset();
    this.exo.snapOff();
    this.absentFor = 99;
    this.wasPresent = false;
    this.lastPlace = null;
  }

  /** Presenter's Next (the plan walkthrough arrives in a later milestone). */
  next(): void {}

  back(): void {}

  /** Once per video frame, on the raw picture (nothing drawn is part of it). */
  analyze(video: HTMLVideoElement, nowMs: number): void {
    if (!this.active) return;
    // Segmenting is the costly part; once the arm is locked it runs every other frame, and the fit (cheap)
    // runs every frame on the latest mask with this frame's hand landmarks.
    this.skin.halfRate = this.tracker.present;
    this.skin.update(video, nowMs);
    if (!this.skin.updatedAt || video.readyState < 2 || !video.videoWidth) return;
    const dt = this.lastMaskAt ? clamp((nowMs - this.lastMaskAt) / 1000, 0.001, 0.25) : 1 / 30;
    this.lastMaskAt = nowMs;
    const started = performance.now();
    const fit = this.fitter.fit(this.skin.mask, this.hands.hands, video.videoWidth, video.videoHeight, this.tracker.prior, this.tracker.anchorOnPrior);
    this.fitMs = performance.now() - started;
    this.tracker.update(fit, dt);
  }

  /** Once per display frame. */
  draw(t: number, dt: number): void {
    if (!this.active) return;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    this.resize(w, h);
    this.exo.resize(w, h);
    const visible = !this.scene.hidden;
    const present = this.tracker.present;

    if (present && !this.wasPresent) this.sounds.lock();
    this.wasPresent = present;
    this.absentFor = present || this.tracker.seenFor > 0.05 ? 0 : this.absentFor + dt;

    const place = present ? this.placement() : this.lastPlace;
    if (present && place) this.lastPlace = place;
    // Out of sight but not yet given up on (the hysteresis second): the hologram holds, dimmed.
    const holding = present && this.tracker.missingFor > 0.15;
    this.strength += ((holding ? 0.42 : 1) - this.strength) * (1 - Math.exp(-dt * (holding ? 5 : 8)));
    this.exo.update(t, dt, present, place, visible, this.strength);

    const u = this.underCtx, o = this.overCtx;
    u.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    u.clearRect(0, 0, w, h);
    o.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    o.clearRect(0, 0, w, h);
    const shown = clamp(this.exo.clock / 0.5, 0, 1) * this.strength;
    if (visible && place && shown > 0) {
      this.drawShadow(u, place, shown);
      this.drawCallout(o, place, t);
    }
    if (this.scene.debug) this.drawDebug(o);

    // "Show an arm" once nothing has been in view for a moment.
    this.idle.classList.toggle('arm-idle--on', visible && this.absentFor > 0.8 && this.exo.idle);
    if (present) this.chip.set('Arm locked', 'ok');
    else if (this.tracker.seenFor > 0.05) this.chip.set('Arm found · locking', 'busy');
    else this.chip.set('Show an arm', 'off');
  }

  /** For checks from the console and dev/shot.mjs. */
  debugInfo(): Record<string, unknown> {
    const p = this.tracker.pose;
    return {
      active: this.active, present: this.tracker.present, seenFor: +this.tracker.seenFor.toFixed(2),
      skin: this.skin.source, skinState: this.skin.state, skinMs: +this.skin.lastMs.toFixed(1), fitMs: +this.fitMs.toFixed(1),
      wrist: [Math.round(p.wx), Math.round(p.wy)], angleDeg: Math.round((Math.atan2(p.uy, p.ux) * 180) / Math.PI),
      lengthPx: Math.round(p.length), midWidthPx: Math.round(p.midWidth), pxPerMm: +p.pxPerMm.toFixed(2), fromHand: p.fromHand,
      exoClock: +this.exo.clock.toFixed(2), exoAssembled: this.exo.assembled, exoOk: this.exo.ok, exoFps: this.exo.rendered,
    };
  }

  /** Captures what the audience sees of Arm mode (for the attending's look at the view). */
  get layers(): HTMLCanvasElement[] {
    return [this.under, this.exo.canvas, this.over];
  }

  private clear(): void {
    this.underCtx.clearRect(0, 0, this.under.width, this.under.height);
    this.overCtx.clearRect(0, 0, this.over.width, this.over.height);
    this.exo.update(0, 0, false, null, false);
    this.idle.classList.remove('arm-idle--on');
  }

  private resize(w: number, h: number): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.width && h === this.height && ratio === this.ratio) return;
    this.width = w;
    this.height = h;
    this.ratio = ratio;
    for (const canvas of [this.under, this.over]) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
  }

  /** The tracked forearm on the stage. */
  private placement(): ExoPlacement {
    const p = this.tracker.pose;
    const view = this.view;
    const k = view.scale;
    const tracker = this.tracker;
    // Never shorter than a plausible forearm, and running on past the edge when the arm does, so the far
    // joint is not drawn at the edge of the picture as if the elbow were there.
    const length = Math.max(p.length * (p.endInFrame ? 1 : 1.14), p.midWidth * 2.6);
    return {
      x: view.toScreenX(p.wx),
      y: view.toScreenY(p.wy),
      ux: p.ux,
      uy: p.uy,
      length: length * k,
      widthAt: (f: number) => tracker.widthAt(f) * k,
    };
  }

  /** A soft dark band under the hologram, so its light reads on bright skin. */
  private drawShadow(ctx: CanvasRenderingContext2D, p: ExoPlacement, alpha: number): void {
    const nx = -p.uy, ny = p.ux;
    const steps = 8;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const half = (p.widthAt(f) / 2) * 1.12;
      const cx = p.x + p.ux * f * p.length, cy = p.y + p.uy * f * p.length;
      left.push([cx + nx * half, cy + ny * half]);
      right.push([cx - nx * half, cy - ny * half]);
    }
    ctx.save();
    ctx.filter = `blur(${Math.max(6, Math.round(p.widthAt(0.5) * 0.12))}px)`;
    ctx.fillStyle = css(C.ink, 0.26 * alpha);
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [x, y] of left.slice(1)) ctx.lineTo(x, y);
    for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** "Forearm locked" with the estimated size, on a leader from the arm, once the exoskeleton has assembled. */
  private drawCallout(ctx: CanvasRenderingContext2D, p: ExoPlacement, t: number): void {
    const appear = ease.outCubic(clamp((this.exo.clock - 1.6) / 0.7, 0, 1)) * this.strength;
    if (appear <= 0) return;
    const pose = this.tracker.pose;
    const f = 0.62;
    const ax = p.x + p.ux * f * p.length, ay = p.y + p.uy * f * p.length;
    // Out to the side with more room on the screen (above the arm when there is a choice).
    let nx = -p.uy, ny = p.ux;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const half = p.widthAt(f) / 2;
    const reach = 0.06 * this.height + 16;
    let sx = ax + nx * (half + 10), sy = ay + ny * (half + 10);
    let ex = ax + nx * (half + reach), ey = ay + ny * (half + reach);
    if (ey < this.height * 0.16) {
      // No room above: go below instead.
      sx = ax - nx * (half + 10); sy = ay - ny * (half + 10);
      ex = ax - nx * (half + reach); ey = ay - ny * (half + reach);
    }
    const lead = ease.inOutCubic(clamp(appear * 1.4, 0, 1));
    glow(ctx, segment(sx, sy, sx + (ex - sx) * lead, sy + (ey - sy) * lead), C.cyan, { width: 1.3, alpha: appear, bloom: 0.6 });
    const title = 'FOREARM LOCKED';
    const widthMm = Math.round(FOREARM_WIDTH_MM);
    const lengthCm = (pose.length / Math.max(0.1, pose.pxPerMm) / 10).toFixed(0);
    const detail = `${widthMm} mm wide est. · ${lengthCm} cm in view`;
    const size = 16;
    const w = Math.max(monoWidth(title, size, 0.16), monoWidth(detail, size * 0.8, 0.06));
    const right = ex + w + 20 < this.width;
    const tx = right ? ex + 10 : ex - 10;
    const align: CanvasTextAlign = right ? 'left' : 'right';
    glow(ctx, segment(ex, ey, right ? ex + 6 : ex - 6, ey), C.cyan, { width: 1.3, alpha: appear, bloom: 0.6 });
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    text(ctx, title, tx, ey - textHeight(size) * 0.45, { size, color: C.cyan, alpha: appear * pulse, align, weight: 600, tracking: 0.16 });
    text(ctx, detail, tx, ey + textHeight(size) * 0.62, { size: size * 0.8, color: C.white, alpha: appear * 0.9, align, tracking: 0.06 });
  }

  /** Key D: the skin mask, the pixels the fit used, the axis and the widths. */
  private drawDebug(ctx: CanvasRenderingContext2D): void {
    const mw = this.skin.width, mh = this.skin.height;
    if (this.debugCanvas.width !== mw) { this.debugCanvas.width = mw; this.debugCanvas.height = mh; }
    const dctx = this.debugCanvas.getContext('2d')!;
    const image = dctx.createImageData(mw, mh);
    const used = this.fitter.used;
    for (let i = 0; i < this.skin.mask.length; i++) {
      if (!this.skin.mask[i]) continue;
      const q = i * 4;
      if (used[i]) { image.data[q] = 77; image.data[q + 1] = 255; image.data[q + 2] = 176; image.data[q + 3] = 110; }
      else { image.data[q] = 63; image.data[q + 1] = 224; image.data[q + 2] = 255; image.data[q + 3] = 60; }
    }
    dctx.putImageData(image, 0, 0);
    const v = this.view;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.debugCanvas, v.toScreenX(0), v.toScreenY(0), v.videoW * v.scale, v.videoH * v.scale);
    ctx.restore();
    const p = this.tracker.pose;
    if (this.tracker.seenFor > 0 || this.tracker.present) {
      const x0 = v.toScreenX(p.wx), y0 = v.toScreenY(p.wy);
      const L = p.length * v.scale;
      glow(ctx, segment(x0, y0, x0 + p.ux * L, y0 + p.uy * L), C.amber, { width: 1.5, halo: 0 });
      for (const f of [0.08, 0.5, 0.92]) {
        const half = (this.tracker.widthAt(f) * v.scale) / 2;
        const cx = x0 + p.ux * f * L, cy = y0 + p.uy * f * L;
        glow(ctx, segment(cx - p.uy * half, cy + p.ux * half, cx + p.uy * half, cy - p.ux * half), C.amber, { width: 1.2, halo: 0 });
      }
    }
    const lines = [
      `ARM  skin ${this.skin.source} ${this.skin.lastMs.toFixed(1)} ms  fit ${this.fitMs.toFixed(1)} ms  ${p.fromHand ? 'wrist from hand' : 'wrist held / from shape'}`,
      `present ${this.tracker.present ? 'yes' : 'no'}  seen ${this.tracker.seenFor.toFixed(2)} s  width ${p.midWidth.toFixed(0)} px = ${FOREARM_WIDTH_MM} mm  ${p.pxPerMm.toFixed(2)} px/mm  exo ${this.exo.rendered} fps`,
    ];
    lines.forEach((line, i) => text(ctx, line, 24, this.height * 0.2 + i * 18, { size: 11, align: 'left', color: C.amber }));
  }
}

/** What Arm mode needs from the exoskeleton layer (ExoLayer, or the stand-in until it has loaded). */
interface ExoLike {
  readonly canvas: HTMLCanvasElement;
  clock: number;
  ok: boolean;
  rendered: number;
  readonly idle: boolean;
  readonly assembled: boolean;
  snapOff(): void;
  resize(width: number, height: number): void;
  update(t: number, dt: number, present: boolean, place: ExoPlacement | null, visible: boolean, strength?: number): void;
}

function standIn(): ExoLike {
  return {
    canvas: document.createElement('canvas'), clock: 0, ok: true, rendered: 0, idle: true, assembled: false,
    snapOff() {}, resize() {}, update() {},
  };
}
