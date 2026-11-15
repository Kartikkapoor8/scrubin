// Records B-roll for the video: 1080p MP4s of the app in headless Chrome, with no cursor and no operator UI.
//
//   node dev/broll.mjs [--base "http://localhost:4747/?input=sim"] [--runs 2] [--idle 30] [--out media/broll]
//                      [--query "clean=1&panel=1"] [--prefix run]      (--idle 0: no idle loop)
//
// Makes `run-1.mp4`, `run-2.mp4`, ... (each a full autoplay run, Ready to the score card and a few seconds of
// it) and `idle-loop.mp4` (the idle screen; loop it with a short crossfade: the picture behind it never repeats exactly). Frames come from
// Chrome's screencast at full size and are re-timed to a steady 30 fps, then encoded once (H.264, CRF 16).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://localhost:4747/?input=sim');
const runs = Number(arg('runs', '2'));
const idleSeconds = Number(arg('idle', '30'));
const outDir = path.resolve(here, '..', arg('out', 'media/broll'));
const extra = arg('query', '');
const prefix = arg('prefix', 'run');
fs.mkdirSync(outDir, { recursive: true });
const FPS = 30;
const sep = base.includes('?') ? '&' : '?';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--hide-scrollbars'],
});

/** Record the page into an MP4 until `until()` resolves. */
async function record(page, file, until) {
  const cdp = await page.context().newCDPSession(page);
  const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), file],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  let last = null; // { data, at }
  let written = 0;
  let firstAt = -1;
  const write = (buffer) => new Promise((resolve) => { if (!ffmpeg.stdin.write(buffer)) ffmpeg.stdin.once('drain', resolve); else resolve(); });
  let chain = Promise.resolve();
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const at = metadata.timestamp; // seconds
    if (firstAt < 0) firstAt = at;
    const frame = { data: Buffer.from(data, 'base64'), at };
    // Hold each frame until the next arrives: as many 1/30 s ticks as it was on screen.
    if (last) {
      const due = Math.round((at - firstAt) * FPS);
      const repeat = Math.max(0, due - written);
      const previous = last.data;
      for (let i = 0; i < repeat; i++) chain = chain.then(() => write(previous));
      written += repeat;
    }
    last = frame;
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await until();
  await cdp.send('Page.stopScreencast');
  if (last) chain = chain.then(() => write(last.data));
  await chain;
  ffmpeg.stdin.end();
  await new Promise((resolve) => ffmpeg.on('close', resolve));
  console.log(`saved ${file} (${(written / FPS).toFixed(1)} s)`);
}

async function open(query) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${base}${sep}sound=0${query}${extra ? `&${extra}` : ''}`, { waitUntil: 'domcontentloaded' });
  return page;
}
const step = (page) => page.evaluate(() => window.__viper.parts.procedure().step);

for (let i = 1; i <= runs; i++) {
  const page = await open('&attract=0&done=0&idle=0');
  await page.waitForTimeout(3500);
  await record(page, path.join(outDir, runs > 1 ? `${prefix}-${i}.mp4` : `${prefix}.mp4`), async () => {
    await page.waitForTimeout(1500);
    await page.keyboard.press('a');
    const started = Date.now();
    while ((await step(page)) !== 'complete' && Date.now() - started < 150000) await page.waitForTimeout(250);
    await page.waitForTimeout(6000); // the score card, settled
  });
  await page.context().close();
}

if (idleSeconds > 0) {
  const page = await open('&attract=1');
  await page.waitForTimeout(4500); // the idle screen has come up and settled
  await record(page, path.join(outDir, 'idle-loop.mp4'), () => page.waitForTimeout(idleSeconds * 1000));
  await page.context().close();
}
await browser.close();
