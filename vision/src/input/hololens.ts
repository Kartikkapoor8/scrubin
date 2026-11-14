import type { InputSource, SourceStatus } from './types';

/**
 * Plays the HoloLens point-of-view stream that the local relay serves at /api/stream.
 *
 * The stream is one endless fragmented MP4. It is fed to the video element through Media Source Extensions so
 * playback can be held at the live edge (a plain <video src> buffers several seconds and drifts further
 * behind). If the stream drops, this reconnects on its own, forever, and says so through the status callback;
 * the caller keeps showing the last frame and the overlays.
 */
export class HoloLensSource implements InputSource {
  readonly kind = 'hololens' as const;
  readonly label = 'HoloLens';

  private video: HTMLVideoElement | null = null;
  private onStatus: (status: SourceStatus) => void = () => {};
  private stopped = true;
  private abort: AbortController | null = null;
  private mediaSource: MediaSource | null = null;
  private objectUrl = '';
  private chaseTimer = 0;
  private retryTimer = 0;
  private retryDelay = 500;
  private everLive = false;
  /**
   * 'mse' holds playback at the live edge. If the browser will not take the headset's stream that way, the
   * source falls back to 'progressive': the stream is simply handed to the video element, the way the
   * headset's own Device Portal page plays it. A little more delay, but it plays anything the browser can.
   */
  private mode: 'mse' | 'progressive';

  constructor(private quality: 'high' | 'med' | 'low' = 'high', forceProgressive = false) {
    this.mode = forceProgressive ? 'progressive' : 'mse';
  }

  start(video: HTMLVideoElement, onStatus: (status: SourceStatus) => void): void {
    this.video = video;
    this.onStatus = onStatus;
    this.stopped = false;
    this.everLive = false;
    this.retryDelay = 500;
    onStatus({ state: 'starting', detail: 'Connecting to the headset' });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.teardown();
    this.video = null;
  }

  private teardown(): void {
    window.clearInterval(this.chaseTimer);
    this.abort?.abort();
    this.abort = null;
    if (this.mode === 'progressive' && this.video && this.video.src.includes('/api/stream')) {
      // Drop the connection to the relay (and so to the headset) before opening another.
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try { this.mediaSource.endOfStream(); } catch { /* already closing */ }
    }
    this.mediaSource = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = '';
    }
  }

  private scheduleRetry(detail: string): void {
    if (this.stopped) return;
    this.teardown();
    this.onStatus({ state: 'reconnecting', detail });
    this.retryTimer = window.setTimeout(() => void this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.6, 3000);
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.video) return;
    const video = this.video;
    if (this.mode === 'progressive') {
      this.playProgressive(video);
      return;
    }
    const abort = new AbortController();
    this.abort = abort;

    let response: Response;
    try {
      response = await fetch(`/api/stream?q=${this.quality}`, { signal: abort.signal, cache: 'no-store' });
    } catch {
      if (!abort.signal.aborted) this.scheduleRetry('The local relay is not answering');
      return;
    }

    if (!response.ok || !response.body) {
      let error = '';
      let detail = `The relay answered ${response.status}`;
      try {
        const body = await response.json();
        error = body.error || '';
        detail = body.detail || detail;
      } catch { /* not JSON */ }
      // Not configured or wrong password will not fix themselves: report it and let the operator switch.
      if (!this.everLive && (error === 'not_configured' || error === 'auth')) {
        this.onStatus({ state: 'unavailable', detail });
        return;
      }
      this.scheduleRetry(detail);
      return;
    }

    try {
      await this.play(video, response.body, abort.signal);
      if (!abort.signal.aborted) this.scheduleRetry('The headset stream ended');
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof FormatError || (err instanceof DOMException && err.name !== 'AbortError')) {
        // The stream arrived but this way of playing it was refused: use the simpler way from now on.
        console.warn('[hololens] low-latency playback refused the stream, falling back:', err.message);
        this.teardown();
        this.mode = 'progressive';
        this.retryDelay = 300;
        this.scheduleRetry('Switching playback method');
        return;
      }
      this.scheduleRetry(err instanceof Error && err.message ? err.message : 'The headset stream was interrupted');
    }
  }

  /** Fallback playback: give the relayed stream straight to the video element and watch that it keeps moving. */
  private playProgressive(video: HTMLVideoElement): void {
    video.srcObject = null;
    video.src = `/api/stream?q=${this.quality}&t=${Date.now()}`;
    void video.play().catch(() => {});

    let lastTime = -1;
    let movedAt = performance.now();
    let announced = false;
    window.clearInterval(this.chaseTimer);
    this.chaseTimer = window.setInterval(() => {
      const now = performance.now();
      if (video.error) {
        // The element gives no reason; ask the relay what is wrong with the headset.
        window.clearInterval(this.chaseTimer);
        fetch('/api/stream/probe', { cache: 'no-store' })
          .then((res) => res.json())
          .then((probe) => {
            const detail =
              probe.error === 'not_configured' ? 'Set HOLOLENS_IP, HOLOLENS_USER and HOLOLENS_PASS'
              : probe.error === 'auth' ? 'The headset rejected the user name or password'
              : probe.ok ? 'The browser could not play the stream' : 'The headset is not answering on the network';
            if (!this.everLive && (probe.error === 'not_configured' || probe.error === 'auth')) {
              this.teardown();
              this.onStatus({ state: 'unavailable', detail });
            } else {
              this.scheduleRetry(detail);
            }
          })
          .catch(() => this.scheduleRetry('The local relay is not answering'));
        return;
      }
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        movedAt = now;
        if (!announced && video.readyState >= 2) {
          announced = true;
          this.everLive = true;
          this.retryDelay = 500;
          this.onStatus({ state: 'live', detail: '' });
        }
      } else if (now - movedAt > (announced ? 4000 : 9000)) {
        this.scheduleRetry(announced ? 'The headset stream stalled' : 'The headset stream did not start');
        return;
      }
      // Stay near the newest picture.
      if (video.buffered.length > 0) {
        const lag = video.buffered.end(video.buffered.length - 1) - video.currentTime;
        if (lag > 3) video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.5;
        else video.playbackRate = lag > 1.2 ? 1.15 : 1;
      }
      if (video.paused) void video.play().catch(() => {});
    }, 250);
  }

  private async play(video: HTMLVideoElement, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();

    // Read until the stream's header (ftyp + moov) is complete: it says which codec to ask the browser for.
    let head: Uint8Array = new Uint8Array(0);
    let headerEnd = -1;
    while (headerEnd < 0) {
      const { value, done } = await reader.read();
      if (done) throw new Error('The headset closed the stream before any video arrived');
      head = concat(head, value);
      headerEnd = endOfMoov(head);
      if (head.length > 4_000_000) throw new FormatError('The stream does not look like MP4 video');
    }

    const codecs = sniffCodecs(head.subarray(0, headerEnd));
    const mime = `video/mp4; codecs="${codecs.join(', ')}"`;
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
      throw new FormatError(`This browser cannot play the headset's video format (${codecs.join(', ')})`);
    }

    const mediaSource = new MediaSource();
    this.mediaSource = mediaSource;
    this.objectUrl = URL.createObjectURL(mediaSource);
    video.srcObject = null;
    video.src = this.objectUrl;
    await new Promise<void>((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });

    const buffer = mediaSource.addSourceBuffer(mime);
    // Fragments are placed one after another whatever their timestamps say: right for an endless live feed.
    buffer.mode = 'sequence';

    const queue: Uint8Array[] = [head];
    let failed: Error | null = null;
    const pump = () => {
      if (buffer.updating || mediaSource.readyState !== 'open' || failed) return;
      // Keep memory flat: drop what is more than a few seconds behind the picture.
      if (buffer.buffered.length > 0 && video.currentTime - buffer.buffered.start(0) > 12) {
        try { buffer.remove(buffer.buffered.start(0), video.currentTime - 6); return; } catch { /* try again later */ }
      }
      const next = queue.shift();
      if (!next) return;
      try {
        buffer.appendBuffer(next as BufferSource);
      } catch (err) {
        failed = new FormatError(err instanceof Error ? err.message : 'append failed');
      }
    };
    buffer.addEventListener('updateend', pump);
    buffer.addEventListener('error', () => { failed = new FormatError('The browser rejected the video data'); });
    pump();

    void video.play().catch(() => { /* autoplay is muted; a blocked play resolves on the next user input */ });

    // Hold the picture close to the live edge: speed up a little when behind, jump when far behind.
    let announced = false;
    window.clearInterval(this.chaseTimer);
    this.chaseTimer = window.setInterval(() => {
      if (buffer.buffered.length === 0) return;
      const end = buffer.buffered.end(buffer.buffered.length - 1);
      const start = buffer.buffered.start(0);
      const lag = end - video.currentTime;
      if (video.currentTime < start || lag > 2.5) {
        video.currentTime = Math.max(start, end - 0.25);
      } else if (lag > 0.8) {
        video.playbackRate = 1.25;
      } else if (lag > 0.45) {
        video.playbackRate = 1.08;
      } else {
        video.playbackRate = 1;
      }
      if (video.paused) void video.play().catch(() => {});
      if (!announced && video.readyState >= 2) {
        announced = true;
        this.everLive = true;
        this.retryDelay = 500;
        this.onStatus({ state: 'live', detail: '' });
      }
    }, 200);

    for (;;) {
      const { value, done } = await reader.read();
      if (failed) throw failed;
      if (done) return;
      if (signal.aborted) return;
      queue.push(value);
      // If the page was hidden and data piled up, skip ahead rather than play catch-up through a backlog.
      if (queue.length > 240) queue.splice(0, queue.length - 60);
      pump();
    }
  }
}

/** The stream reached us but could not be played this way (as opposed to the network dropping). */
class FormatError extends Error {}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Byte offset just past the `moov` box, or -1 if it has not fully arrived yet. */
function endOfMoov(bytes: Uint8Array): number {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (size < 8) return -1;
    if (type === 'moov') return offset + size <= bytes.length ? offset + size : -1;
    offset += size;
  }
  return -1;
}

/** Reads the H.264 profile and level out of the header so the browser is asked for exactly this stream. */
function sniffCodecs(header: Uint8Array): string[] {
  const codecs: string[] = [];
  const find = (tag: string, from = 0): number => {
    const t = [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)];
    for (let i = from; i + 4 <= header.length; i++) {
      if (header[i] === t[0] && header[i + 1] === t[1] && header[i + 2] === t[2] && header[i + 3] === t[3]) return i;
    }
    return -1;
  };

  const avcC = find('avcC');
  if (avcC >= 0 && avcC + 8 <= header.length) {
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    codecs.push(`avc1.${hex(header[avcC + 5])}${hex(header[avcC + 6])}${hex(header[avcC + 7])}`);
  } else {
    codecs.push('avc1.42E01F');
  }
  if (find('mp4a') >= 0) codecs.push('mp4a.40.2');
  return codecs;
}
