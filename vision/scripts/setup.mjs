// One-time setup, run automatically after `npm install` (and by hand with `npm run setup`).
// Copies MediaPipe's WebAssembly runtime out of node_modules and downloads its models, so the app
// needs no internet on stage. Both land in public/ and are gitignored. Never fails the install: if the model
// cannot be downloaded, hand tracking is simply unavailable until `npm run setup` succeeds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmFrom = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmTo = path.join(root, 'public', 'mediapipe', 'wasm');
// Google's published models (Apache 2.0): Hand Landmarker, and the multiclass selfie segmenter whose
// body-skin class Arm mode uses to find the forearm.
const MODELS = [
  {
    name: 'hand model',
    to: path.join(root, 'public', 'models', 'hand_landmarker.task'),
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    name: 'skin segmenter model',
    to: path.join(root, 'public', 'models', 'selfie_multiclass_256x256.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  },
];

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

for (const model of MODELS) {
  try {
    if (fs.existsSync(model.to) && fs.statSync(model.to).size > 1_000_000) {
      console.log(`[setup] ${model.name} already present`);
    } else {
      fs.mkdirSync(path.dirname(model.to), { recursive: true });
      const res = await fetch(model.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 1_000_000) throw new Error('download looks truncated');
      fs.writeFileSync(model.to, bytes);
      console.log(`[setup] ${model.name} downloaded (${(bytes.length / 1e6).toFixed(1)} MB)`);
    }
  } catch (err) {
    console.warn(`[setup] could not download the ${model.name} (that feature stays off until \`npm run setup\` works):`, err.message);
  }
}
