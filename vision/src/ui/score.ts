import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The final score card: a ring that fills to the number of sutures placed, and the numbers behind it. */
export class ScoreCard {
  private root: HTMLDivElement;
  private ring: SVGCircleElement;
  private big: HTMLDivElement;
  private rows: Record<string, HTMLSpanElement> = {};

  constructor(parent: HTMLElement, private procedure: Procedure) {
    this.root = add(parent, el('div', 'panel score'));
    add(this.root, el('div', 'panel__label', 'Procedure complete'));

    const body = add(this.root, el('div', 'score__body'));
    const dial = add(body, el('div', 'score__dial'));
    dial.innerHTML =
      `<svg viewBox="0 0 128 128" aria-hidden="true">` +
      `<circle cx="64" cy="64" r="${RING_RADIUS}" class="score__track"/>` +
      `<circle cx="64" cy="64" r="${RING_RADIUS}" class="score__ring" stroke-dasharray="${RING_LENGTH.toFixed(1)}" stroke-dashoffset="${RING_LENGTH.toFixed(1)}" transform="rotate(-90 64 64)"/>` +
      `</svg>`;
    this.ring = dial.querySelector('.score__ring') as SVGCircleElement;
    this.big = add(dial, el('div', 'score__big'));

    const stats = add(body, el('div', 'score__stats'));
    for (const [key, label] of [['sutures', 'Sutures placed'], ['spacing', 'Average spacing'], ['depth', 'Depth'], ['time', 'Time']]) {
      const row = add(stats, el('div', 'score__row'));
      add(row, el('span', 'score__key', label));
      this.rows[key] = add(row, el('span', 'score__value'));
    }

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
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    this.big.innerHTML = `<span>${done}</span><small>/${s.count}</small>`;
    this.rows.sutures.textContent = `${done} of ${s.count}`;
    this.rows.spacing.textContent = `${average.toFixed(1)} mm`;
    this.rows.depth.textContent = 'In range';
    this.rows.time.textContent = clock;

    this.root.classList.add('panel--on');
    // Let the card arrive, then fill the ring.
    this.ring.style.transition = 'none';
    this.ring.style.strokeDashoffset = String(RING_LENGTH);
    window.setTimeout(() => {
      this.ring.style.transition = '';
      this.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - done / s.count));
    }, 450);
  }

  private hide(): void {
    this.root.classList.remove('panel--on');
  }
}
