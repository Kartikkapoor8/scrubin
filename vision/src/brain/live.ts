import type { FunctionResponse, LiveServerMessage, Session } from '@google/genai';
import type { AttendingCard } from '../ui/attending';
import { Mic, VoicePlayer } from './mic';
import { SILENT_TOOLS, STRUCTURES, systemPrompt, toolDeclarations, type BrainHost, type Structure } from './tools';
import { WakeListener, withoutWakePhrase } from './wake';

/** What the panel says Gemini did, for each tool that changes the screen. */
const ACTION_TEXT: Record<string, string> = {
  next_step: 'Moved to the next step',
  previous_step: 'Went back a step',
  repeat_step: 'Replaying this step',
  look_at_view: 'Looked at your view',
};
const STRUCTURE_TEXT: Record<string, string> = {
  radial_artery: 'radial artery', ulnar_artery: 'ulnar artery', veins: 'veins', median_nerve: 'median nerve',
  flexor_tendons: 'flexor tendons', danger_zone: 'danger zone', wound: 'wound',
};

/**
 * off         not started
 * connecting  getting a token / opening the session
 * listening   connected, microphone open, nobody talking
 * hearing     the trainee is speaking (their words appear on the card)
 * thinking    they stopped; waiting for the attending
 * answering   the answer is arriving
 * error       cannot work right now (see `detail`)
 */
export type BrainState = 'off' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'answering' | 'error';

/**
 * The Gemini attending. Opens a Gemini Live session from the page with a short-lived token from our own
 * server (the API key never reaches the browser), streams the microphone to it, and turns what comes back
 * into Attending cards and actions: the trainee's question as it is heard, the answer as it is spoken, and
 * tool calls that move the procedure, light up a structure, show a written card or look at the picture.
 *
 * It is an extra voice on top of a demo that runs without it: every failure here ends in a quiet status
 * and a retry, never in an exception that reaches the rest of the app.
 */
export class AttendingBrain {
  state: BrainState = 'off';
  detail = '';
  /**
   * Speak the answers aloud as well as showing them. On by default: with push-to-talk the microphone only
   * reaches Gemini while the talk button is down, so the attending cannot hear, and interrupt, itself.
   */
  voice = true;
  /**
   * 'push': the microphone reaches Gemini only while the talk button is held (or, after a quick tap, until
   * the speaker stops). 'open': always listening, with Gemini deciding when someone is talking to it.
   */
  talkMode: 'push' | 'open' = 'push';
  readonly mic = new Mic();
  /**
   * Hands-free: "Hey Gemini" opens a question, and the speaker falling silent ends it. The talk button
   * keeps working beside it. Turn off with ?wake=0.
   */
  wakeEnabled = true;
  readonly wake = new WakeListener({
    onWake: (rest) => {
      if (!this.openFromWake()) { this.wake.endCapture(); return; }
      if (rest) this.heard(rest);
    },
    onWords: (text) => this.heard(text),
    onPause: () => this.pauseHeard(),
    onState: () => this.card.setIdleHint(this.idleHint()),
  });

  private session: Session | null = null;
  private player = new VoicePlayer();
  private wanted = false;
  private handle = '';
  private retryTimer = 0;
  private retryDelay = 1000;
  /** Connection attempts that failed since the last session that opened. */
  private dropped = 0;
  private generation = 0;

  /**
   * How much of the Live API's optional machinery the session asks for. This was written without a key to
   * try it against, so if a session is refused before it starts, the next attempt asks for less:
   *   0  everything: tool behaviours, context compression, session resumption, model-locked token
   *   1  plain tools, none of the optional session features, unlocked token
   *   2  no tools at all: questions are still answered on the card from the spoken transcript
   * The first level that works is kept.
   */
  private compat = 0;
  private setupSeen = false;
  private failuresAtLevel = 0;

  /** A test is feeding recorded speech: the real microphone's audio is dropped (see injectSpeech). */
  private micMuted = false;

  // Push-to-talk.
  private gateOpen = false;
  /** The session was opened with Gemini's own voice detection off: we mark where each question starts and ends. */
  private manualTurns = false;
  /** A quick tap rather than a hold: the gate stays open until the speaker falls silent. */
  private latched = false;
  private talkStartedAt = 0;
  private heardAt = 0;
  private talkTimer = 0;
  private answerTimer = 0;
  private pauseTimer = 0;
  /** The question as the browser's own recogniser hears it, live (shown in preference to Gemini's later transcript). */
  private liveQuestion = '';

  // The turn in progress.
  private question = '';
  private answer = '';
  private userSpoke = false;
  private cardShown = false;
  private turnActive = false;
  private thinkTimer = 0;
  private pendingState = '';
  private lastStateSent = '';

  constructor(
    private host: BrainHost,
    private card: AttendingCard,
    private onState: (state: BrainState, detail: string) => void,
  ) {}

  get running(): boolean {
    return this.wanted;
  }

  /** True while the microphone is being sent to Gemini. */
  get talking(): boolean {
    return this.talkMode === 'open' ? this.session !== null : this.gateOpen;
  }

  /** Gemini's voice is playing right now (it can outlast the written answer by a few seconds). */
  get speaking(): boolean {
    return this.player.speaking;
  }

  /** 0..1 loudness of Gemini's voice, for the waveform. */
  get voiceLevel(): number {
    return this.player.level;
  }

  /**
   * Talk button pressed (key, presenter, phone remote). The first press also turns the attending on.
   * `prerollMs`: also send this much of what the microphone has just heard (a key held for talking is only
   * told from a tap a moment after the speaker has started).
   */
  talkDown(prerollMs = 0): void {
    this.mic.resume();
    if (!this.wanted) {
      void this.start();
      return;
    }
    if (this.talkMode === 'open' || !this.session) return;
    if (this.latched) {
      this.closeGate(); // a second tap ends a tapped question
      return;
    }
    if (!this.gateOpen) this.openGate(prerollMs, false);
  }

  /**
   * Talk button released. A hold ends the question here; a quick tap leaves it open until the speaker
   * stops. `force`: the release always ends it (a key that only talks when held).
   * Returns true when the press turned out to be empty (over almost at once, nothing said).
   */
  talkUp(force = false): boolean {
    if (!this.gateOpen || this.latched) return false;
    if (force || performance.now() - this.talkStartedAt >= 350) return this.closeGate();
    this.latched = true;
    return false;
  }

  /** A session is open: a talk button will be heard. */
  get ready(): boolean {
    return this.wanted && this.session !== null;
  }

  /** "Hey Gemini" was heard: open a question that ends when the speaker stops. False if that is not possible now. */
  private openFromWake(): boolean {
    if (!this.wanted || !this.session || this.talkMode === 'open' || this.gateOpen) return false;
    // The phrase is recognised a moment after it is said: send what was said since, so the question is whole.
    this.openGate(1800, true);
    this.latched = true;
    return true;
  }

  /** The question's words so far, from the browser's recogniser. */
  private heard(text: string): void {
    if (!this.gateOpen || !text) return;
    window.clearTimeout(this.pauseTimer);
    this.heardAt = performance.now();
    this.liveQuestion = text;
    this.card.wake('listening', text);
  }

  /** The recogniser thinks the speaker has paused. With nobody holding a button, that ends the question. */
  private pauseHeard(): void {
    if (!this.gateOpen || !this.latched) return;
    window.clearTimeout(this.pauseTimer);
    // New words within the next moment cancel this (see heard()).
    this.pauseTimer = window.setTimeout(() => {
      if (this.gateOpen && this.latched) this.closeGate();
    }, 450);
  }

  /** The browser's recogniser is running, so what was said is known in words, not just as loudness. */
  private wordsKnown(): boolean {
    return this.wakeEnabled && this.wake.state === 'listening';
  }

  /** What the panel invites people to do, given what is working. */
  private idleHint(): string {
    return this.wakeEnabled && this.wake.state === 'listening' ? 'Say \u201CHey Gemini\u201D' : 'Hold Space and ask';
  }

  private openGate(prerollMs: number, fromWake: boolean): void {
    if (!this.session) return;
    this.player.stop(); // the trainee has the floor
    this.gateOpen = true;
    this.latched = false;
    this.talkStartedAt = performance.now();
    this.heardAt = 0;
    this.liveQuestion = '';
    window.clearTimeout(this.answerTimer);
    window.clearTimeout(this.pauseTimer);
    if (this.manualTurns) {
      try { this.session.sendRealtimeInput({ activityStart: {} }); } catch { /* socket closing */ }
    }
    if (prerollMs > 0 && !this.micMuted) {
      for (const chunk of this.mic.lastChunks(prerollMs)) this.sendSpeech(chunk);
    }
    // From here on, what the recogniser hears is the question (a wake phrase has already told it where to start).
    if (!fromWake) this.wake.beginCapture();
    this.turnActive = false;
    this.beginTurn();
    this.card.wake('listening');
    this.setState('hearing');

    window.clearInterval(this.talkTimer);
    this.talkTimer = window.setInterval(() => {
      const now = performance.now();
      // While the browser's recogniser is running, "someone spoke" means it heard words; loudness alone
      // (a noisy hall) does not count. Without it, loudness is all there is to go on.
      if (!this.wordsKnown() && this.mic.speaking) this.heardAt = now;
      const tooLong = now - this.talkStartedAt > 15000;
      const quietFor = this.wordsKnown() ? 2600 : 1600;
      const finished = this.latched && this.heardAt > 0 && now - this.heardAt > quietFor;
      const nobodySpoke = this.latched && this.heardAt === 0 && now - this.talkStartedAt > 6000;
      if (nobodySpoke) this.closeGate(true);
      else if (tooLong || finished) this.closeGate();
    }, 100);
  }

  /**
   * `nothingSaid`: the turn is known to be empty; go back to Ready without waiting for an answer.
   * Returns true when the turn was dropped as empty.
   */
  private closeGate(nothingSaid = false): boolean {
    window.clearInterval(this.talkTimer);
    window.clearTimeout(this.pauseTimer);
    if (!this.gateOpen) return false;
    this.gateOpen = false;
    this.latched = false;
    this.wake.endCapture();
    try {
      // Tell Gemini the question is over, so it answers at once instead of waiting for more.
      this.session?.sendRealtimeInput(this.manualTurns ? { activityEnd: {} } : { audioStreamEnd: true });
    } catch { /* socket closing */ }
    // "Hey Gemini" with nothing after it, or a press that was over almost at once with nothing said (a slip
    // of the finger): not a question. Back to Ready, quietly.
    const slip = this.heardAt === 0 && performance.now() - this.talkStartedAt < 900;
    if ((nothingSaid || slip) && !this.liveQuestion && !this.userSpoke) {
      this.turnActive = false;
      this.card.hide();
      this.setState(this.wanted && this.session ? 'listening' : 'off');
      return true;
    }
    this.card.setState('thinking');
    this.setState('thinking');
    // Nothing said, or nothing came back: do not sit on "thinking" for ever.
    window.clearTimeout(this.answerTimer);
    this.answerTimer = window.setTimeout(() => {
      if (this.state === 'thinking') {
        this.turnActive = false;
        this.userSpoke = false;
        this.card.hide();
        this.setState(this.wanted && this.session ? 'listening' : 'off');
      }
    }, 9000);
    return false;
  }

  /** Stop speaking and stop listening, now (reset). The session stays connected. */
  silence(): void {
    this.player.stop();
    window.clearTimeout(this.answerTimer);
    window.clearTimeout(this.thinkTimer);
    window.clearTimeout(this.pauseTimer);
    if (this.gateOpen) {
      window.clearInterval(this.talkTimer);
      this.gateOpen = false;
      this.latched = false;
      this.wake.endCapture();
      try { this.session?.sendRealtimeInput(this.manualTurns ? { activityEnd: {} } : { audioStreamEnd: true }); } catch { /* closing */ }
    }
    this.turnActive = false;
    this.userSpoke = false;
    if (this.wanted && this.session) this.setState('listening');
  }

  /** Switch between push-to-talk and an open microphone. Takes effect on a fresh session. */
  setTalkMode(mode: 'push' | 'open'): void {
    if (mode === this.talkMode) return;
    this.closeGate();
    this.talkMode = mode;
    if (this.wanted && this.session) {
      this.generation++;
      try { this.session.close(); } catch { /* closed */ }
      this.session = null;
      void this.connect();
    }
  }

  /**
   * Audio only flows while a session is open and, with push-to-talk, while the talk button is down.
   * Nothing is recorded or kept.
   */
  private sendSpeech(base64Pcm: string): void {
    if (this.session && (this.talkMode === 'open' || this.gateOpen)) {
      try { this.session.sendRealtimeInput({ audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' } }); } catch { /* socket closing */ }
    }
  }

  /**
   * For tests with no person at the microphone (dev/ask.mjs): recorded speech, 16 kHz 16-bit mono, goes
   * down exactly the path the microphone's audio takes, gate included. The real microphone is left out
   * meanwhile so the two do not mix; call with an empty string to hand it back.
   */
  injectSpeech(base64Pcm: string): void {
    this.micMuted = base64Pcm !== '';
    if (base64Pcm) this.sendSpeech(base64Pcm);
  }

  /** What a test needs to know about the session: is it up, and how much of the Live API it is using. */
  get sessionInfo(): { connected: boolean; level: number; manualTurns: boolean; talkMode: string } {
    return { connected: this.session !== null, level: this.compat, manualTurns: this.manualTurns, talkMode: this.talkMode };
  }

  private setState(state: BrainState, detail = ''): void {
    this.state = state;
    this.detail = detail;
    this.onState(state, detail);
  }

  /** Turn the attending on: microphone first (it needs the operator's key press), then the session. */
  async start(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    this.failuresAtLevel = 0;
    this.setState('connecting', 'Opening the microphone');
    try {
      await this.mic.start((chunk) => {
        if (!this.micMuted) this.sendSpeech(chunk);
      });
    } catch (err) {
      this.wanted = false;
      const name = err instanceof DOMException ? err.name : '';
      this.setState('error', name === 'NotAllowedError' ? 'Microphone permission was not given' : 'No microphone could be opened');
      return;
    }
    // Gemini is thinking or speaking: nothing the microphone picks up then is for it.
    this.wake.busy = () => this.state === 'thinking' || this.state === 'answering' || this.player.speaking;
    if (this.wakeEnabled) this.wake.start();
    this.card.setIdleHint(this.idleHint());
    void this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.generation++;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.thinkTimer);
    window.clearTimeout(this.answerTimer);
    window.clearInterval(this.talkTimer);
    window.clearTimeout(this.pauseTimer);
    this.gateOpen = false;
    this.latched = false;
    this.wake.stop();
    this.mic.stop();
    this.player.stop();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.handle = '';
    this.setState('off');
  }

  /** Gemini has not answered several connection attempts in a row. It keeps trying; the operator's chip says so. */
  get offline(): boolean {
    return this.dropped >= 3;
  }

  private scheduleReconnect(detail: string): void {
    if (!this.wanted) return;
    this.session = null;
    this.dropped++;
    this.setState('connecting', detail);
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.7, 6000);
  }

  private async connect(): Promise<void> {
    if (!this.wanted) return;
    const generation = ++this.generation;
    this.setState('connecting', 'Connecting to Gemini');

    let token = '';
    let model = '';
    this.setupSeen = false;
    this.gateOpen = false;
    this.latched = false;
    const level = this.compat;
    // Marking the start and end of each question ourselves is part of the full setup only.
    this.manualTurns = level === 0 && this.talkMode === 'push';
    try {
      const res = await fetch(`/api/gemini-token${level >= 1 ? '?lock=0' : ''}`, { method: 'POST', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === 'not_configured') {
          this.wanted = false;
          this.mic.stop();
          this.wake.stop(); // nothing to wake: do not leave the browser's recogniser listening
          this.setState('error', 'Gemini is not set up: add GEMINI_API_KEY to vision/.env.local (no restart needed), then press G');
          return;
        }
        throw new Error(body.detail || `token request failed (${res.status})`);
      }
      token = body.token;
      model = body.model;
    } catch (err) {
      if (generation === this.generation) this.scheduleReconnect(err instanceof Error ? err.message : 'Could not get a token');
      return;
    }

    try {
      const genai = await import('@google/genai');
      if (generation !== this.generation) return;
      const ai = new genai.GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1beta' } });
      const session = await ai.live.connect({
        model,
        config: {
          responseModalities: [genai.Modality.AUDIO],
          systemInstruction: systemPrompt(level < 2),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          ...(level === 0 ? {
            tools: [{ functionDeclarations: toolDeclarations(genai.Behavior.BLOCKING, genai.Behavior.NON_BLOCKING) }],
            // Long demos: let the server trim old context instead of ending the session.
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: this.handle ? { handle: this.handle } : {},
            ...(this.manualTurns ? { realtimeInputConfig: { automaticActivityDetection: { disabled: true } } } : {}),
          } : level === 1 ? {
            tools: [{ functionDeclarations: toolDeclarations() }],
          } : {}),
        },
        callbacks: {
          onopen: () => {
            if (generation !== this.generation) return;
            this.retryDelay = 1000;
            this.dropped = 0;
            this.setState('listening');
          },
          onmessage: (message: LiveServerMessage) => {
            if (generation !== this.generation) return;
            if (!this.setupSeen) {
              // The server accepted this setup: remember that it works.
              this.setupSeen = true;
              this.failuresAtLevel = 0;
            }
            try {
              this.handleMessage(message);
            } catch (err) {
              console.error('[attending] could not handle a message', err);
            }
          },
          onerror: (event: ErrorEvent) => {
            console.warn('[attending] session error:', event.message || event);
          },
          onclose: (event: CloseEvent) => {
            if (generation !== this.generation) return;
            if (event.reason) console.warn('[attending] session closed:', event.code, event.reason);
            if (!this.setupSeen && this.refused(event.reason || `closed with code ${event.code}`)) return;
            this.scheduleReconnect(event.reason ? `Gemini closed the session: ${event.reason.slice(0, 120)}` : 'Reconnecting to Gemini');
          },
        },
      });
      if (generation !== this.generation) {
        session.close();
        return;
      }
      this.session = session;
      this.lastStateSent = '';
      this.noteState();
    } catch (err) {
      if (generation === this.generation) {
        console.warn('[attending] could not open a session', err);
        if (this.refused(err instanceof Error ? err.message : 'could not open a session')) return;
        this.scheduleReconnect('Could not open a Gemini session');
      }
    }
  }

  /**
   * A session ended before the server ever answered. Twice at the same level: ask for less next time.
   * Out of levels: stop and say why, rather than retrying for ever. Returns true if it stopped.
   */
  private refused(reason: string): boolean {
    this.failuresAtLevel++;
    if (this.failuresAtLevel < 2) return false;
    this.failuresAtLevel = 0;
    if (this.compat < 2) {
      this.compat++;
      this.handle = '';
      console.warn(`[attending] session refused twice (${reason}); retrying with a simpler setup (level ${this.compat})`);
      return false;
    }
    this.compat = 0;
    this.wanted = false;
    this.generation++;
    this.session = null;
    this.mic.stop();
    this.wake.stop();
    // The reason is for the console; the screen only ever says, calmly, that Gemini is not there.
    console.warn('[attending] Gemini would not start a session:', reason);
    this.setState('error', 'Gemini is not available right now');
    return true;
  }

  /** Tell the model where the procedure is. Sent when nobody is mid-sentence; the model does not reply. */
  noteState(): void {
    const text = `[state] ${this.host.describeState()}`;
    if (text === this.lastStateSent) return;
    this.pendingState = text;
    if (!this.turnActive) this.flushState();
  }

  private flushState(): void {
    if (!this.pendingState || !this.session) return;
    try {
      this.session.sendRealtimeInput({ text: this.pendingState });
      this.lastStateSent = this.pendingState;
    } catch { /* socket closing; the next connect sends it */ }
    this.pendingState = '';
  }

  /** Ask a question in text instead of by voice (for testing from the console: __viper.ask('...')). */
  ask(text: string): boolean {
    if (!this.session) return false;
    this.turnActive = false;
    this.beginTurn();
    this.userSpoke = true;
    this.question = text;
    this.card.wake('thinking', text);
    this.setState('thinking');
    this.session.sendRealtimeInput({ text });
    return true;
  }

  /** Send the current picture without being asked (operator key). */
  sendView(): boolean {
    const image = this.host.captureView();
    if (!image || !this.session) return false;
    this.session.sendRealtimeInput({ video: { data: image, mimeType: 'image/jpeg' } });
    return true;
  }

  /** The question as shown: the browser's live words if it heard any, otherwise Gemini's transcript. */
  private shownQuestion(): string {
    return this.liveQuestion || withoutWakePhrase(this.question.trim());
  }

  private beginTurn(): void {
    if (this.turnActive) return;
    this.turnActive = true;
    this.question = '';
    this.answer = '';
    this.userSpoke = false;
    this.cardShown = false;
  }

  private endTurn(): void {
    window.clearTimeout(this.thinkTimer);
    window.clearTimeout(this.answerTimer);
    if (this.userSpoke) {
      // Answered: keep it up for a while. Heard but not answered (it was not meant for Gemini): clear it.
      if (this.answer.trim() || this.cardShown) this.card.finish(9);
      else this.card.hide();
    }
    this.turnActive = false;
    this.userSpoke = false;
    if (this.state !== 'off' && this.state !== 'error' && this.state !== 'connecting') this.setState(this.wanted ? 'listening' : 'off');
    this.flushState();
  }

  /** Public so the handling can be exercised with made-up messages (dev/shot.mjs, no API key needed). */
  handleMessage(message: LiveServerMessage): void {
    const content = message.serverContent;

    if (content?.inputTranscription?.text) {
      // The trainee is talking. A new question replaces whatever the card was showing.
      if (!this.turnActive || (!this.userSpoke && this.answer)) {
        this.turnActive = false;
        this.beginTurn();
      }
      this.userSpoke = true;
      this.question += content.inputTranscription.text;
      window.clearTimeout(this.thinkTimer);
      if (this.gateOpen || this.talkMode === 'open') {
        this.card.wake('listening', this.shownQuestion());
        this.setState('hearing');
        // With an open microphone there is no button to say the question is over: assume it is when the
        // words stop arriving.
        if (this.talkMode === 'open') {
          this.thinkTimer = window.setTimeout(() => {
            if (this.state === 'hearing') {
              this.card.setState('thinking');
              this.setState('thinking');
            }
          }, 900);
        }
      } else {
        // The transcript can trail the button: keep "thinking", just fill in the words.
        this.card.wake('thinking', this.shownQuestion());
      }
    }

    if (content?.interrupted) {
      // They spoke over the answer: stop talking and drop the half-shown answer.
      this.player.stop();
      this.answer = '';
      this.cardShown = false;
    }

    if (content?.outputTranscription?.text) {
      this.beginTurn();
      window.clearTimeout(this.answerTimer);
      if (this.userSpoke) {
        this.answer += content.outputTranscription.text;
        window.clearTimeout(this.thinkTimer);
        this.setState('answering');
        // The written card, when the model sends one, is the cleaner text; until then show what it is saying.
        if (!this.cardShown) this.card.stream(this.answer.trim(), this.shownQuestion());
      }
    }

    const parts = content?.modelTurn?.parts;
    if (parts) {
      this.beginTurn();
      if (this.voice && this.userSpoke) {
        for (const part of parts) {
          const data = part.inlineData?.data;
          if (data && (part.inlineData?.mimeType || '').startsWith('audio/')) this.player.play(data);
        }
      }
    }

    const calls = message.toolCall?.functionCalls;
    if (calls && calls.length > 0) {
      this.beginTurn();
      const responses: FunctionResponse[] = [];
      for (const call of calls) {
        const name = call.name || '';
        let response: Record<string, unknown>;
        try {
          response = this.runTool(name, call.args || {});
          if (!response.error) this.showAction(name, call.args || {});
        } catch (err) {
          response = { error: err instanceof Error ? err.message : 'failed' };
        }
        const functionResponse: FunctionResponse = { id: call.id, name, response };
        // Tools that only change the screen need no spoken follow-up.
        if (this.compat === 0 && SILENT_TOOLS.has(name)) (functionResponse as { scheduling?: string }).scheduling = 'SILENT';
        responses.push(functionResponse);
      }
      try {
        this.session?.sendToolResponse({ functionResponses: responses });
      } catch (err) {
        console.warn('[attending] could not answer a tool call', err);
      }
    }

    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.handle = message.sessionResumptionUpdate.newHandle;
    }

    if (message.goAway) {
      // The server is about to close this connection (they last about ten minutes): open the next one now.
      this.generation++;
      const old = this.session;
      this.session = null;
      window.setTimeout(() => { try { old?.close(); } catch { /* closed */ } }, 500);
      void this.connect();
    }

    if (content?.turnComplete) this.endTurn();
  }

  /** Say on the panel what Gemini just did to the screen. */
  private showAction(name: string, args: Record<string, unknown>): void {
    let text = ACTION_TEXT[name] || '';
    if (name === 'highlight_structure') text = `Showing the ${STRUCTURE_TEXT[String(args.structure || '')] || 'structure'}`;
    if (name === 'go_to_step') text = `Went to the ${String(args.step || '')} step`;
    if (text) this.card.action(text);
  }

  private runTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const host = this.host;
    switch (name) {
      case 'show_answer_card': {
        const text = String(args.text || '').trim();
        if (!text) return { error: 'text is required' };
        // Only show cards that answer something the trainee actually asked.
        if (this.userSpoke) {
          this.cardShown = true;
          this.card.say(text, { question: this.shownQuestion(), title: String(args.title || '').trim(), hold: 0 });
        }
        return { result: 'shown' };
      }
      case 'highlight_structure': {
        const structure = String(args.structure || '') as Structure;
        if (!STRUCTURES.includes(structure)) return { error: `unknown structure; use one of ${STRUCTURES.join(', ')}` };
        host.highlight(structure);
        return { result: 'highlighted' };
      }
      case 'look_at_view': {
        const image = host.captureView();
        if (!image || !this.session) return { error: 'the view is not available right now', state: host.stateData() };
        this.session.sendRealtimeInput({ video: { data: image, mimeType: 'image/jpeg' } });
        return { result: 'The current view was just sent to you as an image.', state: host.stateData() };
      }
      case 'get_procedure_state':
        return host.stateData();
      case 'next_step':
        host.nextStep();
        return { result: 'ok', state: host.stateData() };
      case 'previous_step':
        host.previousStep();
        return { result: 'ok', state: host.stateData() };
      case 'repeat_step':
        host.repeatStep();
        return { result: 'ok', state: host.stateData() };
      case 'go_to_step':
        return host.goToStep(String(args.step || '')) ? { result: 'ok', state: host.stateData() } : { error: 'unknown step' };
      default:
        return { error: `unknown tool ${name}` };
    }
  }
}
