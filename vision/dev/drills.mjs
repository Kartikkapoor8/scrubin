// Failure drills for VIPER Vision. Each one starts from a running demo on a fake headset, breaks something,
// and checks that the app says so calmly (branded banner and chips, nothing raw) and recovers by itself.
//
//   node dev/drills.mjs                       all the quick drills (about 8 minutes)
//   node dev/drills.mjs --only drop,reload    some of them: drop unreachable network gemini reload resets
//   node dev/drills.mjs --soak 90             continuous runs for 90 minutes, sampling memory and CPU
//   --app-port 4751 --mock-port 8473 --dist dist-soak   to run two at once
//
// It builds the app into dist-drills/ and serves that on its own ports (app 4749, fake headset 8453), so the
// development server on 4747 and anyone editing the code are left alone. Screenshots and results go to
// shots/drills/ (gitignored); the summary is printed at the end and written to shots/drills/results.json.
// Nothing here touches the real headset or the real network: "Wi-Fi off" is simulated by freezing (silent
// loss) and then killing (refused) the fake headset, and "Gemini down" by a key Google rejects.
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'shots', 'drills');
fs.mkdirSync(out, { recursive: true });
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
// Own ports and build folder, so a soak and the quick drills can run side by side (--app-port, --mock-port).
const MOCK_PORT = Number(arg('mock-port', '8453'));
const APP_PORT = Number(arg('app-port', '4749'));
const DIST = arg('dist', 'dist-drills');
const only = arg('only', '').split(',').filter(Boolean);
const soakMinutes = Number(arg('soak', '0'));
const wants = (name) => soakMinutes === 0 && (only.length === 0 || only.includes(name));

// Anything like this in a banner or chip is a raw error leaking through to the audience.
const RAW_WORDS = /error:|exception|typeerror|referenceerror|undefined|\bnull\b|\[object|failed to fetch|stack trace|\bat \w+ \(/i;
const RAW_CODES = /\bNaN\b|\bE(?:CONN|HOST|NET|TIMEDOUT|PIPE|PROTO)[A-Z]*\b/;

// ---------------------------------------------------------------------------------------------------
// Processes: the fake headset and the app server, started and stopped by the drills.

const procs = new Set();
function start(args, env = {}) {
  const child = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d; });
  child.stderr.on('data', (d) => { child.log += d; });
  procs.add(child);
  child.on('exit', () => procs.delete(child));
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
}
const cleanup = () => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(test, ms, step = 200) {
  const started = Date.now();
  for (;;) {
    try { if (await test()) return Date.now() - started; } catch { /* not yet */ }
    if (Date.now() - started > ms) return -1;
    await sleep(step);
  }
}

function mock(extra = []) {
  return start(['dev/mock-hololens.mjs', '--port', String(MOCK_PORT), ...extra]);
}
async function mockUp(child) {
  return (await waitFor(() => child.log.includes('fake HoloLens Device Portal'), 15000)) >= 0;
}
function app(env = {}) {
  return start(['server/index.mjs'], {
    VISION_PORT: String(APP_PORT), VISION_REMOTE: '0', VISION_DIST: DIST,
    HOLOLENS_IP: '127.0.0.1', HOLOLENS_PORT: String(MOCK_PORT), HOLOLENS_USER: 'dev', HOLOLENS_PASS: 'dev',
    GEMINI_API_KEY: '', ...env,
  });
}
async function appUp() {
  return (await waitFor(async () => (await fetch(`http://localhost:${APP_PORT}/api/config`)).ok, 15000)) >= 0;
}

// ---------------------------------------------------------------------------------------------------
// The page.

let browser;
async function open(query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.problems = [];
  page.on('console', (m) => {
    // MediaPipe's native logging (W1115 ... gl_context.cc) is noise, not an app error.
    // Nor is Chrome noting the relay's 502/504 answers while the headset is away: that is the relay saying
    // "not now", by design, and the page turns it into a calm banner.
    const expected = /Failed to load resource/.test(m.text()) && /\/api\/(stream|gemini-token)/.test(m.location().url || '');
    if (m.type() === 'error' && !expected && !/^[WIE]\d{4} /.test(m.text())) page.problems.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`.slice(0, 200)));
  await page.goto(`http://localhost:${APP_PORT}/?${query}`, { waitUntil: 'domcontentloaded' });
  return page;
}
const close = async (page) => { try { await page.context().close(); } catch { /* closed */ } };
const viper = (page, part) => page.evaluate((p) => window.__viper.parts[p](), part);
const inputState = async (page) => (await viper(page, 'input')).status.state;
const visibleText = (page) => page.evaluate(() => {
  const banner = document.querySelector('.banner');
  const chips = [...document.querySelectorAll('.chip')].filter((c) => c.style.display !== 'none' && c.offsetParent !== null).map((c) => c.textContent.trim());
  return { banner: banner && banner.classList.contains('banner--on') ? banner.textContent.trim() : '', chips };
});
async function shot(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
/** Start a run and step into the procedure, as if a demo were under way. */
async function runningDemo(page, steps = 3) {
  const live = await waitFor(async () => (await inputState(page)) === 'live', 20000);
  if (live < 0) return false;
  await sleep(1500);
  for (let i = 0; i < steps; i++) { await page.keyboard.press('ArrowRight'); await sleep(900); }
  return true;
}
function rawIn(text) {
  const all = [text.banner, ...text.chips].join(' | ');
  const m = all.match(RAW_WORDS) || all.match(RAW_CODES);
  return m ? `raw text on screen: "${all.slice(Math.max(0, m.index - 40), m.index + 60)}"` : '';
}

const results = [];
function report(name, pass, facts, problems = []) {
  results.push({ name, pass, ...facts, problems });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(facts)}${problems.length ? `\n      problems: ${problems.join(' || ')}` : ''}`);
}

const DEMO = 'input=hololens&sound=0&attract=0&done=0&idle=0';

// ---------------------------------------------------------------------------------------------------
// The drills.

async function drillDrop() {
  const m = mock(['--drop-after', '12']);
  await mockUp(m);
  const a = app();
  await appUp();
  const page = await open(DEMO);
  const ok = await runningDemo(page);
  const before = (await viper(page, 'procedure')).step;
  const dropAt = await waitFor(async () => (await inputState(page)) !== 'live', 20000, 100);
  await sleep(300);
  const during = await visibleText(page);
  const frameHeld = await page.evaluate(() => {
    const c = document.querySelector('canvas.stage__picture');
    return Boolean(c && c.width > 0);
  });
  await shot(page, 'drop-reconnecting');
  const back = await waitFor(async () => (await inputState(page)) === 'live', 20000, 100);
  const after = (await viper(page, 'procedure')).step;
  await sleep(800);
  await shot(page, 'drop-recovered');
  const problems = [...page.problems];
  const raw = rawIn(during);
  if (raw) problems.push(raw);
  report('stream drops mid-run', ok && dropAt >= 0 && back >= 0 && after === before && !raw, {
    recoveredInMs: back, stepKept: `${before} -> ${after}`, frameHeld, banner: during.banner,
  }, problems);
  await close(page);
  await stop(a);
  await stop(m);
}

async function drillUnreachable() {
  // An address nothing answers (TEST-NET-1): the slowest way to fail, a connect timeout.
  const a = app({ HOLOLENS_IP: '192.0.2.1', HOLOLENS_PORT: '443' });
  await appUp();
  // Left to choose by itself, the app should move on to the webcam and say why.
  let page = await open('sound=0&attract=0&done=0&idle=0');
  const fell = await waitFor(async () => {
    const input = await viper(page, 'input');
    return input.kind === 'webcam' && input.status.state === 'live';
  }, 25000);
  const autoText = await visibleText(page);
  await shot(page, 'unreachable-auto-fallback');
  const problemsA = [...page.problems];
  await close(page);
  // Chosen by the operator, it keeps trying (it never switches by itself), calmly.
  page = await open('input=hololens&sound=0&attract=0&done=0&idle=0');
  await sleep(9000);
  const chosen = await viper(page, 'input');
  const chosenText = await visibleText(page);
  await shot(page, 'unreachable-chosen-retrying');
  // And the show goes on: key 4 (simulated arm) gives a working picture at once.
  await page.keyboard.press('4');
  const simLive = await waitFor(async () => (await inputState(page)) === 'live', 8000);
  const problems = [...problemsA, ...page.problems];
  for (const t of [autoText, chosenText]) { const raw = rawIn(t); if (raw) problems.push(raw); }
  report('headset unreachable at launch', fell >= 0 && chosen.kind === 'hololens' && chosen.status.state !== 'live' && simLive >= 0 && !problems.some((p) => p.startsWith('raw')), {
    autoFallbackToWebcamMs: fell, autoBanner: autoText.banner, chosenState: chosen.status.state, chosenBanner: chosenText.banner, key4LiveMs: simLive,
  }, problems);
  await close(page);
  await stop(a);
}

async function drillNetwork() {
  let m = mock();
  await mockUp(m);
  const a = app();
  await appUp();
  const page = await open(DEMO);
  const ok = await runningDemo(page);
  // Silent loss (Wi-Fi gone, no reset sent): freeze the fake headset.
  process.kill(m.pid, 'SIGSTOP');
  const noticed = await waitFor(async () => (await inputState(page)) !== 'live', 20000, 100);
  await sleep(500);
  const silentText = await visibleText(page);
  await shot(page, 'network-silent-loss');
  await sleep(6000);
  // Then the headset is gone altogether (connection refused) for a while.
  process.kill(m.pid, 'SIGCONT');
  await stop(m);
  await sleep(8000);
  const goneText = await visibleText(page);
  const stillTrying = await inputState(page);
  await shot(page, 'network-headset-gone');
  // Network back: the stream must come back by itself.
  m = mock();
  await mockUp(m);
  const back = await waitFor(async () => (await inputState(page)) === 'live', 25000, 100);
  await sleep(800);
  await shot(page, 'network-recovered');
  const problems = [...page.problems];
  for (const t of [silentText, goneText]) { const raw = rawIn(t); if (raw) problems.push(raw); }
  report('network loss (silent, then refused), then back', ok && noticed >= 0 && back >= 0 && stillTrying !== 'live' && !problems.some((p) => p.startsWith('raw')), {
    silentLossNoticedMs: noticed, silentBanner: silentText.banner, goneBanner: goneText.banner, recoveredAfterReturnMs: back,
  }, problems);
  await close(page);
  await stop(a);
  await stop(m);
}

async function drillGemini() {
  const m = mock();
  await mockUp(m);
  // A key of the right shape that Google rejects: the same path as Gemini being unreachable.
  const a = app({ GEMINI_API_KEY: 'AIzaSyDrill0000000000000000000000000000' });
  await appUp();
  const page = await open('input=hololens&sound=0&attract=0&done=0&idle=0');
  const ok = await runningDemo(page, 2);
  await sleep(12000);
  const attending = await viper(page, 'attending');
  const text = await visibleText(page);
  await shot(page, 'gemini-invalid-key');
  // The demo itself must be untouched: step on and place a suture.
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await sleep(900); }
  await page.keyboard.press('ArrowRight');
  await sleep(2500);
  const proc = await viper(page, 'procedure');
  const problems = [...page.problems];
  const raw = rawIn(text);
  if (raw) problems.push(raw);
  report('Gemini down or key invalid', ok && proc.stitchesDone >= 1 && !raw, {
    attendingState: attending.state, attendingDetail: attending.detail, chips: text.chips.join(' / '), banner: text.banner, demoCarriedOn: `${proc.step}, ${proc.stitchesDone} suture(s)`,
  }, problems);
  await close(page);
  await stop(a);
  await stop(m);
}

async function drillReload() {
  const m = mock();
  await mockUp(m);
  const a = app();
  await appUp();
  const page = await open(DEMO);
  const ok = await runningDemo(page, 4);
  // A remembered setting must survive the reload: switch the stream preset first.
  await page.keyboard.press('q');
  await waitFor(async () => (await inputState(page)) === 'live', 15000);
  const quality = (await viper(page, 'stream')).quality;
  const started = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const live = await waitFor(async () => (await inputState(page)) === 'live', 20000, 100);
  const liveMs = live >= 0 ? Date.now() - started : -1;
  const wound = await waitFor(async () => (await viper(page, 'wound')).locked, 15000, 100);
  const kept = (await viper(page, 'stream')).quality;
  const step = (await viper(page, 'procedure')).step;
  await shot(page, 'reload-back');
  // Leave the preset as it was.
  await page.evaluate(() => localStorage.removeItem('viper.hlq'));
  report('page reload mid-run', ok && liveMs >= 0 && kept === quality && step === 'standby', {
    liveAgainMs: liveMs, woundLockedAfterMs: wound, presetKept: `${quality} -> ${kept}`, step,
  }, [...page.problems]);
  await close(page);
  await stop(a);
  await stop(m);
}

async function drillResets() {
  const m = mock();
  await mockUp(m);
  const a = app();
  await appUp();
  const page = await open(DEMO);
  const ok = await runningDemo(page, 0);
  const measure = () => page.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0,
  }));
  const before = await measure();
  for (let i = 0; i < 30; i++) {
    for (let k = 0; k < i % 7; k++) { await page.keyboard.press('ArrowRight'); await sleep(120); }
    await page.keyboard.press('r');
    await sleep(220);
  }
  await sleep(1500);
  const afterResets = await viper(page, 'procedure');
  const nodes = await measure();
  // Then a full hands-free run must still work start to finish.
  await page.keyboard.press('a');
  const done = await waitFor(async () => (await viper(page, 'procedure')).step === 'complete', 90000, 250);
  await shot(page, 'resets-then-full-run');
  await page.keyboard.press('r');
  await sleep(800);
  const after = await measure();
  const fps = await viper(page, 'fps');
  report('30 resets in a row, then a full run', ok && afterResets.step === 'standby' && done >= 0 && after.nodes <= before.nodes + 20, {
    stepAfterResets: afterResets.step, fullRunMs: done, nodes: `${before.nodes} -> ${nodes.nodes} -> ${after.nodes}`, heapMb: `${before.heapMb} -> ${after.heapMb}`, fps: fps.fps,
  }, [...page.problems]);
  await close(page);
  await stop(a);
  await stop(m);
}

/** Continuous hands-free runs for a long time, sampling memory and CPU every minute. */
async function soak(minutes) {
  const m = mock();
  await mockUp(m);
  const a = app();
  await appUp();
  const page = await open(DEMO);
  await runningDemo(page, 0);
  const file = path.join(out, `soak-${APP_PORT}.jsonl`);
  fs.writeFileSync(file, '');
  // Chrome's main process is a child of this script (as are the two servers); its helpers are its children.
  const childPids = (pid) => {
    try { return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim().split('\n').map(Number).filter(Boolean); } catch { return []; }
  };
  const browserPid = childPids(process.pid).find((pid) => {
    try { return /Chrome/.test(execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
  });
  const psStats = (pids) => {
    if (!pids.length) return { cpu: 0, rssMb: 0 };
    try {
      const rows = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', pids.join(',')], { encoding: 'utf8' }).trim().split('\n');
      let cpu = 0, rss = 0;
      for (const row of rows) { const [c, r] = row.trim().split(/\s+/).map(Number); cpu += c || 0; rss += r || 0; }
      return { cpu: +cpu.toFixed(1), rssMb: +(rss / 1024).toFixed(0) };
    } catch { return { cpu: 0, rssMb: 0 }; }
  };
  const chromePids = () => (browserPid ? [browserPid, ...childPids(browserPid)] : []);
  const started = Date.now();
  let runs = 0;
  let nextSample = 0;
  const samples = [];
  while (Date.now() - started < minutes * 60000) {
    await page.keyboard.press('r');
    await sleep(600);
    await page.keyboard.press('a');
    const done = await waitFor(async () => (await viper(page, 'procedure')).step === 'complete', 120000, 500);
    if (done >= 0) runs++;
    await sleep(2500);
    if (Date.now() - started >= nextSample) {
      nextSample += 60000;
      const page_ = await page.evaluate(() => ({
        nodes: document.getElementsByTagName('*').length,
        heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0,
      }));
      const fps = await viper(page, 'fps');
      const video = await viper(page, 'video');
      const sample = {
        minute: +((Date.now() - started) / 60000).toFixed(1), runs, ...page_, fps: fps.fps, worstFrameMs: fps.worstFrameMs,
        videoLag: video.lag, chrome: psStats(chromePids()), server: psStats([a.pid]), headset: psStats([m.pid]),
        input: (await viper(page, 'input')).status.state,
      };
      samples.push(sample);
      fs.appendFileSync(file, JSON.stringify(sample) + '\n');
      console.log(`soak ${sample.minute} min  runs ${runs}  heap ${sample.heapMb} MB  nodes ${sample.nodes}  fps ${sample.fps}  chrome ${sample.chrome.rssMb} MB ${sample.chrome.cpu}%  server ${sample.server.rssMb} MB ${sample.server.cpu}%  ${sample.input}`);
    }
  }
  await shot(page, 'soak-end');
  const avg = (list, f) => list.length ? +(list.reduce((s, x) => s + f(x), 0) / list.length).toFixed(1) : 0;
  const head = samples.slice(1, 6);
  const tail = samples.slice(-5);
  const summary = {
    minutes, runs, problems: page.problems.length,
    heapMb: `${avg(head, (s) => s.heapMb)} -> ${avg(tail, (s) => s.heapMb)}`,
    nodes: `${avg(head, (s) => s.nodes)} -> ${avg(tail, (s) => s.nodes)}`,
    chromeRssMb: `${avg(head, (s) => s.chrome.rssMb)} -> ${avg(tail, (s) => s.chrome.rssMb)}`,
    chromeCpu: `${avg(head, (s) => s.chrome.cpu)} -> ${avg(tail, (s) => s.chrome.cpu)}`,
    serverRssMb: `${avg(head, (s) => s.server.rssMb)} -> ${avg(tail, (s) => s.server.rssMb)}`,
    fps: `${avg(head, (s) => s.fps)} -> ${avg(tail, (s) => s.fps)}`,
  };
  report(`soak: ${minutes} min of continuous runs`, page.problems.length === 0, summary, page.problems.slice(0, 5));
  await close(page);
  await stop(a);
  await stop(m);
}

// ---------------------------------------------------------------------------------------------------

console.log('building the app into dist-drills/ ...');
execFileSync('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' });
browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-precise-memory-info',
  ],
});
try {
  if (wants('drop')) await drillDrop();
  if (wants('unreachable')) await drillUnreachable();
  if (wants('network')) await drillNetwork();
  if (wants('gemini')) await drillGemini();
  if (wants('reload')) await drillReload();
  if (wants('resets')) await drillResets();
  if (soakMinutes > 0) await soak(soakMinutes);
} finally {
  await browser.close();
  cleanup();
}
const file = path.join(out, soakMinutes > 0 ? `soak-results-${APP_PORT}.json` : 'results.json');
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed. Details: ${file}`);
