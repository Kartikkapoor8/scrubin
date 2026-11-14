import { damp, ease, progress } from '../core/dom';
import type { Procedure } from '../procedure/machine';
import type { HandTracker } from '../tracking/hands';
import type { MarkerSettings, WoundDetector, WoundTracker } from '../tracking/wound';

/** Operator-adjustable settings that are kept between sessions. */
export interface Settings {
  /** How much distances across the arm are foreshortened by the camera's angle (1 = seen from straight above). */
  acrossScale: number;
  flipAlong: boolean;
  flipSide: boolean;
  /** Zoom toward the wound while planning and stitching. */
  autoZoom: boolean;
}

const SETTINGS_KEY = 'viper.settings.v1';

export function loadSettings(): Settings {
  const defaults: Settings = { acrossScale: 1, flipAlong: false, flipSide: false, autoZoom: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not saved */ }
}

/** Everything the overlay layers read. One object, shared, updated in place. */
export interface Scene {
  procedure: Procedure;
  detector: WoundDetector;
  tracker: WoundTracker;
  hands: HandTracker;
  marker: MarkerSettings;
  settings: Settings;
  /** Operator pressed H: draw nothing, show the clean picture. */
  hidden: boolean;
  debug: boolean;
  /** The working fingertip is on the current suture target. Written by the hand layer, read by the HUD. */
  aligned: boolean;
  /** Distance from the working fingertip to the current target in millimetres, or -1 when there is none. */
  toolDistanceMm: number;
  /** App time at which the wound-lock brackets should snap in again (set by the scan as it passes the wound). */
  relockAt: number;
}

/**
 * Presence of a group of overlay elements: eases in and out, and remembers when it last turned on so its
 * parts can arrive one after another instead of all at once.
 */
export class Appear {
  /** 0..1, eased. */
  value = 0;
  /** App time it last turned on. */
  since = -1e9;
  private on = false;

  constructor(private rateIn = 3.2, private rateOut = 6) {}

  get isOn(): boolean {
    return this.on;
  }

  update(on: boolean, t: number, dt: number): number {
    if (on && !this.on) this.since = t;
    this.on = on;
    const target = on ? 1 : 0;
    this.value += (target - this.value) * damp(target > this.value ? this.rateIn : this.rateOut, dt);
    if (Math.abs(target - this.value) < 0.002) this.value = target;
    return this.value;
  }

  /**
   * Presence of one part that starts `delay` seconds after the group turned on and takes `duration` seconds.
   * While the group is leaving, every part simply fades with it.
   */
  part(t: number, delay: number, duration: number): number {
    if (!this.on) return this.value;
    return ease.outCubic(progress(t, this.since + delay, duration));
  }
}
