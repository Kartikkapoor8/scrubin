import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles.css';
import './ui/hud.css';

import { loadSettings, saveSettings, type Scene } from './app/scene';
import { ArmMode } from './arm/mode';
import { add, clamp, el } from './core/dom';
import { Viewport } from './core/viewport';
import { InputManager, QUALITIES, type HoloLensQuality } from './input/manager';
import { LatencyProbe } from './input/latency';
import type { SourceKind } from './input/types';
import { Sounds } from './app/audio';
import { StreamRecording } from './app/recording';
import { connectRemote } from './app/remote';
import { AttendingBrain } from './brain/live';
import type { BrainHost, Structure } from './brain/tools';
import { AnatomyLayer } from './overlay/layers/anatomy';
import { setReadability } from './overlay/draw';
import { DebugLayer } from './overlay/layers/debug';
import { HandLayer } from './overlay/layers/hand';
import { MeasureLayer } from './overlay/layers/measure';
import { PlanLayer } from './overlay/layers/plan';
import { ScanLayer } from './overlay/layers/scan';
import { StitchLayer } from './overlay/layers/stitch';
import { WoundLockLayer } from './overlay/layers/wound';
import { OverlayRenderer } from './overlay/renderer';
import type { StepId } from './procedure/data';
import { Procedure } from './procedure/machine';
import { HandTracker } from './tracking/hands';
import { loadMarker, MARKER_PRESETS, markerFromSample, saveMarker, WoundDetector, WoundTracker } from './tracking/wound';
import { AttendingCard } from './ui/attending';
import { AttractScreen } from './ui/attract';
import { FeedbackToast } from './ui/feedback';
import { Hud } from './ui/hud';
import { ScoreCard } from './ui/score';
import { StepPanel } from './ui/steps';
import { TitleCard } from './ui/title';

interface ServerConfig {
  remote?: { enabled: boolean; pin: string; addresses: string[] };
  hololens: { configured: boolean };
  gemini: { configured: boolean; model: string };
  clips: string[];
}

async function loadConfig(): Promise<ServerConfig> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) return (await res.json()) as ServerConfig;
  } catch { /* the page still works on webcam, file and the simulated arm */ }
  return { hololens: { configured: false }, gemini: { configured: false, model: '' }, clips: [] };
}

const KEYS: Array<[string, string]> = [
  ['Space  →', 'Next: place the next suture, or go to the next step; after the score, start over'],
  ['Hold Space', 'Talk to Gemini: hold, ask, let go (or just say "Hey Gemini")'],
  ['←', 'Previous step'],
  ['Shift →', 'Next step, skipping any sutures not yet placed'],
  ['Presenter', 'Forward = Next, back = previous step, blank-screen button (B or .) = talk'],
  ['S', 'Place the next suture'],
  ['R', 'Reset to Ready, instantly'],
  ['A', 'Autoplay (for recording)'],
  ['H', 'Hide every overlay (clean picture)'],
  ['N', 'Sound on / off'],
  ['G', 'Talk to Gemini: hold and speak, or tap and speak (Shift+G turns Gemini off / on)'],
  ['V', 'Gemini speaks its answers aloud: on / off'],
  ['L', 'Send Gemini the current picture'],
  ['1 2 3 4', 'Input: HoloLens / webcam / video file / simulated arm'],
  ['C', 'Record the raw HoloLens stream to vision/media (C again stops; Shift+C records 60 s)'],
  ['M', 'Arm mode on / off: the backup demo on a bare forearm (also ?mode=arm)'],
  ['K', 'Pick the marker colour: press K, then click the marker line'],
  ['Shift M', 'Next marker colour preset (green, magenta, blue, orange)'],
  ['J', 'Ink only (default) / also track a glowing hologram line as the wound'],
  ['X  Z', 'Flip which end is suture 1 / which side is the far side'],
  ['[  ]', 'Squash or stretch overlays across the arm (camera angle)'],
  ['T', 'Zoom toward the wound while planning and stitching: on / off'],
  ['F', 'Full screen'],
  ['O', 'Fill the screen / show the whole picture'],
  ['D', 'Tracking debug view'],
  ['Y', 'Sync clock and lag probe: look at this screen through the headset; the lag is measured for you'],
  ['Shift Y', 'Latency sweep: measures live_high, live_med and live_low (headset looking at this screen), keeps the fastest'],
  ['Q', 'Headset stream preset: high / med / low (remembered)'],
  ['- =', 'Suture trigger delay, to match that lag (HoloLens input only)'],
  ['?', 'Show or hide this list'],
];

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const config = await loadConfig();
  await document.fonts.ready.catch(() => {});

  // ----- The stage: last good frame, live video, grade, drawn overlays, HUD -----
  const stage = add(document.getElementById('app')!, el('div', 'stage'));
  const hold = add(stage, el('canvas', 'stage__picture'));
  const video = add(stage, el('video', 'stage__picture'));
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  add(stage, el('div', 'stage__grade'));
  const overlayCanvas = add(stage, el('canvas', 'stage__overlay'));
  const hud = new Hud(stage);
  hud.setKeys(KEYS);
  // Clean record mode (?clean=1): what the audience is meant to see and nothing else. No status chips,
  // no operator notices, no mouse pointer.
  if (params.get('clean') === '1') stage.classList.add('stage--clean');

  const view = new Viewport();
  if (params.get('fit') === 'contain') view.fit = 'contain';
  stage.classList.toggle('stage--contain', view.fit === 'contain');
  const renderer = new OverlayRenderer(overlayCanvas);

  // ----- Procedure, tracking and the scene the layers read -----
  const procedure = new Procedure();
  const detector = new WoundDetector();
  const tracker = new WoundTracker();
  const hands = new HandTracker();
  const settings = loadSettings();
  tracker.flipAlong = settings.flipAlong;
  tracker.flipSide = settings.flipSide;
  detector.rejectGlow = settings.inkOnly;

  const scene: Scene = {
    procedure, detector, tracker, hands,
    marker: loadMarker(),
    settings,
    hidden: false,
    debug: params.get('debug') === '1',
    aligned: false,
    toolDistanceMm: -1,
    attract: false,
    input: { live: false, label: '' },
    relockAt: -1e9,
    keepOut: [],
    highlight: { structure: '', until: 0 },
  };

  renderer.add(new ScanLayer(scene));
  renderer.add(new AnatomyLayer(scene));
  renderer.add(new WoundLockLayer(scene));
  renderer.add(new MeasureLayer(scene));
  renderer.add(new PlanLayer(scene));
  renderer.add(new StitchLayer(scene));
  renderer.add(new HandLayer(scene));
  renderer.add(new DebugLayer(scene));

  const rail = new StepPanel(hud.root, procedure);
  // Table mode: lines and lettering on the picture are drawn larger, to carry to someone two metres away.
  if (params.get('big') !== '0') setReadability(1.45, 1.7);

  new TitleCard(hud.root, procedure);
  // Suture feedback and the captions share the bottom of the screen, stacked.
  const bottom = add(hud.root, el('div', 'bottom-stack'));
  new FeedbackToast(bottom, procedure);
  new ScoreCard(bottom, procedure);
  const attending = new AttendingCard(hud.root);
  const attract = new AttractScreen(hud.root);
  // A running clock for measuring how far the headset's picture trails real life (key Y).
  const syncClock = add(hud.root, el('div', 'sync-clock'));
  const syncDigits = add(syncClock, el('div', 'sync-clock__digits', '00.0'));
  add(syncClock, el('div', 'sync-clock__note', 'Look at this screen through the headset. The lag is measured from the flashing square (left); the clock in the picture trails this one by the same amount. Set the suture delay with - and =, then Y.'));
  const syncResult = add(syncClock, el('div', 'sync-clock__result', ''));
  // Flashes on a random schedule while the clock is up; finds that pattern in the headset's picture.
  const probe = new LatencyProbe(hud.root);
  const sounds = new Sounds();
  if (params.get('sound') === '0') sounds.muted = true;
  // Arm mode: the backup demo on a bare forearm (key M, ?mode=arm). Its canvases sit between the picture and the HUD.
  const arm = new ArmMode(stage, hud, scene, view, hands, sounds);

  procedure.on((event) => {
    if (event.type === 'step') {
      if (event.step.id === 'complete') sounds.complete();
      else if (event.step.id !== 'standby') sounds.step();
    }
    if (event.type === 'stitch-start') sounds.stitchStart();
    if (event.type === 'stitch-done') sounds.stitchDone(event.index);
    if (event.type === 'reset') attending.hide();
  });
  const handChip = hud.addChip('Hands');
  const woundChip = hud.addChip('Wound');
  const autoChip = hud.addChip('Autoplay');
  const recording = new StreamRecording(hud.addChip('Rec'), (text, ms) => hud.notice(text, ms), (file) => {
    // The new clip becomes what key 3 plays.
    config.clips = [file, ...config.clips.filter((c) => c !== file)];
  });

  if (params.get('hands') !== '0') void hands.start();

  // ----- The Gemini attending -----
  let appTime = 0;
  const viewCanvas = document.createElement('canvas');
  const brainHost: BrainHost = {
    describeState: () => {
      const step = procedure.step;
      const total = procedure.steps.length - 1;
      const where = procedure.index === 0 ? 'Standing by; the procedure has not started.' : `Step ${procedure.index} of ${total}: ${step.title}.`;
      const sutures = `Sutures placed: ${procedure.stitchesDone} of ${procedure.count}.`;
      return `${where} ${sutures} Wound tracking: ${tracker.pose.locked ? 'locked' : 'searching'}.`;
    },
    stateData: () => ({
      step: procedure.step.id,
      stepNumber: procedure.index,
      stepCount: procedure.steps.length - 1,
      stepTitle: procedure.step.title,
      instruction: procedure.step.line,
      suturesPlaced: procedure.stitchesDone,
      suturesPlanned: procedure.count,
      woundTracked: tracker.pose.locked,
      handOnTarget: scene.aligned,
    }),
    nextStep: () => procedure.next(),
    previousStep: () => procedure.back(),
    repeatStep: () => procedure.replay(),
    goToStep: (id) => {
      if (!procedure.steps.some((s) => s.id === id)) return false;
      procedure.goToId(id as StepId);
      return true;
    },
    highlight: (structure: Structure) => {
      scene.highlight = { structure, until: appTime + 7 };
    },
    captureView: () => {
      if (video.readyState < 2 || !video.videoWidth) return null;
      // What the audience sees: the visible part of the picture with the overlays on it.
      const width = 960;
      const height = Math.round((width * stage.clientHeight) / Math.max(1, stage.clientWidth));
      viewCanvas.width = width;
      viewCanvas.height = height;
      const ctx = viewCanvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#05080c';
      ctx.fillRect(0, 0, width, height);
      const k = width / stage.clientWidth;
      try {
        ctx.drawImage(video, view.toScreenX(0) * k, view.toScreenY(0) * k, view.videoW * view.scale * k, view.videoH * view.scale * k);
        ctx.drawImage(overlayCanvas, 0, 0, width, height);
        return viewCanvas.toDataURL('image/jpeg', 0.72).split(',')[1] || null;
      } catch {
        return null;
      }
    },
  };

  const brainChip = hud.addChip('Gemini off');
  const brain = new AttendingBrain(brainHost, attending, (state, detail) => {
    // The panel is on screen while the session is up, and simply absent when it is not.
    const online = state !== 'off' && state !== 'error' && state !== 'connecting';
    attending.setOnline(online);
    attract.setGemini(online);
    if (state === 'error') {
      brainChip.set('Gemini offline', 'off');
      if (detail) hud.notice(detail, 2600);
    } else if (state === 'off') brainChip.set('Gemini off', 'off');
    else if (state === 'connecting') brainChip.set(brain.offline ? 'Gemini offline' : 'Gemini connecting', brain.offline ? 'off' : 'busy');
    else if (state === 'listening') brainChip.set('Gemini ready', 'ok');
    else if (state === 'hearing') brainChip.set('Gemini listening', 'ok');
    else if (state === 'thinking') brainChip.set('Gemini thinking', 'ok');
    else brainChip.set('Gemini speaking', 'ok');
  });
  if (params.get('voice') === '0') brain.voice = false;
  if (params.get('wake') === '0') brain.wakeEnabled = false;
  if (params.get('talk') === 'open') brain.talkMode = 'open';
  // For recordings and screenshots with no Gemini session: show the panel as it looks when one is up.
  if (params.get('panel') === '1') {
    attending.setOnline(true);
    attract.setGemini(true);
    brainChip.set('Gemini ready', 'ok');
  }
  procedure.on((event) => {
    if (event.type === 'step' || event.type === 'stitch-done' || event.type === 'reset') brain.noteState();
  });
  const toggleBrain = () => {
    if (brain.running) {
      brain.stop();
      attending.hide();
      return;
    }
    void brain.start();
  };
  // At a walk-up table the attending is simply on: connected at launch, microphone gated by the talk button.
  if (config.gemini.configured && params.get('attending') !== '0') void brain.start();

  // ----- What the operator can do, whichever way they do it: keyboard, presenter, phone remote -----
  let lastActivity = performance.now();
  const touch = () => {
    lastActivity = performance.now();
    attract.set(false);
    scene.attract = false;
  };
  // The headset's picture trails real life by a second or more. An operator watching the trainee's hands
  // presses as the needle lands; the screen shows it land later. Placing a suture waits out that lag, so
  // the stitch plays when the audience sees the hand arrive. Step changes are never delayed.
  const waiting = new Set<number>();
  const afterLag = (run: () => void) => {
    const wait = input.current.kind === 'hololens' ? settings.inputDelayMs : 0;
    if (wait <= 0) { run(); return; }
    const timer = window.setTimeout(() => { waiting.delete(timer); run(); }, wait);
    waiting.add(timer);
  };
  const placesSuture = () => procedure.step.id === 'stitch' && procedure.stitchesDone + waiting.size < procedure.count;
  const resetNow = () => {
    // Back to Ready at once: no fades, nothing left on screen from the last group.
    for (const timer of waiting) window.clearTimeout(timer);
    waiting.clear();
    procedure.setAutoplay(false);
    procedure.reset();
    arm.reset();
    brain.silence();
    attending.hide();
    view.release();
    view.snap();
    hud.snap();
    renderer.blackout(appTime + 0.6);
    touch();
  };
  const actions = {
    /** The one button: the next suture if there is one to place, otherwise the next step; after the score, start over. */
    next: () => {
      touch();
      if (arm.active) arm.next();
      else if (procedure.step.id === 'complete') resetNow();
      else if (placesSuture()) afterLag(() => procedure.advance());
      else if (waiting.size === 0) procedure.advance();
    },
    stitch: () => {
      touch();
      if (placesSuture()) afterLag(() => procedure.startStitch());
    },
    back: () => { touch(); if (arm.active) arm.back(); else procedure.back(); },
    reset: resetNow,
    /**
     * Talk button down / up. `held`: a key that only talks while held (Space): the release always ends the
     * question. Returns true when a release ended a press in which nothing was said.
     */
    talk: (down: boolean, held = false): boolean => {
      touch();
      if (down) { brain.talkDown(held ? 500 : 0); return false; }
      return brain.talkUp(held);
    },
  };
  procedure.on(() => { lastActivity = performance.now(); });

  // The phone remote: same actions, from a phone on the same network.
  const remoteChip = hud.addChip('Remote');
  remoteChip.show(false);
  connectRemote(actions, () => ({
    title: procedure.step.title,
    index: procedure.index === 0 ? 'Ready' : `Step ${procedure.index} of ${procedure.steps.length - 1}`,
    sutures: ['plan', 'stitch', 'complete'].includes(procedure.step.id) ? `Sutures ${procedure.stitchesDone}/${procedure.count}` : '',
    attending: brain.state === 'off' ? '' : brain.state === 'error' ? 'Gemini offline'
      : brain.state === 'hearing' ? 'Listening' : brain.state === 'thinking' ? 'Thinking'
      : brain.state === 'answering' ? 'Speaking' : brain.state === 'connecting' ? 'Gemini connecting' : 'Gemini ready',
  }), (count) => {
    remoteChip.show(count > 0);
    remoteChip.set(count === 1 ? 'Remote connected' : `${count} remotes`, 'ok');
  });
  if (config.remote?.enabled) {
    hud.setRemoteInfo(`Phone remote (same Wi-Fi):  ${config.remote.addresses.join('   or   ')}   \u00B7   PIN ${config.remote.pin}`);
  }

  // ----- Input -----
  const input = new InputManager(video, { hololens: config.hololens.configured }, (snapshot) => {
    hud.setInput(snapshot);
    stage.classList.toggle('stage--stale', snapshot.status.state !== 'live');
    scene.input = { live: snapshot.status.state === 'live', label: snapshot.label };
  });

  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'video/*';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file) input.useFile(file);
    picker.value = '';
  });

  let clipPlaying = '';
  const chooseFile = () => {
    // The newest clip in vision/media, unless the operator dropped or picked a file of their own.
    if (config.clips.length > 0 && (clipPlaying !== config.clips[0] || !input.hasFile)) {
      clipPlaying = config.clips[0];
      input.useFile(`/media/${encodeURIComponent(config.clips[0])}`);
    } else if (input.hasFile) input.choose('file');
    // No clip recorded yet: never pop a file dialog over the full-screen demo. (A file dropped on the window
    // still plays.)
    else hud.notice('No recorded clip yet: Shift+C records one from the headset. Key 4 is the simulated arm.', 4500);
  };

  const wanted = params.get('input') as SourceKind | null;
  const clip = params.get('clip');
  if (clip) input.useFile(clip.includes('/') ? clip : `/media/${encodeURIComponent(clip)}`);
  else if (wanted === 'file') chooseFile();
  else if (wanted === 'hololens' || wanted === 'webcam' || wanted === 'sim') input.choose(wanted);
  else input.chooseBest();

  // Drop a recorded clip anywhere on the window to play it.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name))) input.useFile(file);
  });

  // ----- Picking the marker colour from the picture -----
  let picking = false;
  const setPicking = (on: boolean) => {
    picking = on;
    stage.classList.toggle('stage--picking', on);
    if (on) hud.notice('Click the marker line to set its colour  ·  Esc cancels', 12000);
  };
  stage.addEventListener('click', (event) => {
    if (!picking) return;
    const rect = stage.getBoundingClientRect();
    const sample = detector.sample(video, view.toVideoX(event.clientX - rect.left), view.toVideoY(event.clientY - rect.top));
    setPicking(false);
    if (!sample || sample.s < 0.18) {
      hud.notice('That spot has too little colour to track. Press K and click on the marker line itself.');
      return;
    }
    scene.marker = markerFromSample(sample, scene.marker.lengthMm);
    saveMarker(scene.marker);
    tracker.reset();
    hud.notice(`Marker colour set  ·  hue ${scene.marker.hue}°`);
  });

  // ----- Keys: every step of the demo can be driven from the keyboard -----
  const presets = Object.keys(MARKER_PRESETS);
  let preset = 0;
  const storeSettings = () => {
    tracker.flipAlong = settings.flipAlong;
    tracker.flipSide = settings.flipSide;
    saveSettings(settings);
  };

  window.addEventListener('pointerdown', () => sounds.unlock());
  let spaceTimer = 0;
  let spaceTalking = false;
  let lastPointer = performance.now();
  window.addEventListener('pointermove', () => { lastPointer = performance.now(); });
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A key held down must not run through the procedure: only the first press counts.
    if (event.repeat) { event.preventDefault(); return; }
    sounds.unlock();
    touch();
    // Keys that only mean something to the table demo (sutures, autoplay, marker colour, flips, zoom) do nothing in Arm mode.
    if (arm.active && 'sSaAkKjJxXzZ[]tT'.includes(event.key)) { event.preventDefault(); return; }
    switch (event.key) {
      // Space, and a presenter's forward button (PageDown, or the right arrow on some), are the one button:
      // the next suture if there is one to place, otherwise the next step. Shift + right arrow skips ahead.
      // Space is two keys in one: a tap is Next, held it is the talk button. Which one it was is only known
      // a moment later, so talking starts with the last half second the microphone heard.
      case ' ':
        // With no Gemini session there is nothing to talk to: Space is simply Next, at once.
        if (!brain.ready) { actions.next(); break; }
        window.clearTimeout(spaceTimer);
        spaceTalking = false;
        spaceTimer = window.setTimeout(() => {
          spaceTimer = 0;
          spaceTalking = true;
          actions.talk(true, true);
        }, 320);
        break;
      case 'PageDown': actions.next(); break;
      case 'ArrowRight': if (event.shiftKey) procedure.next(); else actions.next(); break;
      case 'ArrowLeft': case 'PageUp': actions.back(); break;
      case 's': case 'S': actions.stitch(); break;
      // The lag of the headset's picture: Y shows a running clock to measure it (point the headset at this
      // screen and compare the clock with its own image), - and = set it.
      case 'y': case 'Y':
        if (event.shiftKey) { void latencySweep(); break; }
        syncClock.classList.toggle('sync-clock--on');
        if (syncClock.classList.contains('sync-clock--on')) probe.start();
        else if (!sweeping) { probe.stop(); sweepText = ''; }
        break;
      case 'q': case 'Q': {
        const next = QUALITIES[(QUALITIES.indexOf(input.quality) + 1) % QUALITIES.length];
        input.setQuality(next);
        probe.reset();
        hud.notice(`Headset stream: live_${next}${input.current.kind === 'hololens' ? ' (reconnecting)' : ' (used for input 1)'}`, 2200);
        break;
      }
      case '-': case '_': case '=': case '+': {
        const step = event.key === '-' || event.key === '_' ? -100 : 100;
        settings.inputDelayMs = clamp(settings.inputDelayMs + step, 0, 5000);
        storeSettings();
        hud.notice(`Suture trigger delay: ${(settings.inputDelayMs / 1000).toFixed(1)} s (HoloLens input only)`, 2000);
        break;
      }
      case 'r': case 'R': actions.reset(); break;
      // Talk to the attending: hold G (or tap it and speak). A presenter's "blank screen" button sends B or
      // a full stop, so those do the same. Shift + G turns the attending off and on.
      case 'g': case 'b': case '.': actions.talk(true); break;
      case 'G': case 'B': if (event.key === 'G' && event.shiftKey) toggleBrain(); else actions.talk(true); break;
      case 'a': case 'A': procedure.setAutoplay(!procedure.autoplay); break;
      case 'h': case 'H':
        scene.hidden = !scene.hidden;
        hud.setHidden(scene.hidden);
        break;
      case 'n': case 'N': sounds.muted = !sounds.muted; hud.notice(`Sound ${sounds.muted ? 'off' : 'on'}`, 1500); break;
      case 'v': case 'V': brain.voice = !brain.voice; hud.notice(`Attending voice ${brain.voice ? 'on' : 'off'}`, 1500); break;
      case 'l': case 'L': hud.notice(brain.sendView() ? 'Picture sent to the attending' : 'The attending is not connected', 1500); break;
      case '1': input.choose('hololens'); break;
      case '2': input.choose('webcam'); break;
      case '3': chooseFile(); break;
      case '4': input.choose('sim'); break;
      case 'c': case 'C': void recording.toggle(event.shiftKey ? 60 : 0); break;
      case 'k': case 'K': setPicking(!picking); break;
      case 'm': case 'M': {
        if (!event.shiftKey) {
          // Arm mode on or off. Either way the screen starts clean.
          resetNow();
          arm.toggle();
          hud.notice(arm.active ? 'Arm mode: show a forearm' : 'Table mode', 1800);
          break;
        }
        preset = (preset + 1) % presets.length;
        scene.marker = { ...MARKER_PRESETS[presets[preset]], lengthMm: scene.marker.lengthMm };
        saveMarker(scene.marker);
        tracker.reset();
        hud.notice(`Marker colour: ${presets[preset]}`);
        break;
      }
      case 'j': case 'J':
        settings.inkOnly = !settings.inkOnly;
        detector.rejectGlow = settings.inkOnly;
        storeSettings();
        tracker.reset();
        hud.notice(settings.inkOnly ? 'Tracking marker ink only (holograms ignored)' : 'Tracking glowing lines too (for a hologram wound)', 3000);
        break;
      case 'x': case 'X': settings.flipAlong = !settings.flipAlong; storeSettings(); break;
      case 'z': case 'Z': settings.flipSide = !settings.flipSide; storeSettings(); break;
      case '[': settings.acrossScale = clamp(settings.acrossScale - 0.05, 0.4, 1.3); storeSettings(); hud.notice(`Across the arm: ${Math.round(settings.acrossScale * 100)}%`, 1500); break;
      case ']': settings.acrossScale = clamp(settings.acrossScale + 0.05, 0.4, 1.3); storeSettings(); hud.notice(`Across the arm: ${Math.round(settings.acrossScale * 100)}%`, 1500); break;
      case 't': case 'T': settings.autoZoom = !settings.autoZoom; storeSettings(); hud.notice(`Zoom to the wound: ${settings.autoZoom ? 'on' : 'off'}`, 1500); break;
      case 'f': case 'F':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
        break;
      case 'o': case 'O':
        view.fit = view.fit === 'cover' ? 'contain' : 'cover';
        stage.classList.toggle('stage--contain', view.fit === 'contain');
        break;
      case 'd': case 'D': scene.debug = !scene.debug; break;
      case '?': case '/': hud.toggleHelp(); break;
      case 'Escape': hud.toggleHelp(false); setPicking(false); break;
      default: return;
    }
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === 'g' || event.key === 'G' || event.key === 'b' || event.key === 'B' || event.key === '.') actions.talk(false);
    if (event.key === ' ') {
      if (spaceTimer) {
        window.clearTimeout(spaceTimer);
        spaceTimer = 0;
        actions.next();
      } else if (spaceTalking) {
        spaceTalking = false;
        // A slow press with nothing said was meant as Next.
        if (actions.talk(false, true)) actions.next();
      }
    }
  });

  if (params.get('mode') === 'arm') arm.setActive(true);
  const startStep = params.get('step') as StepId | null;
  if (startStep && !arm.active) procedure.goToId(startStep);
  if (params.get('autoplay') === '1') procedure.setAutoplay(true);

  // ----- Tracking: once per video frame -----
  let lastAnalysis = 0;
  const analyze = (now: number) => {
    const dt = lastAnalysis ? Math.min(0.25, (now - lastAnalysis) / 1000) : 1 / 30;
    lastAnalysis = now;
    // Hands first: Arm mode anchors the forearm to the wrist they find in this same frame.
    hands.detect(video, now);
    if (arm.active) arm.analyze(video, now);
    else tracker.update(detector.analyze(video, scene.marker, tracker.hint), scene.marker, dt);
  };
  // ----- Latency: the probe's measurement, the player's numbers, and a sweep over the stream presets -----
  let videoFrames = 0;
  let lastResultAt = 0;
  let sweeping = false;
  let sweepText = '';
  const stream = () => input.streamStats;
  const describeLag = (): string => {
    const est = probe.estimate;
    const st = stream();
    const measured = est ? `Measured ${(est.delayMs / 1000).toFixed(2)} s glass to glass (match ${est.confidence.toFixed(2)})` : 'Measuring: keep the flashing square in the headset\u2019s view';
    const player = st ? `live_${st.quality} \u00B7 ${st.mode} \u00B7 buffer ${(st.floor * 1000).toFixed(0)}\u2013${(st.lag * 1000).toFixed(0)} ms \u00B7 speed ${st.rate.toFixed(2)} \u00B7 fragments ${st.fragmentMs.toFixed(0)} ms \u00B7 stalls ${st.stalls}` : `Input: ${input.current.label}`;
    return `${measured}\n${player}`;
  };
  const waitFor = (test: () => boolean, ms: number) => new Promise<boolean>((resolve) => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      if (test()) { window.clearInterval(timer); resolve(true); }
      else if (performance.now() - started > ms) { window.clearInterval(timer); resolve(false); }
    }, 100);
  });
  /**
   * Shift+Y: for each stream preset, reconnect, let the player settle, and measure the glass-to-glass delay
   * with the probe (the headset must be looking at this screen). Keeps the fastest preset that played cleanly.
   */
  const latencySweep = async () => {
    if (sweeping) return;
    // Settings may have been added since the page loaded: ask the server again before refusing.
    if (!config.hololens.configured) config.hololens = (await loadConfig()).hololens;
    if (!config.hololens.configured) { hud.notice('The latency sweep needs the headset: add its settings to vision/.env.local', 5000); return; }
    sweeping = true;
    syncClock.classList.add('sync-clock--on');
    probe.start();
    const results: Array<{ quality: HoloLensQuality; delayMs: number | null; confidence: number; size: string; fps: number; stalls: number; bufferMs: number }> = [];
    const before = input.quality;
    if (input.current.kind !== 'hololens') input.choose('hololens');
    for (const quality of QUALITIES) {
      sweepText = `Latency sweep: live_${quality} (${results.length + 1} of ${QUALITIES.length}). Keep looking at this screen.`;
      input.setQuality(quality);
      const live = await waitFor(() => input.current.status.state === 'live' && video.readyState >= 2, 12000);
      if (!live) { results.push({ quality, delayMs: null, confidence: 0, size: 'no picture', fps: 0, stalls: 0, bufferMs: 0 }); continue; }
      await new Promise((r) => window.setTimeout(r, 2500));
      probe.reset();
      const framesAt = videoFrames;
      const startedAt = performance.now();
      const stallsAt = stream()?.stalls ?? 0;
      let good = 0;
      await waitFor(() => {
        if (probe.estimate && probe.estimate.confidence >= 0.6) good++;
        return good >= 8;
      }, 11000);
      const seconds = (performance.now() - startedAt) / 1000;
      const st = stream();
      results.push({
        quality,
        delayMs: probe.estimate ? probe.estimate.delayMs : null,
        confidence: probe.estimate ? probe.estimate.confidence : 0,
        size: `${video.videoWidth}x${video.videoHeight}`,
        fps: Math.round((videoFrames - framesAt) / Math.max(0.1, seconds)),
        stalls: (st?.stalls ?? 0) - stallsAt,
        bufferMs: Math.round((st?.floor ?? 0) * 1000),
      });
    }
    // Fastest that played cleanly; low only if it is clearly faster than med (it is the softest picture).
    const clean = results.filter((r) => r.delayMs !== null && r.stalls <= 1 && r.fps >= 20).sort((a, b) => (a.delayMs ?? 0) - (b.delayMs ?? 0));
    let pick: HoloLensQuality = before;
    if (clean.length) {
      pick = clean[0].quality;
      const med = clean.find((r) => r.quality === 'med');
      if (pick === 'low' && med && (med.delayMs ?? 0) - (clean[0].delayMs ?? 0) < 80) pick = 'med';
    }
    input.setQuality(pick);
    const table = results.map((r) => `live_${r.quality}: ${r.delayMs === null ? 'not measured' : `${(r.delayMs / 1000).toFixed(2)} s`}  ${r.size} ${r.fps} fps  stalls ${r.stalls}  buffer ${r.bufferMs} ms`).join('\n');
    sweepText = `${clean.length ? `Kept live_${pick}.` : 'The headset never saw the flashing square: nothing measured, preset unchanged.'}\n${table}`;
    console.table(results);
    (window as unknown as { __latency: unknown }).__latency = { results, pick };
    hud.notice(clean.length ? `Latency sweep: kept live_${pick} (${((clean.find((r) => r.quality === pick)?.delayMs ?? 0) / 1000).toFixed(2)} s)` : 'Latency sweep: nothing measured', 6000);
    sweeping = false;
    // The results stay on the clock until it is closed with Y.
  };

  const frameCallbacks = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  if (frameCallbacks) {
    const onVideoFrame = (now: number, frame: VideoFrameCallbackMetadata) => {
      analyze(now);
      videoFrames++;
      if (probe.active) probe.sample(video, frame.expectedDisplayTime || now);
      video.requestVideoFrameCallback(onVideoFrame);
    };
    video.requestVideoFrameCallback(onVideoFrame);
  }
  let lastVideoTime = -1;

  // For checks from the console and from dev/shot.mjs. Not used by the app itself.
  const debug: Record<string, () => unknown> = {
    input: () => input.current,
    video: () => {
      const b = video.buffered;
      const end = b.length ? b.end(b.length - 1) : 0;
      return {
        width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, paused: video.paused,
        time: +video.currentTime.toFixed(2), lag: b.length ? +(end - video.currentTime).toFixed(2) : null, rate: video.playbackRate,
      };
    },
    wound: () => {
      const p = tracker.pose;
      return {
        locked: p.locked, confidence: +p.confidence.toFixed(2), cx: Math.round(p.cx), cy: Math.round(p.cy),
        angleDeg: +((Math.atan2(p.dy, p.dx) * 180) / Math.PI).toFixed(1), lengthPx: +p.length.toFixed(1),
        pxPerMm: +p.pxPerMm.toFixed(2), analysisMs: +detector.lastMs.toFixed(1), maskPx: detector.lastMaskCount,
      };
    },
    hands: () => ({ state: hands.state, detail: hands.detail, seen: hands.hands.length, ms: +hands.lastMs.toFixed(1), aligned: scene.aligned }),
    procedure: () => ({ step: procedure.step.id, stitchesDone: procedure.stitchesDone, stitching: procedure.stitch?.index ?? null, autoplay: procedure.autoplay }),
    attending: () => ({ state: brain.state, detail: brain.detail, voice: brain.voice, highlight: scene.highlight.structure }),
    view: () => ({ zoom: +view.zoom.toFixed(2), fit: view.fit }),
    marker: () => scene.marker,
    arm: () => arm.debugInfo(),
    stream: () => ({ quality: input.quality, player: input.streamStats, probe: probe.estimate, probing: probe.active }),
    fps: () => ({ fps: +fps.toFixed(1), worstFrameMs: +worstFrame.toFixed(1) }),
  };
  (window as unknown as { __viper: unknown }).__viper = {
    parts: debug,
    debug: () => Object.fromEntries(Object.entries(debug).map(([name, read]) => [name, read()])),
    scene,
    brain,
    /** The Gemini panel, for checks with made-up answers (dev/shot.mjs; no key needed). */
    panel: attending,
    arm,
    /** Ask the attending a typed question (needs the Gemini session to be on: press G first). */
    ask: (text: string) => brain.ask(text),
    captureView: () => brainHost.captureView(),
    /** The lag probe's maths with a made-up delay (no headset needed): __viper.latencySelfTest(850). */
    latencySelfTest: (delayMs: number) => probe.selfTest(delayMs),
  };

  // ----- The frame loop -----
  const holdCtx = hold.getContext('2d', { alpha: false })!;
  let lastHold = 0;
  let lastKeepOut = 0;
  let last = performance.now();
  const started = last;
  // Seconds of quiet before the idle screen, before a finished run resets, and before an abandoned one does.
  const seconds = (name: string, fallback: number) => {
    const value = Number(params.get(name));
    return params.get(name) !== null && Number.isFinite(value) ? value : fallback;
  };
  const attractAfter = seconds('attract', 8);
  const resetAfterDone = seconds('done', 45);
  const resetAfterIdle = seconds('idle', 180);
  let zoomTarget = 1;
  let wasLocked = false;
  let fps = 60;
  let worstFrame = 0;
  let worstResetAt = 0;

  /** Where the procedure is, in one line, for the Gemini panel. */
  const contextLine = (): string => {
    const total = procedure.steps.length - 1;
    const id = procedure.step.id;
    if (arm.active) return 'Arm mode';
    if (id === 'standby') return `${total} steps \u00B7 ${procedure.count} sutures`;
    const where = `Step ${procedure.index} of ${total}`;
    if (id === 'stitch') return `${where} \u00B7 Suture ${Math.min(procedure.count, procedure.stitchesDone + 1)} of ${procedure.count}`;
    if (id === 'complete') return `${where} \u00B7 ${procedure.step.label}`;
    if (id === 'plan') return `${where} \u00B7 ${procedure.count} sutures planned`;
    return `${where} \u00B7 ${procedure.step.label}`;
  };

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - started) / 1000;
    appTime = t;
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (now - worstResetAt > 3000) { worstResetAt = now; worstFrame = 0; }
    worstFrame = Math.max(worstFrame, dt * 1000);

    if (!frameCallbacks && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      analyze(now);
    }

    procedure.tick(t);

    // The table looks after itself between groups: the idle screen after a few quiet seconds in Ready, and
    // back to Ready by itself when a finished (or abandoned) run has been left alone.
    const quiet = (now - lastActivity) / 1000;
    const busyTalking = brain.state === 'hearing' || brain.state === 'thinking' || brain.state === 'answering' || brain.speaking;
    if (busyTalking) lastActivity = now;
    const showAttract = attractAfter > 0 && !scene.hidden && !procedure.autoplay && !busyTalking && !arm.active
      && !syncClock.classList.contains('sync-clock--on') && procedure.step.id === 'standby' && quiet > attractAfter;
    attract.set(showAttract);
    scene.attract = showAttract;
    const resetAfter = procedure.step.id === 'complete' ? resetAfterDone : resetAfterIdle;
    if (!procedure.autoplay && procedure.step.id !== 'standby' && resetAfter > 0 && quiet > resetAfter) {
      resetNow();
    }
    attending.setLevel(brain.mic.level);
    attending.setVoiceLevel(brain.voiceLevel);
    attending.setSpeaking(brain.speaking);
    attending.setContext(contextLine());
    attending.update(t, dt);

    // Zoom toward the wound while planning and stitching, so the fine work fills the screen.
    const pose = tracker.pose;
    const step = procedure.step.id;
    view.setSize(stage.clientWidth, stage.clientHeight, video.videoWidth, video.videoHeight);
    // How much of the screen's width the wound should fill in each step, and the most to zoom for it.
    const framing: Partial<Record<StepId, [number, number]>> = { assess: [0.15, 1.6], anatomy: [0.2, 2], plan: [0.24, 2.2], stitch: [0.24, 2.2], complete: [0.2, 2] };
    const frameFor = framing[step];
    if (settings.autoZoom && !scene.hidden && pose.locked && frameFor) {
      const desired = clamp((stage.clientWidth * frameFor[0]) / Math.max(1, pose.length * view.baseScale), 1, frameFor[1]);
      if (Math.abs(desired - zoomTarget) > 0.12 || zoomTarget === 1) zoomTarget = desired;
      view.focusOn(zoomTarget, pose.cx, pose.cy);
    } else {
      zoomTarget = 1;
      view.release();
    }
    view.step(dt);
    const transform = view.cssTransform();
    video.style.transform = transform;
    hold.style.transform = transform;

    // Keep a copy of the last good frame underneath the video, so a reconnect or an input switch never
    // flashes black: the picture simply holds until new frames arrive.
    if (now - lastHold > 180 && input.current.status.state === 'live' && video.readyState >= 2 && video.videoWidth > 0) {
      lastHold = now;
      if (hold.width !== video.videoWidth || hold.height !== video.videoHeight) {
        hold.width = video.videoWidth;
        hold.height = video.videoHeight;
      }
      try { holdCtx.drawImage(video, 0, 0, hold.width, hold.height); } catch { /* frame not ready */ }
    }

    // Where the HUD panels are, so labels on the picture can keep clear of them.
    if (now - lastKeepOut > 200) {
      lastKeepOut = now;
      const origin = stage.getBoundingClientRect();
      scene.keepOut = [];
      for (const panel of hud.root.querySelectorAll<HTMLElement>('.rail__item[data-state="now"] .keep, .rail__ready--on .keep, .debrief--on, .gem')) {
        if (scene.attract || Number(getComputedStyle(panel).opacity) < 0.5) continue;
        const box = panel.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) continue;
        scene.keepOut.push({ x0: box.left - origin.left, y0: box.top - origin.top, x1: box.right - origin.left, y1: box.bottom - origin.top });
      }
    }

    probe.tick(now);
    if (syncClock.classList.contains('sync-clock--on')) {
      syncDigits.textContent = ((now / 1000) % 100).toFixed(1).padStart(4, '0');
      if (now - lastResultAt > 250) {
        lastResultAt = now;
        syncResult.textContent = sweepText || describeLag();
      }
    }

    renderer.resize(stage.clientWidth, stage.clientHeight);
    if (arm.active) arm.draw(t, dt);
    else renderer.draw(t, dt, view);
    stage.classList.toggle('stage--idle', now - lastPointer > 2500 && !picking);

    if (pose.locked && !wasLocked && step === 'standby') sounds.lock();
    wasLocked = pose.locked;
    rail.setLocked(pose.locked);

    // Status chips.
    woundChip.show(!arm.active);
    if (!scene.input.live) woundChip.set('Wound', 'off'); // no picture yet: nothing to search
    else if (pose.locked) woundChip.set('Wound locked', 'ok');
    else if (tracker.hasEverLocked && pose.confidence > 0.05) woundChip.set('Wound held', 'busy');
    else woundChip.set('Searching for wound', 'busy');

    if (hands.state === 'ready') {
      if (scene.aligned) handChip.set('Hand aligned', 'ok');
      else if (hands.hands.length > 0) handChip.set('Hand tracked', 'ok');
      else handChip.set('Hands', 'off');
    } else if (hands.state === 'loading') handChip.set('Hands loading', 'busy');
    else handChip.set('Hands off', 'off');

    autoChip.set('Autoplay', procedure.autoplay ? 'busy' : 'off');
    autoChip.show(procedure.autoplay);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot();
