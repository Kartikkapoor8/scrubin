import { PROCEDURE, type StepDef, type StepId } from './data';

export interface StitchRun {
  index: number;
  /** App time (seconds) the stitch animation started. */
  startedAt: number;
}

type Listener = (event: ProcedureEvent) => void;

export type ProcedureEvent =
  | { type: 'step'; step: StepDef; index: number; previous: StepId }
  | { type: 'stitch-start'; index: number }
  | { type: 'stitch-done'; index: number }
  | { type: 'reset' }
  | { type: 'autoplay'; on: boolean };

/** How long one stitch animation runs, in seconds. The stitch layer and the machine share this number. */
export const STITCH_SECONDS = 2.6;

/**
 * The procedure's state: which step is showing, how many sutures are in, whether autoplay is running.
 * Every way of driving the demo (keys, clicker, autoplay, the Gemini attending's tools) goes through here,
 * so they can never disagree about where the procedure is.
 */
export class Procedure {
  readonly steps = PROCEDURE.steps;
  index = 0;
  /** App time the current step was entered. */
  stepStartedAt = 0;
  stitchesDone = 0;
  stitch: StitchRun | null = null;
  autoplay = false;
  /** App time the first real step began, for the score card's clock. */
  startedAt = 0;
  finishedAt = 0;

  private listeners: Listener[] = [];
  private now = 0;
  private nextAutoAt = 0;

  get step(): StepDef {
    return this.steps[this.index];
  }

  get count(): number {
    return PROCEDURE.sutures.count;
  }

  /** Seconds the procedure has been running (frozen once complete). */
  get elapsed(): number {
    if (!this.startedAt) return 0;
    return (this.finishedAt || this.now) - this.startedAt;
  }

  on(listener: Listener): void {
    this.listeners.push(listener);
  }

  private emit(event: ProcedureEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (err) { console.error('[procedure] a listener failed', err); }
    }
  }

  /** Call every frame with the app time. Finishes running stitches and drives autoplay. */
  tick(now: number): void {
    this.now = now;
    if (this.stitch && now - this.stitch.startedAt >= STITCH_SECONDS) {
      const index = this.stitch.index;
      this.stitch = null;
      this.stitchesDone = Math.max(this.stitchesDone, index + 1);
      this.emit({ type: 'stitch-done', index });
      if (this.autoplay) this.nextAutoAt = now + 0.9;
    }
    if (this.autoplay && now >= this.nextAutoAt) this.autoStep();
  }

  private autoStep(): void {
    if (this.step.id === 'stitch') {
      if (this.stitch) return;
      if (this.stitchesDone < this.count) { this.startStitch(); return; }
    }
    if (this.index >= this.steps.length - 1) {
      // Hold on the finished repair; autoplay stops by itself.
      this.setAutoplay(false);
      return;
    }
    this.goTo(this.index + 1);
  }

  setAutoplay(on: boolean): void {
    if (this.autoplay === on) return;
    this.autoplay = on;
    if (on) {
      if (this.index >= this.steps.length - 1) this.reset();
      this.nextAutoAt = this.now + (this.step.id === 'standby' ? 1.2 : this.step.duration);
    }
    this.emit({ type: 'autoplay', on });
  }

  goTo(index: number): void {
    const target = Math.max(0, Math.min(this.steps.length - 1, index));
    if (target === this.index) return;
    const previous = this.step.id;
    const stitchIndex = this.steps.findIndex((s) => s.id === 'stitch');

    // Leaving the stitch step forwards with sutures still open: close them, so the result is whole.
    if (target > this.index && previous === 'stitch') {
      this.stitch = null;
      this.stitchesDone = this.count;
    }
    // Going back to before the stitches: they have not happened yet.
    if (target < stitchIndex) {
      this.stitch = null;
      this.stitchesDone = 0;
    }

    this.index = target;
    this.stepStartedAt = this.now;
    if (this.step.id !== 'standby' && !this.startedAt) this.startedAt = this.now;
    if (this.step.id === 'standby') { this.startedAt = 0; this.finishedAt = 0; }
    if (this.step.id === 'complete') this.finishedAt = this.now;
    else this.finishedAt = 0;
    this.nextAutoAt = this.now + this.step.duration;
    this.emit({ type: 'step', step: this.step, index: this.index, previous });
  }

  goToId(id: StepId): void {
    const index = this.steps.findIndex((s) => s.id === id);
    if (index >= 0) this.goTo(index);
  }

  next(): void {
    this.goTo(this.index + 1);
  }

  back(): void {
    this.goTo(this.index - 1);
  }

  reset(): void {
    this.stitch = null;
    this.stitchesDone = 0;
    this.startedAt = 0;
    this.finishedAt = 0;
    const previous = this.step.id;
    this.index = 0;
    this.stepStartedAt = this.now;
    this.nextAutoAt = this.now + 1.2;
    this.emit({ type: 'reset' });
    this.emit({ type: 'step', step: this.step, index: 0, previous });
  }

  /** Place the next suture. Works from the plan step too (it moves to the stitch step first). */
  startStitch(): boolean {
    if (this.step.id === 'plan') this.goToId('stitch');
    if (this.step.id !== 'stitch' || this.stitch || this.stitchesDone >= this.count) return false;
    this.stitch = { index: this.stitchesDone, startedAt: this.now };
    this.emit({ type: 'stitch-start', index: this.stitch.index });
    return true;
  }

  /** The one-button action (space bar, clicker): place a suture if there is one to place, otherwise move on. */
  advance(): void {
    if (this.step.id === 'stitch' && (this.stitch || this.stitchesDone < this.count)) {
      this.startStitch();
      return;
    }
    this.next();
  }
}
