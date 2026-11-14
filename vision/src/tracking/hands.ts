import type { HandLandmarker } from '@mediapipe/tasks-vision';

export interface TrackedHand {
  /** 21 landmarks in video pixels (MediaPipe hand model order: 0 wrist, 4 thumb tip, 8 index tip, ...). */
  points: Array<{ x: number; y: number }>;
  /**
   * The point the hand is "working" with: the index fingertip, or the pinch point between thumb and index
   * when they are held together, as when holding an instrument.
   */
  tool: { x: number; y: number };
}

export type HandsState = 'off' | 'loading' | 'ready' | 'failed';

/**
 * Hand tracking with MediaPipe Hand Landmarker, running in the page (WebAssembly + GPU). The runtime and the
 * model are served locally (public/mediapipe, public/models: see scripts/setup.mjs), so it works offline.
 * Loaded lazily and optional: if it cannot start, the app carries on without it and says so.
 */
export class HandTracker {
  state: HandsState = 'off';
  detail = '';
  hands: TrackedHand[] = [];
  /** Milliseconds the last detection took. */
  lastMs = 0;

  /**
   * For checks only (dev/shot.mjs): pretend a fingertip is at this video position, so the "aligned" visuals
   * can be exercised with no hand in front of a camera.
   */
  debugTool: { x: number; y: number } | null = null;

  private landmarker: HandLandmarker | null = null;
  private lastTimestamp = 0;
  private skip = 0;
  private frame = 0;
  private lastSeen = 0;

  async start(): Promise<void> {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.state = 'loading';
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const create = (delegate: 'GPU' | 'CPU') =>
        vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        this.landmarker = await create('GPU');
      } catch {
        this.landmarker = await create('CPU');
      }
      this.state = 'ready';
    } catch (err) {
      this.state = 'failed';
      this.detail = err instanceof Error ? err.message : 'could not start';
      console.warn('[hands] hand tracking is off:', this.detail, '(run `npm run setup` in vision/ if the model is missing)');
    }
  }

  /** Look for hands in the current video frame. Cheap to call every frame; it paces itself if detection is slow. */
  detect(video: HTMLVideoElement, nowMs: number): void {
    if (this.debugTool) {
      const p = this.debugTool;
      // A rough right hand reaching up from below, index fingertip on the point.
      const shape = [
        [70, 210], [20, 190], [-25, 150], [-50, 110], [-62, 74],     // wrist, thumb
        [22, 96], [10, 58], [4, 28], [0, 0],                          // index
        [52, 88], [50, 44], [50, 14], [50, -10],                      // middle
        [80, 96], [86, 58], [90, 32], [92, 10],                       // ring
        [106, 116], [118, 88], [126, 68], [132, 50],                  // little
      ];
      this.hands = [{ points: shape.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })), tool: { x: p.x, y: p.y } }];
      this.lastSeen = nowMs;
      return;
    }
    if (this.state !== 'ready' || !this.landmarker || video.readyState < 2 || !video.videoWidth) return;

    // Hands seen a moment ago are forgotten if detection stops reporting them.
    if (nowMs - this.lastSeen > 350) this.hands = [];

    this.frame++;
    if (this.skip > 0 && this.frame % (this.skip + 1) !== 0) return;

    // MediaPipe needs strictly increasing timestamps.
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(nowMs));
    this.lastTimestamp = timestamp;

    const started = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestamp);
    } catch (err) {
      // A bad frame (source switching) must not end tracking.
      return;
    }
    this.lastMs = performance.now() - started;
    // Slow machine or CPU fallback: look at every second or third frame instead of holding up the picture.
    this.skip = this.lastMs > 40 ? 2 : this.lastMs > 22 ? 1 : 0;

    const w = video.videoWidth;
    const h = video.videoHeight;
    const hands: TrackedHand[] = [];
    for (const landmarks of result.landmarks) {
      if (landmarks.length < 21) continue;
      const points = landmarks.map((p) => ({ x: p.x * w, y: p.y * h }));
      const thumb = points[4];
      const index = points[8];
      // Hand size (wrist to the base of the middle finger) tells us what "close together" means here.
      const span = Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y);
      const pinching = Math.hypot(thumb.x - index.x, thumb.y - index.y) < span * 0.45;
      const tool = pinching ? { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 } : { x: index.x, y: index.y };
      hands.push({ points, tool });
    }
    if (hands.length > 0) this.lastSeen = nowMs;
    this.hands = hands;
  }
}
