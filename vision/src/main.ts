import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles.css';

import { loadSettings, saveSettings, type Scene } from './app/scene';
import { add, clamp, el } from './core/dom';
import { Viewport } from './core/viewport';
import { InputManager } from './input/manager';
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
import { PROCEDURE, type StepId } from './procedure/data';
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
import { VitalsPanel } from './ui/vitals';

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
  ['←', 'Previous step'],
  ['Shift →', 'Next step, skipping any sutures not yet placed'],
  ['Presenter', 'Forward = Next, back = previous step, blank-screen button (B or .) = talk'],
  ['S', 'Place the next suture'],
  ['R', 'Reset to Ready, instantly'],
  ['A', 'Autoplay (for recording)'],
  ['H', 'Hide every overlay (clean picture)'],
  ['N', 'Sound on / off'],
  ['G', 'Talk to the attending: hold and speak, or tap and speak (Shift+G turns it off / on)'],
  ['V', 'Attending speaks its answers aloud: on / off'],
  ['L', 'Send the attending the current picture'],
  ['1 2 3 4', 'Input: HoloLens / webcam / video file / simulated arm'],
  ['C', 'Record the raw HoloLens stream to vision/media (C again stops; Shift+C records 60 s)'],
  ['K', 'Pick the marker colour: press K, then click the marker line'],
  ['M', 'Next marker colour preset (green, magenta, blue, orange)'],
  ['J', 'Ink only (default) / also track a glowing hologram line as the wound'],
  ['X  Z', 'Flip which end is suture 1 / which side is the far side'],
  ['[  ]', 'Squash or stretch overlays across the arm (camera angle)'],
  ['T', 'Zoom toward the wound while planning and stitching: on / off'],
  ['F', 'Full screen'],
  ['O', 'Fill the screen / show the whole picture'],
  ['D', 'Tracking debug view'],
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

  new StepPanel(hud.root, procedure);
  // Table mode: lines and lettering on the picture are drawn larger, to carry to someone two metres away.
  if (params.get('big') !== '0') setReadability(1.45, 1.7);

  new TitleCard(hud.root, procedure);
  // Suture feedback and the captions share the bottom of the screen, stacked.
  const bottom = add(hud.root, el('div', 'bottom-stack'));
  new FeedbackToast(bottom, procedure);
  new ScoreCard(hud.root, procedure);
  const vitals = new VitalsPanel(hud.root, procedure);
  const attending = new AttendingCard(bottom);
  const attract = new AttractScreen(hud.root);
  const sounds = new Sounds();
  if (params.get('sound') === '0') sounds.muted = true;

  procedure.on((event) => {
    if (event.type === 'step') {
      if (event.step.id === 'complete') sounds.complete();
      else if (event.step.id !== 'standby') sounds.step();
      if (event.step.id !== 'stitch') attending.hide();
    }
    if (event.type === 'stitch-start') sounds.stitchStart();
    if (event.type === 'stitch-done') {
      sounds.stitchDone(event.index);
      const line = PROCEDURE.sutures.lines[event.index];
      if (line) attending.say(line, { hold: 5 });
    }
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

  const brainChip = hud.addChip('Attending off');
  const brain = new AttendingBrain(brainHost, attending, (state, detail) => {
    if (state === 'error') {
      brainChip.set('Attending offline', 'bad');
      if (detail) hud.notice(detail, 6000);
    } else if (state === 'off') brainChip.set('Attending off', 'off');
    else if (state === 'connecting') brainChip.set('Attending connecting', 'busy');
    else if (state === 'listening') brainChip.set('Attending listening', 'ok');
    else if (state === 'hearing') brainChip.set('Attending hears you', 'ok');
    else if (state === 'thinking') brainChip.set('Attending thinking', 'ok');
    else brainChip.set('Attending answering', 'ok');
  });
  if (params.get('voice') === '0') brain.voice = false;
  if (params.get('talk') === 'open') brain.talkMode = 'open';
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
  const resetNow = () => {
    // Back to Ready at once: no fades, nothing left on screen from the last group.
    procedure.setAutoplay(false);
    procedure.reset();
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
      if (procedure.step.id === 'complete') resetNow();
      else procedure.advance();
    },
    back: () => { touch(); procedure.back(); },
    reset: resetNow,
    /** Talk button down / up. */
    talk: (down: boolean) => {
      touch();
      if (down) brain.talkDown();
      else brain.talkUp();
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
    attending: brain.state === 'off' ? '' : brain.state === 'error' ? 'Attending offline'
      : brain.state === 'hearing' ? 'Listening' : brain.state === 'thinking' ? 'Thinking'
      : brain.state === 'answering' ? 'Answering' : brain.state === 'connecting' ? 'Attending connecting' : 'Attending ready',
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
    else picker.click();
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
  let lastPointer = performance.now();
  window.addEventListener('pointermove', () => { lastPointer = performance.now(); });
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A key held down must not run through the procedure: only the first press counts.
    if (event.repeat) { event.preventDefault(); return; }
    sounds.unlock();
    touch();
    switch (event.key) {
      // Space, and a presenter's forward button (PageDown, or the right arrow on some), are the one button:
      // the next suture if there is one to place, otherwise the next step. Shift + right arrow skips ahead.
      case ' ': case 'PageDown': actions.next(); break;
      case 'ArrowRight': if (event.shiftKey) procedure.next(); else actions.next(); break;
      case 'ArrowLeft': case 'PageUp': actions.back(); break;
      case 's': case 'S': procedure.startStitch(); break;
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
  });

  const startStep = params.get('step') as StepId | null;
  if (startStep) procedure.goToId(startStep);
  if (params.get('autoplay') === '1') procedure.setAutoplay(true);

  // ----- Tracking: once per video frame -----
  let lastAnalysis = 0;
  const analyze = (now: number) => {
    const dt = lastAnalysis ? Math.min(0.25, (now - lastAnalysis) / 1000) : 1 / 30;
    lastAnalysis = now;
    tracker.update(detector.analyze(video, scene.marker, tracker.hint), scene.marker, dt);
    hands.detect(video, now);
  };
  const frameCallbacks = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  if (frameCallbacks) {
    const onVideoFrame = (now: number) => {
      analyze(now);
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
    fps: () => ({ fps: +fps.toFixed(1), worstFrameMs: +worstFrame.toFixed(1) }),
  };
  (window as unknown as { __viper: unknown }).__viper = {
    parts: debug,
    debug: () => Object.fromEntries(Object.entries(debug).map(([name, read]) => [name, read()])),
    scene,
    brain,
    /** Ask the attending a typed question (needs the Gemini session to be on: press G first). */
    ask: (text: string) => brain.ask(text),
    captureView: () => brainHost.captureView(),
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
    const busyTalking = brain.state === 'hearing' || brain.state === 'thinking' || brain.state === 'answering';
    if (busyTalking) lastActivity = now;
    const showAttract = attractAfter > 0 && !scene.hidden && !procedure.autoplay && !busyTalking
      && procedure.step.id === 'standby' && quiet > attractAfter;
    attract.set(showAttract);
    scene.attract = showAttract;
    if (!procedure.autoplay && procedure.step.id !== 'standby'
      && quiet > (procedure.step.id === 'complete' ? resetAfterDone : resetAfterIdle)) {
      resetNow();
    }
    attending.setLevel(brain.talking ? brain.mic.level : 0);

    // Zoom toward the wound while planning and stitching, so the fine work fills the screen.
    const pose = tracker.pose;
    const step = procedure.step.id;
    view.setSize(stage.clientWidth, stage.clientHeight, video.videoWidth, video.videoHeight);
    // How much of the screen's width the wound should fill in each step, and the most to zoom for it.
    const framing: Partial<Record<StepId, [number, number]>> = { assess: [0.15, 1.6], plan: [0.24, 2.2], stitch: [0.24, 2.2] };
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
      for (const panel of hud.root.querySelectorAll<HTMLElement>('.steps, .vitals, .score.panel--on')) {
        if (scene.attract || Number(getComputedStyle(panel).opacity) < 0.5) continue;
        const box = panel.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) continue;
        scene.keepOut.push({ x0: box.left - origin.left, y0: box.top - origin.top, x1: box.right - origin.left, y1: box.bottom - origin.top });
      }
    }

    renderer.resize(stage.clientWidth, stage.clientHeight);
    renderer.draw(t, dt, view);
    vitals.update(t, dt);
    stage.classList.toggle('stage--idle', now - lastPointer > 2500 && !picking);

    if (pose.locked && !wasLocked && step === 'standby') sounds.lock();
    wasLocked = pose.locked;

    // Status chips.
    if (pose.locked) woundChip.set('Wound locked', 'ok');
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
