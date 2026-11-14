import type { FunctionResponse, LiveServerMessage, Session } from '@google/genai';
import type { AttendingCard } from '../ui/attending';
import { Mic, VoicePlayer } from './mic';
import { SILENT_TOOLS, STRUCTURES, systemPrompt, toolDeclarations, type BrainHost, type Structure } from './tools';

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
  /** Speak the answers aloud as well as showing them. Off by default: speakers near an open mic can echo. */
  voice = false;
  readonly mic = new Mic();

  private session: Session | null = null;
  private player = new VoicePlayer();
  private wanted = false;
  private handle = '';
  private retryTimer = 0;
  private retryDelay = 1000;
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
        // Audio only flows while a session is open; nothing is recorded or kept.
        if (this.session) {
          try { this.session.sendRealtimeInput({ audio: { data: chunk, mimeType: 'audio/pcm;rate=16000' } }); } catch { /* socket closing */ }
        }
      });
    } catch (err) {
      this.wanted = false;
      const name = err instanceof DOMException ? err.name : '';
      this.setState('error', name === 'NotAllowedError' ? 'Microphone permission was not given' : 'No microphone could be opened');
      return;
    }
    void this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.generation++;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.thinkTimer);
    this.mic.stop();
    this.player.stop();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.handle = '';
    this.setState('off');
  }

  private scheduleReconnect(detail: string): void {
    if (!this.wanted) return;
    this.session = null;
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
    const level = this.compat;
    try {
      const res = await fetch(`/api/gemini-token${level >= 1 ? '?lock=0' : ''}`, { method: 'POST', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === 'not_configured') {
          this.wanted = false;
          this.mic.stop();
          this.setState('error', 'Gemini is not set up: add GEMINI_API_KEY to vision/.env.local and restart');
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
          } : level === 1 ? {
            tools: [{ functionDeclarations: toolDeclarations() }],
          } : {}),
        },
        callbacks: {
          onopen: () => {
            if (generation !== this.generation) return;
            this.retryDelay = 1000;
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
    this.setState('error', `Gemini would not start a session: ${reason.slice(0, 140)}`);
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
    if (this.userSpoke) this.card.finish(9);
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
      this.card.wake('listening', this.question.trim());
      this.setState('hearing');
      window.clearTimeout(this.thinkTimer);
      this.thinkTimer = window.setTimeout(() => {
        if (this.state === 'hearing') {
          this.card.setState('thinking');
          this.setState('thinking');
        }
      }, 900);
    }

    if (content?.interrupted) {
      // They spoke over the answer: stop talking and drop the half-shown answer.
      this.player.stop();
      this.answer = '';
      this.cardShown = false;
    }

    if (content?.outputTranscription?.text) {
      this.beginTurn();
      if (this.userSpoke) {
        this.answer += content.outputTranscription.text;
        window.clearTimeout(this.thinkTimer);
        this.setState('answering');
        // The written card, when the model sends one, is the cleaner text; until then show what it is saying.
        if (!this.cardShown) this.card.stream(this.answer.trim(), this.question.trim());
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

  private runTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const host = this.host;
    switch (name) {
      case 'show_answer_card': {
        const text = String(args.text || '').trim();
        if (!text) return { error: 'text is required' };
        // Only show cards that answer something the trainee actually asked.
        if (this.userSpoke) {
          this.cardShown = true;
          this.card.say(text, { question: this.question.trim(), title: String(args.title || '').trim(), hold: 0 });
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
