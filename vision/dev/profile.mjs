// Frame-rate profile of one full hands-free run with every overlay on, in headless Chrome on this Mac.
//
//   node dev/profile.mjs [--url "http://localhost:4747/?input=sim"] [--size 1920x1080] [--scale 2]
//
// Prints: frame times (median, 95th, 99th percentile, frames over 16.7 ms and 33 ms), per-step frame rate,
// the long animation frames Chrome attributes to scripts, the functions with the most CPU time, and the app's
// own timings (wound analysis, hand tracking). Writes the raw numbers to shots/profile/profile.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'shots', 'profile');
fs.mkdirSync(out, { recursive: true });
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:4747/?input=sim');
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const scale = Number(arg('scale', '2'));
const sep = url.includes('?') ? '&' : '?';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-precise-memory-info'],
});
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Watch every frame and every long animation frame from the very start.
await page.addInitScript(() => {
  const w = window;
  w.__prof = { frames: [], loaf: [], marks: [] };
  let last = 0;
  const tick = (now) => {
    if (last) w.__prof.frames.push([now, now - last]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__prof.loaf.push({
          at: entry.startTime, ms: entry.duration, blocking: entry.blockingDuration,
          scripts: (entry.scripts || []).map((s) => ({ ms: s.duration, fn: s.sourceFunctionName, src: (s.sourceURL || '').split('/').pop(), invoker: s.invoker })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* not supported */ }
});

await page.goto(`${url}${sep}sound=0&attract=0&done=0&idle=0&autoplay=0`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const cdp = await context.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await page.evaluate(() => { window.__prof.frames = []; window.__prof.loaf = []; });
await cdp.send('Profiler.start');

// One full run: autoplay from Ready to the score card, noting when each step begins.
await page.keyboard.press('a');
const started = Date.now();
let lastStep = '';
for (;;) {
  const step = await page.evaluate(() => {
    const s = window.__viper.parts.procedure().step;
    if (s !== window.__prof.lastStep) { window.__prof.marks.push([performance.now(), s]); window.__prof.lastStep = s; }
    return s;
  });
  if (step !== lastStep) lastStep = step;
  if (step === 'complete' || Date.now() - started > 120000) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(4000); // the score card's entrance
const { profile } = await cdp.send('Profiler.stop');
const data = await page.evaluate(() => ({ prof: window.__prof, parts: window.__viper.debug() }));
await page.screenshot({ path: path.join(out, 'end.png') });
await browser.close();

// ---- frame times ----
const times = data.prof.frames.map(([, dt]) => dt).sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
const over = (ms) => times.filter((t) => t > ms).length;
console.log(`\n${times.length} frames over ${((Date.now() - started) / 1000).toFixed(0)} s at ${width}x${height} @${scale}x`);
console.log(`frame time: median ${pct(0.5).toFixed(1)} ms, p95 ${pct(0.95).toFixed(1)} ms, p99 ${pct(0.99).toFixed(1)} ms, worst ${times[times.length - 1].toFixed(1)} ms`);
console.log(`frames over 16.7 ms: ${over(17.5)} (${((over(17.5) / times.length) * 100).toFixed(1)}%), over 33 ms: ${over(34)}`);

// ---- per step ----
const marks = data.prof.marks;
for (let i = 0; i < marks.length; i++) {
  const from = marks[i][0], to = i + 1 < marks.length ? marks[i + 1][0] : Infinity;
  const inStep = data.prof.frames.filter(([at]) => at >= from && at < to).map(([, dt]) => dt);
  if (!inStep.length) continue;
  const mean = inStep.reduce((s, x) => s + x, 0) / inStep.length;
  const slow = inStep.filter((t) => t > 17.5).length;
  console.log(`  ${marks[i][1].padEnd(9)} ${(1000 / mean).toFixed(1)} fps, ${slow} slow frames of ${inStep.length}, worst ${Math.max(...inStep).toFixed(1)} ms`);
}

// ---- long animation frames ----
const scripts = new Map();
for (const frame of data.prof.loaf) {
  for (const s of frame.scripts) {
    const key = `${s.fn || '(anonymous)'} @ ${s.src} [${s.invoker || ''}]`;
    const entry = scripts.get(key) || { ms: 0, n: 0 };
    entry.ms += s.ms; entry.n += 1;
    scripts.set(key, entry);
  }
}
console.log(`\nlong animation frames: ${data.prof.loaf.length}`);
for (const [key, v] of [...scripts.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)) {
  console.log(`  ${v.ms.toFixed(0).padStart(6)} ms in ${String(v.n).padStart(4)} long frames  ${key}`);
}

// ---- CPU profile: self time by function ----
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const interval = (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length) / 1000; // ms per sample
for (const id of profile.samples) {
  const node = byId.get(id);
  if (!node) continue;
  const cf = node.callFrame;
  const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + interval);
}
const total = [...self.values()].reduce((s, x) => s + x, 0);
console.log(`\nCPU self time (top 15 of ${total.toFixed(0)} ms sampled):`);
for (const [key, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}

console.log(`\napp timings: wound analysis ${data.parts.wound?.analysisMs} ms, hands ${data.parts.hands?.ms} ms, fps ${data.parts.fps?.fps}`);
if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
fs.writeFileSync(path.join(out, 'profile.json'), JSON.stringify({ frames: data.prof.frames.length, marks, loaf: data.prof.loaf.slice(0, 200), self: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60) }, null, 2));
