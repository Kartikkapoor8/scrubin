import type { InputSource, SourceStatus } from './types';

/**
 * A drawn stand-in for the headset's view: a forearm on a dark drape with a green marker "wound", seen from
 * a gently moving head. It needs no camera, no file and no network, so it is the fallback that always works
 * and the scene used for automated checks. The proportions match what the HoloLens camera sees at about
 * 0.65 m (roughly 2.4 video pixels per millimetre), so overlays tuned here hold up on the real stream.
 */
export class SimulatedSource implements InputSource {
  readonly kind = 'sim' as const;
  readonly label = 'Simulated arm';

  static readonly WIDTH = 1280;
  static readonly HEIGHT = 720;
  static readonly PX_PER_MM = 2.4;

  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private noise: HTMLCanvasElement;
  private stream: MediaStream | null = null;
  private timer = 0;
  private startedAt = 0;
  private woundWobble: number[] = [];

  /** Marker colour of the drawn wound. Change it to rehearse with a different marker. */
  markerColor = 'rgb(46, 214, 92)';
  /** Draw the cyan hologram cage the HoloLens app leaves on the arm, as it would appear in the real stream. */
  showHologram = true;
  /**
   * Worst case for the tracker (?sim=body): a glowing holographic body over the table, drawn in cyan, mint
   * and, deliberately, in the marker's own green, including a stroke the same length as the wound.
   */
  showBody = new URLSearchParams(location.search).get('sim') === 'body';
  /** Hide the marker line (?marker=0): with the holograms on, the tracker must then find nothing at all. */
  showMarker = new URLSearchParams(location.search).get('marker') !== '0';

  constructor() {
    this.canvas.width = SimulatedSource.WIDTH;
    this.canvas.height = SimulatedSource.HEIGHT;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.noise = makeNoise(256);
    // A hand-drawn line is never perfectly straight: fix a little wobble once.
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i <= 12; i++) this.woundWobble.push((random() - 0.5) * 1.6);
  }

  start(video: HTMLVideoElement, onStatus: (status: SourceStatus) => void): void {
    this.startedAt = performance.now();
    this.draw(0);
    this.stream = this.canvas.captureStream(30);
    video.removeAttribute('src');
    video.srcObject = this.stream;
    // A timer rather than requestAnimationFrame, so the scene keeps moving in a background tab.
    this.timer = window.setInterval(() => this.draw((performance.now() - this.startedAt) / 1000), 1000 / 30);
    video.play()
      .then(() => onStatus({ state: 'live', detail: '' }))
      .catch(() => onStatus({ state: 'live', detail: '' }));
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private draw(t: number): void {
    const ctx = this.ctx;
    const W = SimulatedSource.WIDTH;
    const H = SimulatedSource.HEIGHT;
    const mm = SimulatedSource.PX_PER_MM;

    // Head motion: a slow drift plus a faint tremor, like a camera worn on the head.
    const camX = Math.sin(t * 0.31) * 26 + Math.sin(t * 1.7) * 2.2 + Math.sin(t * 7.3) * 0.5;
    const camY = Math.cos(t * 0.23) * 14 + Math.sin(t * 2.3) * 1.6 + Math.cos(t * 6.1) * 0.4;
    const camRoll = Math.sin(t * 0.19) * 0.022;
    const camZoom = 1 + Math.sin(t * 0.13) * 0.035;

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // The drape.
    const drape = ctx.createRadialGradient(W * 0.52, H * 0.46, 60, W * 0.5, H * 0.5, W * 0.72);
    drape.addColorStop(0, '#2b4a57');
    drape.addColorStop(0.55, '#1b3340');
    drape.addColorStop(1, '#0c1b24');
    ctx.fillStyle = drape;
    ctx.fillRect(0, 0, W, H);

    ctx.translate(W / 2 + camX, H / 2 + camY);
    ctx.rotate(camRoll);
    ctx.scale(camZoom, camZoom);

    // Folds in the drape, so the background visibly moves with the head.
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#0a141b';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-900, i * 150 - 60);
      ctx.bezierCurveTo(-300, i * 150 + 30, 300, i * 150 - 80, 900, i * 150 + 20);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // The arm lies across the view, wrist to the left, elbow to the right, tilted a little.
    ctx.rotate(-0.09);
    const length = 260 * mm;
    const wristHalf = 32.5 * mm;
    const elbowHalf = 42.5 * mm;
    const x0 = -121 * mm; // the wound centre sits at the origin, 121 mm from the wrist
    const x1 = x0 + length;

    // One silhouette: fingers off the left edge, palm with the thumb's bulge on the far side, the narrow
    // wrist, the forearm widening to the elbow, and the upper arm running off the right edge.
    const palmHalf = 43 * mm;
    const armPath = () => {
      ctx.beginPath();
      ctx.moveTo(x0 - 900, -palmHalf * 0.96);
      ctx.lineTo(x0 - 250, -palmHalf);
      ctx.bezierCurveTo(x0 - 210, -palmHalf * 1.5, x0 - 120, -palmHalf * 1.42, x0 - 78, -palmHalf * 0.98);
      ctx.bezierCurveTo(x0 - 50, -wristHalf * 1.12, x0 - 22, -wristHalf * 1.02, x0, -wristHalf);
      ctx.bezierCurveTo(x0 + length * 0.2, -wristHalf * 0.98, x0 + length * 0.36, -wristHalf * 1.2, x0 + length * 0.55, -elbowHalf * 0.98);
      ctx.bezierCurveTo(x0 + length * 0.8, -elbowHalf * 1.04, x1 + 60, -elbowHalf * 1.02, x1 + 900, -elbowHalf * 1.22);
      ctx.lineTo(x1 + 900, elbowHalf * 1.22);
      ctx.bezierCurveTo(x1 + 60, elbowHalf * 1.02, x0 + length * 0.8, elbowHalf * 1.04, x0 + length * 0.55, elbowHalf * 0.98);
      ctx.bezierCurveTo(x0 + length * 0.36, wristHalf * 1.2, x0 + length * 0.2, wristHalf * 0.98, x0, wristHalf);
      ctx.bezierCurveTo(x0 - 30, wristHalf * 1.04, x0 - 70, palmHalf * 0.92, x0 - 130, palmHalf);
      ctx.lineTo(x0 - 900, palmHalf * 0.96);
      ctx.closePath();
    };

    // Soft shadow under the arm.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 22;
    ctx.fillStyle = '#000';
    armPath();
    ctx.fill();
    ctx.restore();

    // Skin: lit from above, rolling off into shade toward both edges like a rounded limb.
    const skin = ctx.createLinearGradient(0, -elbowHalf * 1.25, 0, elbowHalf * 1.25);
    skin.addColorStop(0, '#7c5340');
    skin.addColorStop(0.16, '#b98568');
    skin.addColorStop(0.4, '#deb193');
    skin.addColorStop(0.56, '#d8a98a');
    skin.addColorStop(0.84, '#a87558');
    skin.addColorStop(1, '#6b4534');
    ctx.fillStyle = skin;
    ctx.filter = 'blur(1.4px)';
    armPath();
    ctx.fill();
    ctx.filter = 'none';

    ctx.save();
    armPath();
    ctx.clip();

    // Skin texture and the heel of the palm at the wrist end.
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = ctx.createPattern(this.noise, 'repeat')!;
    ctx.fillRect(x0 - 900, -elbowHalf * 1.6, length + 1800, elbowHalf * 3.2);
    ctx.globalAlpha = 1;

    // The palm is paler and a little pink; the muscle belly of the forearm catches more light.
    const palm = ctx.createRadialGradient(x0 - 170, 0, 20, x0 - 170, 0, 230);
    palm.addColorStop(0, 'rgba(240, 190, 170, 0.5)');
    palm.addColorStop(1, 'rgba(240, 190, 170, 0)');
    ctx.fillStyle = palm;
    ctx.fillRect(x0 - 420, -260, 480, 520);
    const belly = ctx.createRadialGradient(x0 + length * 0.62, -10, 20, x0 + length * 0.62, -10, 260);
    belly.addColorStop(0, 'rgba(255, 226, 205, 0.16)');
    belly.addColorStop(1, 'rgba(255, 226, 205, 0)');
    ctx.fillStyle = belly;
    ctx.fillRect(x0, -260, length + 300, 520);

    // Wrist creases.
    ctx.strokeStyle = 'rgba(120, 76, 56, 0.45)';
    ctx.lineWidth = 1.6;
    for (const dx of [0, 9]) {
      ctx.beginPath();
      ctx.moveTo(x0 + dx, -wristHalf * 0.86);
      ctx.quadraticCurveTo(x0 + dx - 7, 0, x0 + dx, wristHalf * 0.86);
      ctx.stroke();
    }

    // A couple of faint veins, so the skin is not a flat fill.
    ctx.strokeStyle = 'rgba(92, 120, 150, 0.09)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x0 + 20, 26);
    ctx.bezierCurveTo(x0 + 180, 44, x0 + 330, 8, x1, 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + 200, -34);
    ctx.bezierCurveTo(x0 + 320, -56, x0 + 470, -30, x1, -62);
    ctx.stroke();

    // The marker "laceration": 42 mm along the arm, drawn by hand with a bright marker.
    const half = 21 * mm;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokeWound = () => {
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const x = -half + (i / 12) * half * 2;
        const y = this.woundWobble[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    if (this.showMarker) {
      ctx.strokeStyle = 'rgba(20, 90, 40, 0.35)';
      ctx.lineWidth = 7.5;
      strokeWound();
      ctx.strokeStyle = this.markerColor;
      ctx.lineWidth = 4.6;
      strokeWound();
    }
    ctx.restore();

    const armTransform = ctx.getTransform();

    // What the HoloLens app adds to the picture once its outline is placed: a quiet cyan cage on the arm.
    if (this.showHologram) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = 'rgba(63, 224, 255, 0.5)';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(x0, -wristHalf);
      ctx.bezierCurveTo(x0 + length * 0.2, -wristHalf * 0.98, x0 + length * 0.36, -wristHalf * 1.2, x0 + length * 0.55, -elbowHalf * 0.98);
      ctx.bezierCurveTo(x0 + length * 0.8, -elbowHalf * 1.04, x1 - 20, -elbowHalf * 1.02, x1, -elbowHalf * 1.03);
      ctx.moveTo(x0, wristHalf);
      ctx.bezierCurveTo(x0 + length * 0.2, wristHalf * 0.98, x0 + length * 0.36, wristHalf * 1.2, x0 + length * 0.55, elbowHalf * 0.98);
      ctx.bezierCurveTo(x0 + length * 0.8, elbowHalf * 1.04, x1 - 20, elbowHalf * 1.02, x1, elbowHalf * 1.03);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(63, 224, 255, 0.3)';
      ctx.lineWidth = 1.1;
      for (let i = 0; i <= 8; i++) {
        const x = x0 + (length * i) / 8;
        if (x > -half - 12 * mm && x < half + 12 * mm) continue; // the app clears the contours over the wound
        const k = i / 8;
        const halfWidth = (wristHalf + (elbowHalf - wristHalf) * (k * k * (3 - 2 * k))) * (i === 0 || i === 8 ? 1 : 1.02);
        ctx.beginPath();
        ctx.moveTo(x, -halfWidth);
        ctx.quadraticCurveTo(x + 14, 0, x, halfWidth);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Lens falloff and a little sensor noise, like a real small camera.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.045;
    ctx.globalCompositeOperation = 'overlay';
    const ox = Math.floor((t * 977) % 256);
    const oy = Math.floor((t * 613) % 256);
    ctx.translate(-ox, -oy);
    ctx.fillStyle = ctx.createPattern(this.noise, 'repeat')!;
    ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Holograms are added by the headset on top of the camera picture, so they are not dimmed by the lens.
    ctx.setTransform(armTransform);
    if (this.showBody) {
      // Light added on top of the picture, the way the headset's capture shows holograms.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const glowLine = (color: string, width: number, points: number[]) => {
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
        ctx.stroke();
      };
      const sway = Math.sin(t * 0.6) * 6;
      // A torso and an upper arm in outline, above and around the real arm.
      glowLine('rgba(63, 224, 255, 0.9)', 3, [x0 - 240, -250 + sway, x0 + 120, -300 + sway, x1 + 200, -260 + sway]);
      glowLine('rgba(63, 224, 255, 0.9)', 3, [x0 - 200, 250, x0 + 200, 280, x1 + 220, 250]);
      glowLine('rgba(77, 255, 176, 0.95)', 3, [x0 + 60, -190 + sway, x0 + 300, -210 + sway, x1 - 60, -180 + sway]);
      glowLine('rgba(77, 255, 176, 0.95)', 3, [x1 - 40, -170, x1 + 120, -60, x1 + 150, 90]);
      // The hard ones: the marker's own green, as light. One over the drape, one across the skin, and one the
      // length of the wound lying right next to it.
      glowLine('rgba(60, 255, 40, 0.95)', 4, [x0 + 40, 200, x0 + 150, 196]);
      glowLine('rgba(60, 255, 40, 0.95)', 4, [-half, 34, half, 30]);
      glowLine('rgba(60, 255, 40, 0.95)', 4, [x0 - 160, -200 + sway, x0 - 50, -214 + sway]);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function makeNoise(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  let seed = 1234567;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed >> 16) & 0xff;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
