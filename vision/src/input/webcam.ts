import type { InputSource, SourceStatus } from './types';

/** The Mac's camera (or any camera plugged into it). The fallback when the headset stream is not available. */
export class WebcamSource implements InputSource {
  readonly kind = 'webcam' as const;
  readonly label = 'Webcam';

  private stream: MediaStream | null = null;
  private stopped = true;
  private retryTimer = 0;

  /** deviceId of the camera to use; empty = the system default. */
  constructor(private deviceId = '') {}

  start(video: HTMLVideoElement, onStatus: (status: SourceStatus) => void): void {
    this.stopped = false;
    onStatus({ state: 'starting', detail: 'Opening the camera' });
    void this.open(video, onStatus);
  }

  private async open(video: HTMLVideoElement, onStatus: (status: SourceStatus) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      onStatus({ state: 'unavailable', detail: 'This browser cannot open a camera here' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      video.removeAttribute('src');
      video.srcObject = stream;
      await video.play().catch(() => {});
      onStatus({ state: 'live', detail: '' });

      // A camera can be unplugged or taken by another app mid-demo: come back by ourselves.
      const [track] = stream.getVideoTracks();
      track?.addEventListener('ended', () => {
        if (this.stopped) return;
        onStatus({ state: 'reconnecting', detail: 'The camera stopped' });
        this.retryTimer = window.setTimeout(() => void this.open(video, onStatus), 1000);
      });
    } catch (err) {
      if (this.stopped) return;
      const name = err instanceof DOMException ? err.name : '';
      const detail =
        name === 'NotAllowedError' ? 'Camera permission was not given'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found'
        : name === 'NotReadableError' ? 'The camera is in use by another app'
        : 'The camera could not be opened';
      onStatus({ state: 'unavailable', detail });
    }
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
