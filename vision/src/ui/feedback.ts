import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';

const CHECK_SVG =
  '<svg class="toast__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6l3.2 3.2L13 4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * The line that confirms each suture, bottom centre: "Suture 3/5 · spacing 7.9 mm ✓ · depth ✓".
 * The wording comes from the procedure data; {ok} becomes a drawn check mark.
 */
export class FeedbackToast {
  private root: HTMLDivElement;
  private hideTimer = 0;

  constructor(parent: HTMLElement, procedure: Procedure) {
    this.root = add(parent, el('div', 'toast'));
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

    this.root.textContent = '';
    filled.split('·').map((part) => part.trim()).filter(Boolean).forEach((part, i) => {
      if (i > 0) add(this.root, el('span', 'toast__sep', '·'));
      const segment = add(this.root, el('span', 'toast__seg'));
      segment.style.setProperty('--i', String(i));
      const pieces = part.split('{ok}');
      pieces.forEach((piece, j) => {
        if (piece.trim()) add(segment, el('span', '', piece.trim()));
        if (j < pieces.length - 1) segment.insertAdjacentHTML('beforeend', CHECK_SVG);
      });
    });

    window.clearTimeout(this.hideTimer);
    this.root.classList.remove('toast--on');
    void this.root.offsetWidth; // restart the entrance
    this.root.classList.add('toast--on');
    this.hideTimer = window.setTimeout(() => this.hide(), 4200);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.root.classList.remove('toast--on');
  }
}
