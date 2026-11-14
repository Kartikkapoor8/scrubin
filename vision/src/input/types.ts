export type SourceKind = 'hololens' | 'webcam' | 'file' | 'sim';

/**
 * idle          not started
 * starting      asked for, nothing on screen yet
 * live          frames are arriving
 * reconnecting  it was live (or should be) and dropped; retrying on its own
 * unavailable   cannot work right now (not configured, permission denied, no file): pick another source
 */
export type SourceState = 'idle' | 'starting' | 'live' | 'reconnecting' | 'unavailable';

export interface SourceStatus {
  state: SourceState;
  /** Short, plain-language reason for the operator. Empty when live. */
  detail: string;
}

export interface InputSource {
  readonly kind: SourceKind;
  /** Name shown on the status chip. */
  readonly label: string;
  /** Start feeding the video element. Report every state change through onStatus. Must not throw. */
  start(video: HTMLVideoElement, onStatus: (status: SourceStatus) => void): void;
  /** Stop and release everything (network, camera, timers). Safe to call twice. */
  stop(): void;
}

export const SOURCE_ORDER: SourceKind[] = ['hololens', 'webcam', 'file', 'sim'];

export const SOURCE_NAMES: Record<SourceKind, string> = {
  hololens: 'HoloLens',
  webcam: 'Webcam',
  file: 'Video file',
  sim: 'Simulated arm',
};
