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
import { AttendingBrain } from './brain/live';
import type { BrainHost, Structure } from './brain/tools';
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
import { FeedbackToast } from './ui/feedback';
import { Hud } from './ui/hud';
import { ScoreCard } from './ui/score';
import { StepPanel } from './ui/steps';

interface ServerConfig {
  hololens: { configured: boolean; target: string };
  gemini: { configured: boolean; model: string };
  clips: string[];
}

async function loadConfig(): Promise<ServerConfig> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) return (await res.json()) as ServerConfig;
  } catch { /* the page still works on webcam, file and the simulated arm */ }
  return { hololens: { configured: false, target: '' }, gemini: { configured: false, model: '' }, clips: [] };
}

const KEYS: Array<[string, string]> = [
  ['Space', 'Place the next suture, or go to the next step (same as a clicker)'],
  ['← →', 'Previous / next step'],
  ['S', 'Place the next suture'],
  ['R', 'Reset the procedure'],
  ['A', 'Autoplay (for recording)'],
  ['H', 'Hide every overlay (clean picture)'],
  ['N', 'Sound on / off'],
  ['G', 'Gemini attending: microphone on / off'],
  ['V', 'Attending speaks its answers aloud: on / off'],
  ['L', 'Send the attending the current picture'],
  ['1 2 3 4', 'Input: HoloLens / webcam / video file / simulated arm'],
  ['K', 'Pick the marker colour: press K, then click the marker line'],
  ['M', 'Next marker colour preset (green, magenta, blue, orange)'],
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

  const scene: Scene = {
    procedure, detector, tracker, hands,
    marker: loadMarker(),
    settings,
    hidden: false,
    debug: params.get('debug') === '1',
    aligned: false,
    toolDistanceMm: -1,
    relockAt: -1e9,
    highlight: { structure: '', until: 0 },
  };

  renderer.add(new ScanLayer(scene));
  renderer.add(new WoundLockLayer(scene));
  renderer.add(new MeasureLayer(scene));
  renderer.add(new PlanLayer(scene));
  renderer.add(new StitchLayer(scene));
  renderer.add(new HandLayer(scene));
  renderer.add(new DebugLayer(scene));

  new StepPanel(hud.root, procedure);
  new FeedbackToast(hud.root, procedure);
  new ScoreCard(hud.root, procedure);
  const attending = new AttendingCard(hud.root);
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
  brain.voice = params.get('voice') === '1';
  procedure.on((event) => {
    if (event.type === 'step' || event.type === 'stitch-done' || event.type === 'reset') brain.noteState();
  });
  const toggleBrain = () => {
    if (brain.running) {
      brain.stop();
      attending.hide();
      return;
    }
    if (!config.gemini.configured) {
      hud.notice('Gemini is not set up: add GEMINI_API_KEY to vision/.env.local and restart the server', 6000);
      return;
    }
    void brain.start();
  };
  if (params.get('attending') === '1' && config.gemini.configured) void brain.start();

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

  const chooseFile = () => {
    if (input.hasFile) input.choose('file');
    else if (config.clips.length > 0) input.useFile(`/media/${encodeURIComponent(config.clips[0])}`);
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
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    sounds.unlock();
    switch (event.key) {
      case ' ': case 'PageDown': procedure.advance(); break;
      case 'ArrowRight': procedure.next(); break;
      case 'ArrowLeft': case 'PageUp': procedure.back(); break;
      case 's': case 'S': procedure.startStitch(); break;
      case 'r': case 'R': procedure.setAutoplay(false); procedure.reset(); break;
      case 'a': case 'A': procedure.setAutoplay(!procedure.autoplay); break;
      case 'h': case 'H':
        scene.hidden = !scene.hidden;
        hud.setHidden(scene.hidden);
        break;
      case 'n': case 'N': sounds.muted = !sounds.muted; hud.notice(`Sound ${sounds.muted ? 'off' : 'on'}`, 1500); break;
      case 'g': case 'G': toggleBrain(); break;
      case 'v': case 'V': brain.voice = !brain.voice; hud.notice(`Attending voice ${brain.voice ? 'on' : 'off'}`, 1500); break;
      case 'l': case 'L': hud.notice(brain.sendView() ? 'Picture sent to the attending' : 'The attending is not connected', 1500); break;
      case '1': input.choose('hololens'); break;
      case '2': input.choose('webcam'); break;
      case '3': chooseFile(); break;
      case '4': input.choose('sim'); break;
      case 'k': case 'K': setPicking(!picking); break;
      case 'm': case 'M': {
        preset = (preset + 1) % presets.length;
        scene.marker = { ...MARKER_PRESETS[presets[preset]], lengthMm: scene.marker.lengthMm };
        saveMarker(scene.marker);
        tracker.reset();
        hud.notice(`Marker colour: ${presets[preset]}`);
        break;
      }
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
  let last = performance.now();
  const started = last;
  let zoomTarget = 1;
  let wasLocked = false;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - started) / 1000;
    appTime = t;

    if (!frameCallbacks && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      analyze(now);
    }

    procedure.tick(t);

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

    renderer.resize(stage.clientWidth, stage.clientHeight);
    renderer.draw(t, dt, view);

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
