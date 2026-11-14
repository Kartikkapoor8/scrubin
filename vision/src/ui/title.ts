import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';

/**
 * The opening title: "VIPER" assembles over the picture as the scan begins, with the full name and the
 * "simulated training" line under it, then gets out of the way.
 */
export class TitleCard {
  private root: HTMLDivElement;
  private timer = 0;

  constructor(parent: HTMLElement, procedure: Procedure) {
    this.root = add(parent, el('div', 'title-card'));
    add(this.root, el('div', 'title-card__name', PROCEDURE.title));
    add(this.root, el('div', 'title-card__rule'));
    add(this.root, el('div', 'title-card__sub', PROCEDURE.subtitle));
    add(this.root, el('div', 'title-card__note', 'Simulated training · not medical guidance'));

    procedure.on((event) => {
      if (event.type === 'step' && event.step.id === 'scan' && event.previous !== 'scan') this.show();
      else if (event.type === 'step' || event.type === 'reset') this.hide();
    });
  }

  private show(): void {
    window.clearTimeout(this.timer);
    this.root.classList.remove('title-card--on');
    void this.root.offsetWidth; // restart the entrance
    this.root.classList.add('title-card--on');
    this.timer = window.setTimeout(() => this.hide(), 3600);
  }

  private hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.remove('title-card--on');
  }
}
