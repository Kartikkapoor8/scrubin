import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';

/**
 * The step panel (left): where the procedure is, what this step is called, what the attending says to do,
 * and how many sutures are in.
 */
export class StepPanel {
  private root: HTMLDivElement;
  private index: HTMLSpanElement;
  private title: HTMLDivElement;
  private line: HTMLDivElement;
  private nodes: HTMLSpanElement[] = [];
  private sutures: HTMLDivElement;
  private pips: HTMLSpanElement[] = [];
  private count: HTMLSpanElement;
  private swapTimer = 0;

  constructor(parent: HTMLElement, private procedure: Procedure) {
    this.root = add(parent, el('div', 'panel steps'));

    const top = add(this.root, el('div', 'steps__top'));
    this.index = add(top, el('span', 'steps__index'));
    const rail = add(top, el('div', 'steps__rail'));
    // The rail shows the real steps; "standing by" is before the first node.
    for (let i = 1; i < procedure.steps.length; i++) {
      const node = add(rail, el('span', 'steps__node'));
      node.title = procedure.steps[i].title;
      this.nodes.push(node);
    }

    this.title = add(this.root, el('div', 'steps__title'));
    this.line = add(this.root, el('div', 'steps__line'));

    this.sutures = add(this.root, el('div', 'steps__sutures'));
    add(this.sutures, el('span', 'steps__sutures-label', 'Sutures'));
    const pips = add(this.sutures, el('span', 'steps__pips'));
    for (let i = 0; i < PROCEDURE.sutures.count; i++) this.pips.push(add(pips, el('span', 'steps__pip')));
    this.count = add(this.sutures, el('span', 'steps__count'));

    procedure.on((event) => {
      if (event.type === 'step') this.showStep(true);
      if (event.type === 'stitch-start' || event.type === 'stitch-done' || event.type === 'reset') this.showSutures();
    });
    this.showStep(false);
    this.showSutures();
    requestAnimationFrame(() => this.root.classList.add('panel--on'));
  }

  private showStep(animate: boolean): void {
    const procedure = this.procedure;
    const step = procedure.step;
    const apply = () => {
      const total = procedure.steps.length - 1;
      this.index.textContent = procedure.index === 0 ? 'READY' : `${String(procedure.index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      this.title.textContent = step.title;
      this.line.textContent = step.line;
      this.nodes.forEach((node, i) => {
        node.classList.toggle('steps__node--done', i + 1 < procedure.index);
        node.classList.toggle('steps__node--now', i + 1 === procedure.index);
      });
      const showSutures = step.id === 'plan' || step.id === 'stitch' || step.id === 'complete';
      this.sutures.classList.toggle('steps__sutures--on', showSutures);
      this.root.classList.remove('steps--swap');
    };
    window.clearTimeout(this.swapTimer);
    if (!animate) return apply();
    this.root.classList.add('steps--swap');
    this.swapTimer = window.setTimeout(apply, 170);
  }

  private showSutures(): void {
    const { stitchesDone, stitch, count } = this.procedure;
    this.pips.forEach((pip, i) => {
      pip.classList.toggle('steps__pip--done', i < stitchesDone);
      pip.classList.toggle('steps__pip--now', stitch !== null && stitch.index === i);
    });
    this.count.textContent = `${stitchesDone}/${count}`;
  }
}
