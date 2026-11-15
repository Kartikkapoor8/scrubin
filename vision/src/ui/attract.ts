import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import { enter, snapMotion } from './motion';

/**
 * The idle screen for a walk-up table: when nobody has touched anything for a few seconds in the Ready
 * state, the picture dims a little and the title, a one-line pitch and "press Next to begin" come up,
 * piece by piece, with a slow scan line crossing the screen. Any input clears it at once.
 */
export class AttractScreen {
  private root: HTMLDivElement;
  private letters: HTMLElement[] = [];
  private lines: HTMLElement[] = [];
  private points: HTMLElement[] = [];
  private on = false;

  constructor(private hudRoot: HTMLElement) {
    this.root = add(hudRoot, el('div', 'idle'));
    add(this.root, el('div', 'idle__scan'));
    const box = add(this.root, el('div', 'idle__box'));
    const name = add(box, el('div', 'idle__name'));
    for (const letter of PROCEDURE.title) this.letters.push(add(name, el('span', '', letter)));
    this.lines.push(add(box, el('div', 'idle__sub', PROCEDURE.subtitle)));
    this.lines.push(add(box, el('div', 'idle__rule')));
    this.lines.push(add(box, el('div', 'idle__pitch', PROCEDURE.idle.pitch)));
    const points = add(box, el('div', 'idle__points'));
    for (const point of PROCEDURE.idle.points) this.points.push(add(points, el('span', 'idle__point', point)));
    this.setGemini(false);
    const cta = add(box, el('div', 'idle__cta'));
    add(cta, el('span', 'idle__dot'));
    add(cta, el('span', '', PROCEDURE.idle.cta));
    this.lines.push(cta);
  }

  get showing(): boolean {
    return this.on;
  }

  /** The point about asking Gemini is only made while there is a Gemini session to ask. */
  setGemini(available: boolean): void {
    for (const point of this.points) {
      if (/gemini/i.test(point.textContent || '')) point.style.display = available ? '' : 'none';
    }
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.root.classList.toggle('idle--on', on);
    this.hudRoot.classList.toggle('hud--attract', on);
    if (!on) return;
    // The title's letters land one by one, then the lines under it, then the three points.
    enter(this.letters, { y: 46, each: 0.07, delay: 0.1, blur: 14, spring: { type: 'spring', stiffness: 150, damping: 21, mass: 1 } });
    enter(this.lines.slice(0, 3), { y: 16, each: 0.11, delay: 0.55 });
    enter(this.points, { y: 18, each: 0.09, delay: 0.95, scale: 0.94 });
    enter(this.lines[3], { y: 12, delay: 1.35 });
  }

  /** Reset: the screen goes at once. */
  snap(): void {
    snapMotion();
  }
}
