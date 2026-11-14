import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';

/**
 * The idle screen for a walk-up table: when nobody has touched anything for a few seconds in the Ready
 * state, the picture dims a little and the title, a one-line pitch and "press Next to begin" come up.
 * Any input clears it at once.
 */
export class AttractScreen {
  private root: HTMLDivElement;
  private on = false;

  constructor(private hudRoot: HTMLElement) {
    this.root = add(hudRoot, el('div', 'attract'));
    const box = add(this.root, el('div', 'attract__box'));
    add(box, el('div', 'attract__name', PROCEDURE.title));
    add(box, el('div', 'attract__sub', PROCEDURE.subtitle));
    add(box, el('div', 'attract__rule'));
    add(box, el('div', 'attract__pitch', 'Surgical training, seen through the trainee’s eyes'));
    const points = add(box, el('div', 'attract__points'));
    for (const point of ['Live wound tracking', 'Guided suturing', 'An AI attending you can talk to']) {
      add(points, el('span', 'attract__point', point));
    }
    const cta = add(box, el('div', 'attract__cta'));
    add(cta, el('span', 'attract__dot'));
    add(cta, el('span', '', 'Ready · press Next to begin'));
  }

  get showing(): boolean {
    return this.on;
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.root.classList.toggle('attract--on', on);
    this.hudRoot.classList.toggle('hud--attract', on);
  }
}
