import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/** Body-skin class of MediaPipe's multiclass selfie segmenter (0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 other). */
const BODY_SKIN = 2;

export type SkinSource = 'segmenter' | 'segmenter+colour' | 'colour' | 'none';

/**
 * Where the skin is in the current frame, as a small mask (1 = skin), from MediaPipe's multiclass selfie
 * segmenter (its body-skin class, so faces are left out). Until the model has loaded, or if it cannot run,
 * a plain skin-colour rule stands in, so Arm mode always has something to work with.
 *
 * Runs on a downscaled copy of the raw video frame: the drawn overlays are never part of what it sees.
 */
export class SkinMask {
  /** Mask size. The frame is squeezed to this size before segmenting; coordinates scale back to video pixels. */
  readonly width = 256;
  readonly height = 144;
  /** 1 where there is skin. */
  readonly mask = new Uint8Array(256 * 144);
  /** The skin-colour rule's answer, and the segmenter's class for each pixel. */
  private colour = new Uint8Array(256 * 144);
  private labels = new Uint8Array(256 * 144);
  private bgConfidence = new Float32Array(256 * 144);
  private scratch = new Uint8Array(256 * 144);
  /** Skin-coloured pixels count unless the segmenter is at least this sure they are background. */
  maxBackground = 0.85;
  source: SkinSource = 'none';
  state: 'off' | 'loading' | 'ready' | 'failed' = 'off';
  /** Milliseconds the last segmentation took. */
  lastMs = 0;
  /** performance.now() of the last mask (0 = none yet). */
  updatedAt = 0;
  /** Segment every other frame (set while an arm is locked: the fit still runs every frame on the latest mask). */
  halfRate = false;
  /** How many pixels of each class the segmenter reported in the last frame (debug view). */
  classCounts = [0, 0, 0, 0, 0, 0];

  private segmenter: ImageSegmenter | null = null;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private lastTimestamp = 0;
  private skip = 0;
  private frame = 0;

  constructor() {
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false })!;
  }

  async start(): Promise<void> {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.state = 'loading';
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const create = (delegate: 'GPU' | 'CPU') =>
        vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/selfie_multiclass_256x256.tflite', delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: true,
        });
      try {
        this.segmenter = await create('GPU');
      } catch {
        this.segmenter = await create('CPU');
      }
      this.state = 'ready';
    } catch (err) {
      this.state = 'failed';
      console.warn('[arm] skin segmenter is off, using skin colour instead:', err instanceof Error ? err.message : err);
    }
  }

  /** Update the mask from the current video frame. Returns false if there was no frame to look at. */
  update(video: HTMLVideoElement, nowMs: number): boolean {
    if (video.readyState < 2 || !video.videoWidth) return false;
    this.frame++;
    if ((this.skip > 0 || this.halfRate) && this.frame % 2 !== 0) return false;
    const started = performance.now();
    try {
      this.ctx.drawImage(video, 0, 0, this.width, this.height);
    } catch {
      return false;
    }

    // Skin colour everywhere first: cheap, and the segmenter's answer is checked against it.
    this.colourRule();
    let done = false;
    if (this.segmenter && this.state === 'ready') {
      const timestamp = Math.max(this.lastTimestamp + 1, Math.round(nowMs));
      this.lastTimestamp = timestamp;
      try {
        this.segmenter.segmentForVideo(this.canvas, timestamp, (result) => {
          const category = result.categoryMask;
          const background = result.confidenceMasks?.[0];
          if (!category) return;
          const classes = category.getAsUint8Array();
          const bg = background ? background.getAsFloat32Array() : null;
          const cw = category.width, ch = category.height;
          const same = cw === this.width && ch === this.height;
          const counts = this.classCounts;
          counts.fill(0);
          const labels = this.labels, doubt = this.bgConfidence;
          for (let y = 0, i = 0; y < this.height; y++) {
            const row = same ? y * cw : Math.min(ch - 1, Math.floor(((y + 0.5) * ch) / this.height)) * cw;
            for (let x = 0; x < this.width; x++, i++) {
              const q = row + (same ? x : Math.min(cw - 1, Math.floor(((x + 0.5) * cw) / this.width)));
              const c = classes[q];
              labels[i] = c;
              doubt[i] = bg && bg.length === classes.length ? bg[q] : c === 0 ? 1 : 0;
              counts[Math.min(5, c)]++;
            }
          }
          done = true;
        });
      } catch {
        // A bad frame (input switching): the colour rule stands in for this one.
      }
    }
    if (done) {
      // The model is trained on selfies: a forearm on its own is often called "clothes" or even, with less
      // conviction, "background". So: body skin as it says, plus anything skin-coloured that it is not sure is
      // background (a beige wall is confidently background; a lone forearm is not). Faces never count.
      const counts = this.classCounts;
      const mask = this.mask, colour = this.colour, labels = this.labels, doubt = this.bgConfidence;
      let fromSkin = 0, fromColour = 0;
      for (let i = 0; i < mask.length; i++) {
        const c = labels[i];
        const skin = c === BODY_SKIN ? 1 : c !== 3 && c !== 1 && colour[i] && doubt[i] < this.maxBackground ? 2 : 0;
        mask[i] = skin ? 1 : 0;
        if (skin === 1) fromSkin++;
        else if (skin === 2) fromColour++;
      }
      void counts;
      this.source = fromSkin >= fromColour ? 'segmenter' : 'segmenter+colour';
    } else {
      this.mask.set(this.colour);
      this.source = 'colour';
    }
    this.close();
    this.lastMs = performance.now() - started;
    this.skip = this.lastMs > 30 ? 1 : 0;
    this.updatedAt = nowMs;
    return true;
  }

  /** Closing (grow by a pixel, then shrink by one): ink marks and thin gaps no longer split the arm in two. */
  private close(): void {
    const w = this.width, h = this.height;
    const mask = this.mask, tmp = this.scratch;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        tmp[i] = mask[i] || (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w]) ? 1 : 0;
      }
    }
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        mask[i] = tmp[i] && (x === 0 || tmp[i - 1]) && (x === w - 1 || tmp[i + 1]) && (y === 0 || tmp[i - w]) && (y === h - 1 || tmp[i + w]) ? 1 : 0;
      }
    }
  }

  /** Classic skin-colour rule in YCbCr (works across skin tones under ordinary light). */
  private colourRule(): void {
    const data = this.ctx.getImageData(0, 0, this.width, this.height).data;
    const mask = this.colour;
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      // Wider than the textbook box on the warm side: skin under warm light, or a camera with a warm white
      // balance, reaches Cr 190. Marker red and lipstick sit higher still.
      mask[p] = y > 40 && cb > 70 && cb < 130 && cr > 134 && cr < 192 ? 1 : 0;
    }
  }
}
