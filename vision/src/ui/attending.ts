import { add, el } from '../core/dom';
import { enter, leave, numerals, sweep, to } from './motion';

export type AttendingState = 'idle' | 'listening' | 'thinking' | 'answering';

const STATE_TEXT: Record<AttendingState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  answering: 'Speaking',
};

type RGB = [number, number, number];
// Green while it is hearing you; otherwise the brand's cyan (amber is kept for caution).
const WAVE_COLOUR: Record<AttendingState, RGB> = {
  idle: [63, 224, 255],
  listening: [77, 255, 176],
  thinking: [63, 224, 255],
  answering: [63, 224, 255],
};

/**
 * The Gemini panel (top right): the question as it is spoken, the answer typing out, a waveform that shows
 * whether Gemini is listening, thinking or speaking, and one line saying where the procedure is.
 * It is on screen whenever the Gemini session is up, and gone when it is not: a panel that says "offline"
 * to an audience helps nobody.
 */
export class AttendingCard {
  private root: HTMLDivElement;
  private stateText: HTMLSpanElement;
  private wave: HTMLCanvasElement;
  private waveCtx: CanvasRenderingContext2D;
  private body: HTMLDivElement;
  private inner: HTMLDivElement;
  private question: HTMLDivElement;
  private title: HTMLDivElement;
  private answer: HTMLDivElement;
  private shown: HTMLSpanElement;
  private rest: HTMLSpanElement;
  private actionLine: HTMLDivElement;
  private hint: HTMLDivElement;
  private context: HTMLDivElement;

  private state: AttendingState = 'idle';
  private online = false;
  private full = '';
  private count = 0;
  private timer = 0;
  private hideTimer = 0;
  private actionTimer = 0;
  /** More text may still arrive (a streamed answer): do not start the hide countdown yet. */
  private open = false;
  private hold = 6;
  private hasQuestion = false;
  private idleHint = 'Say “Hey Gemini”';
  private contextText = '';
  private bodyHeight = -1;
  /** Gemini's voice is still playing: the panel stays on "Speaking" until it stops. */
  private voiceOn = false;
  private typed = false;
  private lineHeight = 0;

  // The waveform.
  private micLevel = 0;
  private voiceLevel = 0;
  private amp = 0.05;
  private colour: RGB = [63, 224, 255];

  constructor(parent: HTMLElement) {
    // The slot is faded by HUD classes (the opening title); the panel inside it is moved by Motion.
    const slot = add(parent, el('div', 'gem-slot'));
    this.root = add(slot, el('div', 'gem glass sweep'));
    this.root.dataset.state = 'idle';
    this.root.style.opacity = '0';

    const head = add(this.root, el('div', 'gem__head'));
    add(head, el('span', 'gem__name', 'Gemini'));
    const state = add(head, el('span', 'gem__state'));
    add(state, el('i', 'gem__dot'));
    this.stateText = add(state, el('span', 'gem__state-text', STATE_TEXT.idle));

    this.wave = add(this.root, el('canvas', 'gem__wave'));
    this.waveCtx = this.wave.getContext('2d')!;

    this.body = add(this.root, el('div', 'gem__body'));
    this.inner = add(this.body, el('div', 'gem__inner'));
    this.question = add(this.inner, el('div', 'gem__q'));
    this.title = add(this.inner, el('div', 'gem__title'));
    this.answer = add(this.inner, el('div', 'gem__a'));
    this.shown = add(this.answer, el('span'));
    add(this.answer, el('span', 'gem__caret'));
    this.rest = add(this.answer, el('span', 'gem__rest'));
    this.actionLine = add(this.inner, el('div', 'gem__action'));
    this.hint = add(this.inner, el('div', 'gem__hint'));

    this.context = add(this.root, el('div', 'gem__ctx'));
    this.renderHint();
    // The body follows the height of what is in it, whatever changed it (words arriving, fonts loading,
    // the window being resized).
    new ResizeObserver(() => this.fit()).observe(this.inner);
    window.addEventListener('resize', () => { this.lineHeight = 0; });
  }

  /** The session is up (show the panel) or not (take it away). */
  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    if (online) {
      enter(this.root, { y: -18, scale: 0.97 });
      sweep(this.root);
      requestAnimationFrame(() => this.fit(true));
    } else {
      // Gone, and nothing stale left on it for when it comes back.
      this.hide();
      leave(this.root, { y: -10 });
    }
  }

  get isOnline(): boolean {
    return this.online;
  }

  /** What the panel invites people to do while nothing is being asked. */
  setIdleHint(text: string): void {
    if (text === this.idleHint) return;
    this.idleHint = text;
    this.renderHint();
  }

  /** One line of procedure context, for example "Step 3 of 6 · Suture 2 of 5". */
  setContext(text: string): void {
    if (text === this.contextText) return;
    this.contextText = text;
    numerals(this.context, text);
  }

  /** Something Gemini did on screen (a tool call), shown for a few seconds under the answer. */
  action(text: string): void {
    window.clearTimeout(this.actionTimer);
    this.actionLine.textContent = text;
    this.actionLine.classList.add('gem__action--on');
    enter(this.actionLine, { y: 8 });
    this.fit();
    this.actionTimer = window.setTimeout(() => {
      this.actionLine.classList.remove('gem__action--on');
      this.fit();
    }, 5200);
  }

  /** Type a complete line out. `hold` = seconds to keep it up afterwards (0 = until replaced). */
  say(text: string, options: { question?: string; title?: string; hold?: number } = {}): void {
    this.full = text;
    this.count = 0;
    this.open = false;
    this.hold = options.hold ?? 6;
    this.setQuestion(options.question || '');
    this.setTitle(options.title || '');
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
      this.setTitle('');
    }
    this.full = text;
    if (question) this.setQuestion(question);
    this.begin();
  }

  /** No more text is coming: once it is typed out, keep it up for `hold` seconds (0 = until replaced). */
  finish(hold = 8): void {
    this.open = false;
    this.hold = hold;
    this.begin();
  }

  setState(state: AttendingState): void {
    if (state !== this.state) {
      this.state = state;
      this.root.dataset.state = state;
      this.stateText.textContent = STATE_TEXT[state];
      this.renderHint();
    }
    if (state === 'listening' || state === 'thinking') window.clearTimeout(this.hideTimer);
  }

  /** Microphone loudness, 0..1: drives the waveform while listening. */
  setLevel(level: number): void {
    this.micLevel = Math.min(1, Math.max(0, level));
  }

  /** Loudness of Gemini's own voice, 0..1: drives the waveform while it speaks. */
  setVoiceLevel(level: number): void {
    this.voiceLevel = Math.min(1, Math.max(0, level));
  }

  /** Whether Gemini's voice is playing. The written answer usually finishes first. */
  setSpeaking(on: boolean): void {
    this.voiceOn = on;
    if (on && this.state === 'thinking') this.setState('answering');
  }

  /** A status and the question so far (while Gemini is listening or thinking). */
  wake(state: AttendingState, question = ''): void {
    // A new question (or the talk button going down): the previous answer no longer belongs here, even
    // if it was still being typed or spoken.
    if (state === 'listening' && this.actionLine.classList.contains('gem__action--on') && this.state !== 'listening') {
      window.clearTimeout(this.actionTimer);
      this.actionLine.classList.remove('gem__action--on');
    }
    if (state === 'listening' && this.full !== '') {
      window.clearInterval(this.timer);
      this.timer = 0;
      window.clearTimeout(this.hideTimer);
      this.open = false;
      this.typed = false;
      this.clearAnswer();
      if (!question) this.setQuestion('');
    }
    if (question) this.setQuestion(question);
    this.setState(state);
    this.fit();
  }

  /** Clear the question and answer. The panel itself stays while the session is up. */
  hide(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    window.clearTimeout(this.hideTimer);
    this.open = false;
    this.typed = false;
    this.clearAnswer();
    this.setQuestion('');
    this.setState('idle');
    this.fit();
  }

  /** Every display frame: the waveform. */
  update(t: number, dt: number): void {
    // Typed out and the voice has finished: back to Ready, and start the countdown to clearing the answer.
    if (this.typed && !this.voiceOn) {
      this.typed = false;
      this.setState('idle');
      if (this.hold > 0) this.hideTimer = window.setTimeout(() => this.hide(), this.hold * 1000);
    }
    if (!this.online) return;
    const canvas = this.wave;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 4 || height < 4) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = this.waveCtx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const state = this.state;
    // Ready: a quiet line that stirs with the room, so it is plain the panel is listening for its name.
    const target = state === 'listening' ? 0.3 + this.micLevel * 1.05
      : state === 'answering' ? 0.3 + this.voiceLevel * 1.1
      : state === 'thinking' ? 0.8
      : 0.17 + this.micLevel * 0.4;
    this.amp += (Math.min(1, target) - this.amp) * (1 - Math.exp(-(target > this.amp ? 20 : 7) * dt));
    const want = WAVE_COLOUR[state];
    const k = 1 - Math.exp(-8 * dt);
    for (let i = 0; i < 3; i++) this.colour[i] += (want[i] - this.colour[i]) * k;
    const [r, g, b] = this.colour.map(Math.round);

    const mid = height / 2;
    const reach = height * 0.46;
    // While thinking, a packet of energy runs along the line again and again.
    const packet = ((t * 0.62) % 1.3) - 0.15;
    const layers = [
      { freq: 1.55, speed: 2.3, gain: 1, line: 2.4, alpha: 0.95 },
      { freq: 2.6, speed: -3.2, gain: 0.68, line: 1.6, alpha: 0.6 },
      { freq: 4.2, speed: 4.6, gain: 0.42, line: 1.2, alpha: 0.42 },
    ];
    const yAt = (u: number, layer: (typeof layers)[number], index: number): number => {
      let envelope = Math.pow(Math.sin(Math.PI * u), 1.6);
      if (state === 'thinking') envelope *= 0.22 + 0.95 * Math.exp(-((u - packet) ** 2) / 0.03);
      const wobble = 0.72 + 0.28 * Math.sin(t * 1.3 + u * 3.1 + index * 2.1);
      return Math.sin(u * layer.freq * Math.PI * 2 + t * layer.speed + index * 1.7) * envelope * wobble * this.amp * layer.gain * reach;
    };

    // The line everything rests on.
    const base = ctx.createLinearGradient(0, 0, width, 0);
    base.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    base.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.32)`);
    base.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = base;
    ctx.fillRect(0, mid - 0.5, width, 1);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const step = 3;
    layers.forEach((layer, index) => {
      // A soft body between the wave and its reflection, then the wave itself, glowing.
      if (index === 0) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += step) ctx.lineTo(x, mid + yAt(x / width, layer, index));
        for (let x = width; x >= 0; x -= step) ctx.lineTo(x, mid - yAt(x / width, layer, index));
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.13)`;
        ctx.fill();
      }
      for (const mirror of index === 0 ? [1, -1] : [1]) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += step) {
          const y = mid + mirror * yAt(x / width, layer, index);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        const fade = ctx.createLinearGradient(0, 0, width, 0);
        const alpha = layer.alpha * (mirror === 1 ? 1 : 0.45);
        fade.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        fade.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        fade.addColorStop(0.5, `rgba(${Math.min(255, r + 90)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, ${alpha})`);
        fade.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        fade.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.strokeStyle = fade;
        ctx.lineWidth = layer.line;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
        ctx.shadowBlur = index === 0 ? 12 : 6;
        ctx.stroke();
      }
    });
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  private clearAnswer(): void {
    this.full = '';
    this.count = 0;
    this.setTitle('');
    this.render();
  }

  private setQuestion(question: string): void {
    this.hasQuestion = Boolean(question);
    this.question.textContent = question ? `“${question}”` : '';
    this.question.classList.toggle('gem__q--on', this.hasQuestion);
    this.renderHint();
  }

  private setTitle(title: string): void {
    this.title.textContent = title;
    this.title.classList.toggle('gem__title--on', Boolean(title));
  }

  private renderHint(): void {
    const answering = this.full !== '';
    let text = '';
    if (!this.hasQuestion && !answering) {
      if (this.state === 'idle') text = this.idleHint;
      else if (this.state === 'listening') text = 'Go ahead, I’m listening';
    }
    if (this.hint.textContent !== text) {
      this.hint.textContent = text;
      this.fit();
    }
    this.hint.classList.toggle('gem__hint--on', text !== '');
  }

  /** Spring the panel's body to the height of what is in it. */
  private fit(immediate = false): void {
    const height = this.inner.offsetHeight;
    if (height === this.bodyHeight && !immediate) return;
    // The first measurement, or one taken while the panel is not on screen, is simply set.
    const jump = immediate || this.bodyHeight < 0 || !this.online;
    this.bodyHeight = height;
    if (jump) this.body.style.height = `${height}px`;
    else to(this.body, { height });
  }

  private begin(): void {
    window.clearTimeout(this.hideTimer);
    this.typed = false;
    this.render();
    this.renderHint();
    this.fit();
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
      this.typed = true; // update() takes it from here, once the voice has stopped too
    }, 28);
  }

  private render(): void {
    this.shown.textContent = this.full.slice(0, this.count);
    this.rest.textContent = this.full.slice(this.count);
    this.answer.classList.toggle('gem__a--on', this.full !== '');
    this.answer.classList.toggle('gem__a--typing', this.count < this.full.length || this.open);
    if (this.full === '') {
      this.answer.style.maxHeight = '';
      this.answer.classList.remove('gem__a--scrolled');
      return;
    }
    // The whole answer is laid out from the start (the part not yet typed is there, unseen), so words never
    // jump between lines; the box shows only as far as the line being written, and grows with it. A long
    // answer keeps to six lines: from then on it scrolls up as it is typed.
    const line = this.lineHeight || (this.lineHeight = parseFloat(getComputedStyle(this.answer).lineHeight) || 30);
    const written = this.rest.offsetTop + line; // bottom of the line the writing has reached
    // Once it is all written the box opens to show the whole answer (up to ten lines), from the start.
    const finished = this.count >= this.full.length && !this.open;
    const room = Math.min(written, line * (finished ? 10 : 6));
    this.answer.style.maxHeight = `${Math.ceil(room)}px`;
    const top = Math.max(0, Math.min(this.answer.scrollHeight - room, written - room));
    this.answer.scrollTop = top;
    this.answer.classList.toggle('gem__a--scrolled', top > 2);
  }
}
