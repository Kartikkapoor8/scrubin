import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles.css';

import { add, el } from './core/dom';
import { Viewport } from './core/viewport';
import { InputManager } from './input/manager';
import type { SourceKind } from './input/types';
import { OverlayRenderer } from './overlay/renderer';
import { Hud } from './ui/hud';

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

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const config = await loadConfig();

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

  const view = new Viewport();
  if (params.get('fit') === 'contain') view.fit = 'contain';
  stage.classList.toggle('stage--contain', view.fit === 'contain');
  const renderer = new OverlayRenderer(overlayCanvas);

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

  // ----- Keys -----
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case '1': input.choose('hololens'); break;
      case '2': input.choose('webcam'); break;
      case '3': chooseFile(); break;
      case '4': input.choose('sim'); break;
      case 'f': case 'F':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
        break;
      case 'o': case 'O':
        view.fit = view.fit === 'cover' ? 'contain' : 'cover';
        stage.classList.toggle('stage--contain', view.fit === 'contain');
        break;
      case '?': case '/': hud.toggleHelp(); break;
      case 'Escape': hud.toggleHelp(false); break;
      default: return;
    }
    event.preventDefault();
  });

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
  };
  (window as unknown as { __viper: unknown }).__viper = {
    parts: debug,
    debug: () => Object.fromEntries(Object.entries(debug).map(([name, read]) => [name, read()])),
  };

  // ----- The frame loop -----
  const holdCtx = hold.getContext('2d', { alpha: false })!;
  let lastHold = 0;
  let last = performance.now();
  const started = last;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    view.setSize(stage.clientWidth, stage.clientHeight, video.videoWidth, video.videoHeight);
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
    renderer.draw((now - started) / 1000, dt, view);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot();
