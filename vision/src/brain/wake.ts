/**
 * Hands-free: listens for "Hey Gemini" with Chrome's Web Speech API, continuously, and reports the words
 * that follow as they are recognised. The Gemini Live turn itself is opened by the caller; this only
 * decides when someone is talking to Gemini and what they are saying.
 *
 * Chrome sends the microphone to Google's speech service for this, so it needs the internet. When it is
 * not available (another browser, no connection, permission refused) `state` says so and push-to-talk
 * carries on working by itself.
 */

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { isFinal: boolean; length: number; [index: number]: RecognitionAlternative }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } }
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type WakeState = 'off' | 'listening' | 'unsupported' | 'blocked' | 'offline';

export interface WakeHandlers {
  /** "Hey Gemini" was heard. `rest` is anything already said after it. */
  onWake(rest: string): void;
  /** The words of the question so far (while a turn is open). */
  onWords(text: string): void;
  /** The speaker paused: the recogniser has settled on these words. */
  onPause(text: string): void;
  onState?(state: WakeState): void;
}

// "Hey Gemini" as a recogniser may write it down. The greeting is required: the word alone comes up in
// ordinary talk about the demo.
const WAKE = /\b(?:hey|hay|heyy|hi|hello|okay|ok|yo)[\s,.!]+(?:gemini|geminy|gemeni|gemmini|geminai|jiminy|jemini|gemina|jim and (?:i|eye)|gem and (?:i|eye)|gem in (?:i|eye)|gemma nye|germany)\b[\s,.!?]*/i;

/** The text with a leading "Hey Gemini" (as a person or a transcript would write it) removed. */
export function withoutWakePhrase(text: string): string {
  const match = WAKE.exec(text);
  if (!match || match.index > 12) return text.trim();
  return text.slice(match.index + match[0].length).trim();
}

export class WakeListener {
  state: WakeState = 'off';
  /** Results are ignored while this returns true (Gemini is thinking or speaking). */
  busy: () => boolean = () => false;

  private recognition: Recognition | null = null;
  private wanted = false;
  private restartTimer = 0;
  private restartDelay = 300;
  /** A turn is open: everything heard is the question. */
  private capturing = false;
  /** Index of the first recogniser result that belongs to the open turn, and where in it the question starts. */
  private fromResult = 0;
  private fromChar = 0;
  /** Results already used to open a turn: never fire twice on the same words. */
  private consumedUpTo = -1;
  private lastResults: Array<{ text: string; final: boolean }> = [];

  constructor(private handlers: WakeHandlers) {}

  static get supported(): boolean {
    const w = window as unknown as Record<string, unknown>;
    return typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function';
  }

  start(): void {
    if (this.wanted) return;
    if (!WakeListener.supported) {
      this.setState('unsupported');
      return;
    }
    this.wanted = true;
    this.open();
  }

  stop(): void {
    this.wanted = false;
    window.clearTimeout(this.restartTimer);
    try { this.recognition?.abort(); } catch { /* not running */ }
    this.recognition = null;
    this.capturing = false;
    this.setState('off');
  }

  /** A turn was opened some other way (the talk button): what is said from now on is the question. */
  beginCapture(): void {
    this.capturing = true;
    this.fromResult = this.lastResults.length > 0 && !this.lastResults[this.lastResults.length - 1].final
      ? this.lastResults.length - 1
      : this.lastResults.length;
    this.fromChar = this.fromResult < this.lastResults.length ? this.lastResults[this.fromResult].text.length : 0;
  }

  /** The turn is over: back to waiting for the wake phrase. */
  endCapture(): void {
    this.capturing = false;
    this.consumedUpTo = this.lastResults.length - 1;
  }

  /**
   * For tests with nobody at the microphone: the recogniser's results as it would report them
   * (one string per result so far, and whether the last one is final).
   */
  feed(texts: string[], lastIsFinal: boolean): void {
    this.setState('listening'); // results only ever come from a running recogniser
    this.take(texts.map((text, i) => ({ text, final: i < texts.length - 1 || lastIsFinal })));
  }

  private setState(state: WakeState): void {
    if (state === this.state) return;
    this.state = state;
    this.handlers.onState?.(state);
  }

  private open(): void {
    if (!this.wanted) return;
    const w = window as unknown as Record<string, new () => Recognition>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      this.restartDelay = 300;
      this.setState('listening');
    };
    recognition.onresult = (event) => {
      const results: Array<{ text: string; final: boolean }> = [];
      for (let i = 0; i < event.results.length; i++) {
        results.push({ text: event.results[i][0]?.transcript ?? '', final: event.results[i].isFinal });
      }
      this.take(results);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wanted = false;
        this.setState('blocked');
      } else if (event.error === 'network') {
        this.setState('offline');
        this.restartDelay = Math.min(this.restartDelay * 2, 8000);
      }
      // 'no-speech' and 'aborted' are routine: onend restarts it.
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      // A new recogniser starts its results from zero.
      this.lastResults = [];
      this.consumedUpTo = -1;
      if (this.capturing) { this.fromResult = 0; this.fromChar = 0; }
      if (!this.wanted) return;
      window.clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(() => this.open(), this.restartDelay);
    };
    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // Already starting: onend will bring it round again.
    }
  }

  private take(results: Array<{ text: string; final: boolean }>): void {
    this.lastResults = results;
    if (results.length === 0) return;
    const last = results.length - 1;

    if (!this.capturing) {
      if (this.busy()) {
        // Gemini is talking: whatever the microphone picks up now is not for it.
        this.consumedUpTo = last;
        return;
      }
      // Look for the wake phrase in what has not been used yet.
      for (let i = Math.max(0, this.consumedUpTo + 1); i <= last; i++) {
        const match = WAKE.exec(results[i].text);
        if (!match) continue;
        this.capturing = true;
        this.fromResult = i;
        this.fromChar = match.index + match[0].length;
        this.consumedUpTo = last;
        this.handlers.onWake(this.questionFrom(results));
        break;
      }
      if (!this.capturing) return;
    }

    const text = this.questionFrom(results);
    this.handlers.onWords(text);
    if (results[last].final && text) this.handlers.onPause(text);
  }

  private questionFrom(results: Array<{ text: string; final: boolean }>): string {
    const parts: string[] = [];
    for (let i = this.fromResult; i < results.length; i++) {
      parts.push(i === this.fromResult ? results[i].text.slice(this.fromChar) : results[i].text);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
}
