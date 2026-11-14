import type { InputSource, SourceStatus } from './types';

/**
 * A recorded video, looping. Either a file the operator dropped on the window or picked, or a clip served
 * from vision/media/ (give its URL). Used to rehearse without the headset and as a stage fallback.
 */
export class FileSource implements InputSource {
  readonly kind = 'file' as const;
  readonly label: string;

  private url = '';
  private ownsUrl = false;
  private video: HTMLVideoElement | null = null;
  private onError: (() => void) | null = null;

  constructor(source: File | string | null) {
    if (source instanceof File) {
      this.url = URL.createObjectURL(source);
      this.ownsUrl = true;
      this.label = source.name;
    } else if (source) {
      this.url = source;
      this.label = decodeURIComponent(source.split('/').pop() || 'Video file');
    } else {
      this.label = 'Video file';
    }
  }

  get hasFile(): boolean {
    return this.url !== '';
  }

  start(video: HTMLVideoElement, onStatus: (status: SourceStatus) => void): void {
    if (!this.url) {
      onStatus({ state: 'unavailable', detail: 'No video chosen yet: drop a file on the window or press 3 again' });
      return;
    }
    this.video = video;
    onStatus({ state: 'starting', detail: 'Loading the video' });

    this.onError = () => onStatus({ state: 'unavailable', detail: 'This video could not be played' });
    video.addEventListener('error', this.onError);

    video.srcObject = null;
    video.loop = true;
    video.src = this.url;
    video.play()
      .then(() => onStatus({ state: 'live', detail: '' }))
      .catch(() => { /* the error listener reports a bad file; a blocked autoplay resolves on input */ });
  }

  stop(): void {
    if (this.video && this.onError) this.video.removeEventListener('error', this.onError);
    if (this.video) this.video.loop = false;
    this.video = null;
    this.onError = null;
  }

  /** Call when this source is being replaced for good, to free the dropped file. */
  dispose(): void {
    if (this.ownsUrl && this.url) URL.revokeObjectURL(this.url);
    this.url = '';
  }
}
