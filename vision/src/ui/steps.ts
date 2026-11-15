import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';
import { enter, numerals, sweep } from './motion';

const CHECK = '<svg class="rail__check" viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="M3.2 8.5l3.1 3.1L12.8 4.9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface Item {
  root: HTMLDivElement;
  inner: HTMLDivElement;
  parts: HTMLElement[];
}

/**
 * The step rail (left): the six steps of the procedure down the edge of the picture, a line that fills as
 * they are done, and the current step opened into a card with its name, what to do, and (while suturing)
 * how many sutures are in. Before the first step, one card says how to begin.
 */
export class StepPanel {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  private ready: Item;
  private items: Item[] = [];
  private sutures: HTMLDivElement;
  private pips: HTMLSpanElement[] = [];
  private count: HTMLSpanElement;

  constructor(parent: HTMLElement, private procedure: Procedure) {
    this.root = add(parent, el('div', 'rail'));

    // "Ready": shown alone, above the list, until the procedure starts.
    const standby = procedure.steps[0];
    this.ready = this.card(add(this.root, el('div', 'rail__ready')), 'Standing by', standby.title, standby.line);

    this.list = add(this.root, el('div', 'rail__list'));
    const total = procedure.steps.length - 1;
    for (let i = 1; i < procedure.steps.length; i++) {
      const step = procedure.steps[i];
      const row = add(this.list, el('div', 'rail__item'));
      const node = add(row, el('div', 'rail__node'));
      add(node, el('span', 'num', String(i)));
      node.insertAdjacentHTML('beforeend', CHECK);
      const main = add(row, el('div', 'rail__main'));
      add(main, el('div', 'rail__label', step.label));
      const item = this.card(main, `Step ${i} of ${total}`, step.title, step.line);
      item.root = row;
      this.items.push(item);
    }

    this.sutures = el('div', 'rail__sutures');
    add(this.sutures, el('span', 'rail__sutures-label', 'Sutures'));
    const pips = add(this.sutures, el('span', 'rail__pips'));
    for (let i = 0; i < PROCEDURE.sutures.count; i++) this.pips.push(add(pips, el('span', 'rail__pip')));
    this.count = add(this.sutures, el('span', 'rail__count num'));

    procedure.on((event) => {
      if (event.type === 'step') this.showStep(true);
      if (event.type === 'stitch-start' || event.type === 'stitch-done' || event.type === 'reset') this.showSutures();
      if (event.type === 'reset') this.showStep(false);
    });
    this.showStep(false);
    this.showSutures();
    requestAnimationFrame(() => this.root.classList.add('rail--on'));
  }

  /** A collapsible card: kicker, title, instruction. */
  private card(parent: HTMLElement, kicker: string, title: string, line: string): Item {
    const clip = add(add(parent, el('div', 'rail__card')), el('div', 'rail__clip'));
    const inner = add(clip, el('div', 'rail__card-in glass sweep keep'));
    const k = add(inner, el('div', 'rail__kicker'));
    numerals(k, kicker);
    const parts: HTMLElement[] = [k, add(inner, el('div', 'rail__title', title)), add(inner, el('div', 'rail__line', line))];
    return { root: parent as HTMLDivElement, inner, parts };
  }

  private showStep(animate: boolean): void {
    const procedure = this.procedure;
    const index = procedure.index; // 0 = standing by
    const id = procedure.step.id;

    this.ready.root.classList.toggle('rail__ready--on', index === 0);
    this.list.classList.toggle('rail__list--started', index > 0);
    this.items.forEach((item, i) => {
      const state = i + 1 < index ? 'done' : i + 1 === index ? 'now' : 'todo';
      const was = item.root.dataset.state;
      item.root.dataset.state = state;
      if (state === 'now' && was !== 'now') this.reveal(item, animate);
    });
    if (index === 0) this.reveal(this.ready, animate);

    // The suture counter rides in the card of whichever suturing step is open.
    const showSutures = id === 'plan' || id === 'stitch' || id === 'complete';
    if (showSutures) {
      const card = this.items[index - 1].inner;
      if (this.sutures.parentElement !== card) card.appendChild(this.sutures);
      if (animate) enter(this.sutures, { y: 10, delay: 0.34 });
    } else this.sutures.remove();
  }

  /** The card's lines arrive one after another as it opens, with a sweep of light across it. */
  private reveal(item: Item, animate: boolean): void {
    if (!animate) return;
    enter(item.parts, { y: 12, each: 0.07, delay: 0.1 });
    sweep(item.inner);
  }

  private showSutures(): void {
    const { stitchesDone, stitch, count } = this.procedure;
    this.pips.forEach((pip, i) => {
      pip.classList.toggle('rail__pip--done', i < stitchesDone);
      pip.classList.toggle('rail__pip--now', stitch !== null && stitch.index === i);
    });
    this.count.textContent = `${stitchesDone}/${count}`;
  }
}
