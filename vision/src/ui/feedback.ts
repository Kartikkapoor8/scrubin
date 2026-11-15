import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';
import { enter, leave, numerals, sweep, ticker } from './motion';

const CHECK =
  '<svg class="fb__check" viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="M3 8.6l3.2 3.2L13 4.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BADGE =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="fb__ring" pathLength="1" cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" transform="rotate(-90 24 24)"/>' +
  '<path class="fb__tick" pathLength="1" d="M14.5 24.8l6.4 6.4L33.8 17.6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * What confirms each suture, bottom centre: a check that draws itself, "Suture 3/5", the measurements
 * counting up to their values ("Spacing 7.9 mm", "Depth"), and the attending's one-line comment.
 * The wording comes from the procedure data; {ok} becomes a drawn check mark.
 */
export class FeedbackToast {
  private slot: HTMLDivElement;
  private root: HTMLDivElement;
  private hideTimer = 0;
  private showing = false;

  constructor(parent: HTMLElement, procedure: Procedure) {
    this.slot = add(parent, el('div', 'fb-slot'));
    this.root = add(this.slot, el('div', 'fb glass sweep'));
    this.root.style.opacity = '0';
    procedure.on((event) => {
      if (event.type === 'stitch-done') this.show(event.index);
      if (event.type === 'stitch-start' || event.type === 'reset') this.hide();
      if (event.type === 'step' && event.step.id !== 'stitch') this.hide();
    });
  }

  show(index: number): void {
    const s = PROCEDURE.sutures;
    const template = index === 0 ? s.firstFeedback : s.feedback;
    const spacing = s.measuredSpacingMm[index] > 0 ? s.measuredSpacingMm[index] : s.spacingMm;
    const filled = template
      .replace('{n}', String(index + 1))
      .replace('{count}', String(s.count))
      .replace('{spacing}', spacing.toFixed(1))
      .replace('{bite}', String(s.biteMm));
    const segments = filled.split('·').map((part) => part.trim()).filter(Boolean);

    this.root.textContent = '';
    const badge = add(this.root, el('div', 'fb__badge'));
    badge.innerHTML = BADGE;
    const main = add(this.root, el('div', 'fb__main'));
    const top = add(main, el('div', 'fb__top'));
    const arriving: HTMLElement[] = [badge];

    segments.forEach((segment, i) => {
      const words = segment.split('{ok}')[0].trim();
      const passed = segment.includes('{ok}');
      if (i === 0) {
        const title = add(top, el('span', 'fb__title'));
        numerals(title, words);
        arriving.push(title);
        return;
      }
      const metric = add(top, el('span', 'fb__metric'));
      // "spacing 7.9 mm": the name, then the number counting up to its value, then the unit.
      const match = /^(.*?)(\d+(?:\.\d+)?)(.*)$/.exec(words);
      if (match) {
        add(metric, el('span', 'fb__name', capital(match[1].trim())));
        const value = add(metric, el('span', 'fb__value num'));
        const decimals = (match[2].split('.')[1] || '').length;
        ticker(value, Number(match[2]), { decimals, duration: 0.7, delay: 0.25 + i * 0.07 });
        if (match[3].trim()) add(metric, el('span', 'fb__unit', match[3].trim()));
      } else add(metric, el('span', 'fb__name', capital(words)));
      if (passed) metric.insertAdjacentHTML('beforeend', CHECK);
      arriving.push(metric);
    });

    const line = s.lines[index];
    if (line) arriving.push(add(main, el('div', 'fb__line', line)));

    window.clearTimeout(this.hideTimer);
    this.root.classList.remove('fb--on');
    void this.root.offsetWidth; // restart the drawn check marks
    this.root.classList.add('fb--on');
    this.showing = true;
    enter(this.root, { y: 26, scale: 0.96 });
    enter(arriving, { y: 10, each: 0.07, delay: 0.08 });
    sweep(this.root);
    this.hideTimer = window.setTimeout(() => this.hide(), 4800);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    if (!this.showing) return;
    this.showing = false;
    this.root.classList.remove('fb--on');
    leave(this.root, { y: 10 });
  }
}

function capital(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
