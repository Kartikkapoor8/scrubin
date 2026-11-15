import { FileSource } from './file';
import { HoloLensSource } from './hololens';
import { SimulatedSource } from './simulated';
import type { InputSource, SourceKind, SourceStatus } from './types';
import { WebcamSource } from './webcam';

export interface InputSnapshot {
  kind: SourceKind;
  label: string;
  status: SourceStatus;
  /** Set when the app switched source by itself, to say why. Cleared when the operator picks one. */
  fellBackFrom: string;
}

/**
 * Owns the one video element and whichever source is feeding it. Rules:
 *  - The operator's choice is always respected: a chosen source keeps retrying for as long as it takes.
 *  - Only a source the app picked by itself at launch is replaced automatically (HoloLens, then webcam, then
 *    the simulated arm), and only if it cannot work at all or never comes up.
 *  - Once a source has been live, a drop is never a reason to switch: it shows "reconnecting" and waits.
 */
export class InputManager {
  private source: InputSource | null = null;
  private file: FileSource = new FileSource(null);
  private snapshot: InputSnapshot = {
    kind: 'sim', label: '', status: { state: 'idle', detail: '' }, fellBackFrom: '',
  };
  private auto = false;
  private wasLive = false;
  /** The headset stream preset: live_high, live_med or live_low on the Device Portal. */
  private hlQuality: HoloLensQuality = loadQuality();
  private startupTimer = 0;
  private generation = 0;

  constructor(
    private video: HTMLVideoElement,
    private available: { hololens: boolean },
    private onChange: (snapshot: InputSnapshot) => void,
  ) {}

  get current(): InputSnapshot {
    return this.snapshot;
  }

  /** The operator (or a URL parameter) picked a source. */
  choose(kind: SourceKind): void {
    this.auto = false;
    this.snapshot.fellBackFrom = '';
    this.startSource(kind);
  }

  /** Launch default: the best source available, with automatic fallback down the list. */
  chooseBest(): void {
    this.auto = true;
    this.snapshot.fellBackFrom = '';
    this.startSource(this.available.hololens ? 'hololens' : 'webcam');
  }

  /** A video was dropped on the window, picked, or named in the URL. */
  useFile(source: File | string): void {
    this.file.dispose();
    this.file = new FileSource(source);
    this.choose('file');
  }

  get hasFile(): boolean {
    return this.file.hasFile;
  }

  get quality(): HoloLensQuality {
    return this.hlQuality;
  }

  /** Change the headset stream preset (remembered). Reconnects at once if the headset is the current input. */
  setQuality(quality: HoloLensQuality): void {
    this.hlQuality = quality;
    try { localStorage.setItem(QUALITY_KEY, quality); } catch { /* not kept */ }
    if (this.snapshot.kind === 'hololens') this.startSource('hololens');
  }

  /** The low-latency player's numbers while the headset is the input (null otherwise). */
  get streamStats(): HoloLensSource['stats'] | null {
    return this.source instanceof HoloLensSource ? this.source.stats : null;
  }

  private create(kind: SourceKind): InputSource {
    switch (kind) {
      case 'hololens': {
        // ?hlmode=progressive or ?hlmode=remux forces one way of playing the stream (see HoloLensSource).
        const forced = new URLSearchParams(location.search).get('hlmode');
        return new HoloLensSource(this.hlQuality, forced === 'progressive' || forced === 'remux' ? forced : '');
      }
      case 'webcam': return new WebcamSource();
      case 'file': return this.file;
      case 'sim': return new SimulatedSource();
    }
  }

  private startSource(kind: SourceKind): void {
    window.clearTimeout(this.startupTimer);
    this.source?.stop();
    this.generation += 1;
    const generation = this.generation;
    this.wasLive = false;

    // Leave the element clean for the next source; the hold canvas keeps the last picture on screen meanwhile.
    this.video.pause();
    this.video.loop = false;
    this.video.playbackRate = 1;

    const source = this.create(kind);
    this.source = source;
    this.snapshot = { ...this.snapshot, kind, label: source.label, status: { state: 'starting', detail: '' } };
    this.onChange(this.snapshot);

    source.start(this.video, (status) => {
      if (generation !== this.generation) return; // a late report from a source that was already replaced
      if (status.state === 'live') this.wasLive = true;
      this.snapshot = { ...this.snapshot, status };
      this.onChange(this.snapshot);
      if (status.state === 'unavailable' && this.auto) this.fallBack(kind, status.detail);
    });

    if (this.auto && kind !== 'sim') {
      // Picked automatically and still nothing after a while: move on rather than sit on a black screen.
      this.startupTimer = window.setTimeout(() => {
        if (generation === this.generation && !this.wasLive) {
          this.fallBack(kind, this.snapshot.status.detail || 'It did not start');
        }
      }, kind === 'hololens' ? 8000 : 6000);
    }
  }

  private fallBack(from: SourceKind, reason: string): void {
    const next: SourceKind = from === 'hololens' ? 'webcam' : 'sim';
    const name = from === 'hololens' ? 'HoloLens' : 'Webcam';
    this.snapshot = { ...this.snapshot, fellBackFrom: `${name}: ${reason}` };
    this.startSource(next);
  }
}

export type HoloLensQuality = 'high' | 'med' | 'low';
export const QUALITIES: HoloLensQuality[] = ['high', 'med', 'low'];
const QUALITY_KEY = 'viper.hlq';

/** ?hlq=high|med|low in the address, else the preset last chosen (by key Q or the latency sweep), else high. */
function loadQuality(): HoloLensQuality {
  const wanted = new URLSearchParams(location.search).get('hlq');
  if (wanted === 'high' || wanted === 'med' || wanted === 'low') return wanted;
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved === 'high' || saved === 'med' || saved === 'low') return saved;
  } catch { /* storage blocked */ }
  return 'high';
}
