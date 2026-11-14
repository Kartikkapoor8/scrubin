import { add, el } from '../core/dom';

export type AttendingState = 'idle' | 'listening' | 'thinking' | 'answering';

const STATE_TEXT: Record<AttendingState, string> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking',
  answering: '',
};

/**
 * The Attending card (right): what the attending surgeon says, typed out. It carries the scripted comment
 * after each suture and, when Gemini is connected, the spoken questions and their answers.
 */
export class AttendingCard {
  private root: HTMLDivElement;
  private state: HTMLSpanElement;
  private question: HTMLDivElement;
  private shown: HTMLSpanElement;
  private rest: HTMLSpanElement;
  private full = '';
  private count = 0;
  private timer = 0;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = add(parent, el('div', 'panel attending'));
    const head = add(this.root, el('div', 'attending__head'));
    add(head, el('span', 'attending__orb'));
    add(head, el('span', 'panel__label', 'Attending'));
    this.state = add(head, el('span', 'attending__state'));
    this.question = add(this.root, el('div', 'attending__question'));
    const body = add(this.root, el('div', 'attending__text'));
    this.shown = add(body, el('span'));
    this.rest = add(body, el('span', 'attending__rest'));
  }

  /** Type a line out. `hold` = seconds to keep the card up after the typing finishes (0 = until replaced). */
  say(text: string, options: { question?: string; hold?: number } = {}): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.hideTimer);
    this.full = text;
    this.count = 0;
    this.question.textContent = options.question ? `“${options.question}”` : '';
    this.question.classList.toggle('attending__question--on', Boolean(options.question));
    this.render();
    this.root.classList.add('panel--on');
    this.setState('answering');

    const hold = options.hold ?? 6;
    this.timer = window.setInterval(() => {
      // Whole words arrive slightly faster than single letters would; it reads as speech rather than typing.
      this.count = Math.min(this.full.length, this.count + 2);
      this.render();
      if (this.count >= this.full.length) {
        window.clearInterval(this.timer);
        this.setState('idle');
        if (hold > 0) this.hideTimer = window.setTimeout(() => this.hide(), hold * 1000);
      }
    }, 28);
  }

  setState(state: AttendingState): void {
    this.root.dataset.state = state;
    this.state.textContent = STATE_TEXT[state];
    if (state === 'listening' || state === 'thinking') {
      window.clearTimeout(this.hideTimer);
      this.root.classList.add('panel--on');
    }
  }

  /** Show the card with a status only (for example while Gemini is listening), keeping any text. */
  wake(state: AttendingState, question = ''): void {
    if (question) {
      this.question.textContent = `“${question}”`;
      this.question.classList.add('attending__question--on');
    }
    this.setState(state);
  }

  hide(): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.hideTimer);
    this.root.classList.remove('panel--on');
  }

  private render(): void {
    this.shown.textContent = this.full.slice(0, this.count);
    this.rest.textContent = this.full.slice(this.count);
  }
}
