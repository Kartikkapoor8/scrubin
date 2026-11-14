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
  private meter: HTMLSpanElement;
  private title: HTMLSpanElement;
  private question: HTMLDivElement;
  private shown: HTMLSpanElement;
  private rest: HTMLSpanElement;
  private full = '';
  private count = 0;
  private timer = 0;
  private hideTimer = 0;
  /** More text may still arrive (a streamed answer): do not start the hide countdown yet. */
  private open = false;
  private hold = 6;

  constructor(parent: HTMLElement) {
    this.root = add(parent, el('div', 'panel attending'));
    const head = add(this.root, el('div', 'attending__head'));
    add(head, el('span', 'attending__orb'));
    add(head, el('span', 'panel__label', 'Attending'));
    this.title = add(head, el('span', 'attending__title'));
    const status = add(head, el('span', 'attending__state'));
    const meter = add(status, el('span', 'attending__meter'));
    this.meter = add(meter, el('span', 'attending__meter-fill'));
    this.state = add(status, el('span'));
    this.question = add(this.root, el('div', 'attending__question'));
    const body = add(this.root, el('div', 'attending__text'));
    this.shown = add(body, el('span'));
    this.rest = add(body, el('span', 'attending__rest'));
  }

  /** Type a complete line out. `hold` = seconds to keep the card up afterwards (0 = until replaced). */
  say(text: string, options: { question?: string; title?: string; hold?: number } = {}): void {
    this.full = text;
    this.count = 0;
    this.open = false;
    this.hold = options.hold ?? 6;
    this.setQuestion(options.question || '');
    this.title.textContent = options.title ? `· ${options.title}` : '';
    this.begin();
  }

  /**
   * Show an answer that is still arriving: call again with the longer text as more comes in, then finish().
   * The typing carries on from where it was; it never starts over.
   */
  stream(text: string, question = ''): void {
    if (!this.open) {
      this.count = 0;
      this.open = true;
      this.title.textContent = '';
    }
    this.full = text;
    if (question) this.setQuestion(question);
    this.begin();
  }

  /** No more text is coming: once it is typed out, keep the card up for `hold` seconds (0 = until replaced). */
  finish(hold = 8): void {
    this.open = false;
    this.hold = hold;
    this.begin();
  }

  setState(state: AttendingState): void {
    this.root.dataset.state = state;
    this.state.textContent = STATE_TEXT[state];
    if (state === 'listening' || state === 'thinking') {
      window.clearTimeout(this.hideTimer);
      this.root.classList.add('panel--on');
    }
  }

  /** Microphone loudness, 0..1, shown as a small meter while listening so the speaker can see they are heard. */
  setLevel(level: number): void {
    this.meter.style.width = `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`;
  }

  /** Bring the card up with a status and the question so far (while Gemini is listening or thinking). */
  wake(state: AttendingState, question = ''): void {
    if (question) this.setQuestion(question);
    // A new question (or the talk button going down): the previous answer no longer belongs here.
    if (state === 'listening' && !this.open && this.count >= this.full.length && this.full !== '') {
      this.full = '';
      this.count = 0;
      this.title.textContent = '';
      if (!question) this.setQuestion('');
      this.render();
    }
    this.setState(state);
  }

  hide(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    window.clearTimeout(this.hideTimer);
    this.open = false;
    this.root.classList.remove('panel--on');
  }

  private setQuestion(question: string): void {
    this.question.textContent = question ? `\u201C${question}\u201D` : '';
    this.question.classList.toggle('attending__question--on', Boolean(question));
  }

  private begin(): void {
    window.clearTimeout(this.hideTimer);
    this.root.classList.add('panel--on');
    this.render();
    if (this.count < this.full.length) this.setState('answering');
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      if (this.count < this.full.length) {
        // Two letters a tick: it reads as speech rather than as typing.
        this.count = Math.min(this.full.length, this.count + 2);
        this.render();
        return;
      }
      if (this.open) return; // typed everything so far; more is on its way
      window.clearInterval(this.timer);
      this.timer = 0;
      this.setState('idle');
      if (this.hold > 0) this.hideTimer = window.setTimeout(() => this.hide(), this.hold * 1000);
    }, 28);
  }

  private render(): void {
    this.shown.textContent = this.full.slice(0, this.count);
    this.rest.textContent = this.full.slice(this.count);
  }
}
