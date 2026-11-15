import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';
import { enter, leave, sweep, ticker } from './motion';

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The debrief, bottom centre, when the procedure is complete: a ring that fills to the number of sutures
 * placed, and the numbers behind it counting up to their values.
 */
export class ScoreCard {
  private root: HTMLDivElement;
  private ring: SVGCircleElement;
  private big: HTMLSpanElement;
  private of: HTMLElement;
  private spacing: HTMLSpanElement;
  private time: HTMLSpanElement;
  private parts: HTMLElement[] = [];
  private showing = false;

  constructor(parent: HTMLElement, private procedure: Procedure) {
    const slot = add(parent, el('div', 'debrief-slot'));
    this.root = add(slot, el('div', 'debrief glass sweep keep'));
    this.root.style.opacity = '0';
    const text = PROCEDURE.debrief;

    const dial = add(this.root, el('div', 'debrief__dial'));
    dial.innerHTML =
      `<svg viewBox="0 0 128 128" aria-hidden="true">` +
      `<circle cx="64" cy="64" r="${RING_RADIUS}" class="debrief__track"/>` +
      `<circle cx="64" cy="64" r="${RING_RADIUS}" class="debrief__ring" stroke-dasharray="${RING_LENGTH.toFixed(1)}" stroke-dashoffset="${RING_LENGTH.toFixed(1)}" transform="rotate(-90 64 64)"/>` +
      `</svg>`;
    this.ring = dial.querySelector('.debrief__ring') as SVGCircleElement;
    const big = add(dial, el('div', 'debrief__big'));
    this.big = add(big, el('span', 'num'));
    this.of = add(big, el('small', 'num'));

    const head = add(this.root, el('div', 'debrief__head'));
    add(head, el('div', 'debrief__kicker', text.kicker));
    add(head, el('div', 'debrief__title', text.title));

    const stat = (label: string, unit = '', tone = ''): HTMLSpanElement => {
      const box = add(this.root, el('div', `debrief__stat${tone ? ` debrief__stat--${tone}` : ''}`));
      add(box, el('div', 'debrief__key', label));
      const line = add(box, el('div', 'debrief__val'));
      const value = add(line, el('span', 'num'));
      if (unit) add(line, el('small', '', unit));
      this.parts.push(box);
      return value;
    };
    this.spacing = stat('Avg spacing', 'mm');
    stat('Depth', '', 'good').textContent = text.depth;
    this.time = stat('Time');
    this.parts.unshift(dial, head);

    procedure.on((event) => {
      if (event.type === 'step') {
        if (event.step.id === 'complete') this.show();
        else this.hide();
      }
      if (event.type === 'reset') this.hide();
    });
  }

  private show(): void {
    const s = PROCEDURE.sutures;
    const done = this.procedure.stitchesDone;
    let sum = 0;
    let n = 0;
    for (let i = 1; i < done; i++) {
      sum += s.measuredSpacingMm[i] > 0 ? s.measuredSpacingMm[i] : s.spacingMm;
      n++;
    }
    const average = n > 0 ? sum / n : s.spacingMm;
    const seconds = Math.max(0, Math.round(this.procedure.elapsed));
    const clock = (value: number) => {
      const whole = Math.round(value);
      return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    };

    this.of.textContent = `/${s.count}`;
    this.showing = true;
    this.root.classList.add('debrief--on');
    enter(this.root, { y: 44, scale: 0.97 });
    enter(this.parts, { y: 14, each: 0.08, delay: 0.16 });
    sweep(this.root);
    ticker(this.big, done, { duration: 1.0, delay: 0.35 });
    ticker(this.spacing, average, { decimals: 1, duration: 1.0, delay: 0.5 });
    ticker(this.time, seconds, { duration: 1.1, delay: 0.6, format: clock });

    // Let the card arrive, then fill the ring.
    this.ring.style.transition = 'none';
    this.ring.style.strokeDashoffset = String(RING_LENGTH);
    window.setTimeout(() => {
      this.ring.style.transition = '';
      this.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - done / s.count));
    }, 380);
  }

  private hide(): void {
    if (!this.showing) return;
    this.showing = false;
    this.root.classList.remove('debrief--on');
    leave(this.root, { y: 16 });
  }
}
