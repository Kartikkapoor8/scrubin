// One-time setup, run automatically after `npm install` (and by hand with `npm run setup`).
// Copies MediaPipe's WebAssembly runtime out of node_modules and downloads the hand-tracking model, so the app
// needs no internet on stage. Both land in public/ and are gitignored. Never fails the install: if the model
// cannot be downloaded, hand tracking is simply unavailable until `npm run setup` succeeds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmFrom = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmTo = path.join(root, 'public', 'mediapipe', 'wasm');
const modelTo = path.join(root, 'public', 'models', 'hand_landmarker.task');
// Google's published model for MediaPipe Hand Landmarker (Apache 2.0).
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

try {
  if (fs.existsSync(wasmFrom)) {
    fs.mkdirSync(wasmTo, { recursive: true });
    for (const file of fs.readdirSync(wasmFrom)) fs.copyFileSync(path.join(wasmFrom, file), path.join(wasmTo, file));
    console.log('[setup] MediaPipe runtime copied to public/mediapipe/wasm');
  } else {
    console.warn('[setup] @mediapipe/tasks-vision is not installed yet; run `npm install` first.');
  }
} catch (err) {
  console.warn('[setup] could not copy the MediaPipe runtime:', err.message);
}

try {
  if (fs.existsSync(modelTo) && fs.statSync(modelTo).size > 1_000_000) {
    console.log('[setup] hand model already present');
  } else {
    fs.mkdirSync(path.dirname(modelTo), { recursive: true });
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1_000_000) throw new Error('download looks truncated');
    fs.writeFileSync(modelTo, bytes);
    console.log(`[setup] hand model downloaded (${(bytes.length / 1e6).toFixed(1)} MB)`);
  }
} catch (err) {
  console.warn('[setup] could not download the hand model (hand tracking will be off until `npm run setup` works):', err.message);
}
