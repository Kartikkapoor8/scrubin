// Opens VIPER Vision in headless Chrome, runs a few steps, and saves screenshots: the way to look at the
// app without a person at the screen.
//
//   node dev/shot.mjs --url "http://localhost:4747/?input=sim" --do "wait:2500;;shot:idle;;key:Space;;wait:3000;;shot:scan"
//
// Steps (separated by ;;):  wait:<ms>   key:<Key>   shot:<name>[@x/y/w/h]   eval:<js expression, result printed>
// The page exposes window.__viper.debug() with the state worth checking.
// Options: --size 1600x900   --out shots   --camera <file.y4m|.mjpeg> (fake webcam picture)   --scale 1
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:4747/?input=sim');
const steps = arg('do', 'wait:2500;;shot:page').split(';;').map((s) => s.trim()).filter(Boolean);
const [width, height] = arg('size', '1600x900').split('x').map(Number);
const outDir = path.resolve(here, '..', arg('out', 'shots'));
const camera = arg('camera', '');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(camera ? [`--use-file-for-fake-video-capture=${path.resolve(camera)}`] : []),
    '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal',
  ],
});
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(arg('scale', '1')) });
const page = await context.newPage();
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
for (const step of steps) {
  const [verb, ...rest] = step.split(':');
  const value = rest.join(':');
  if (verb === 'wait') await page.waitForTimeout(Number(value));
  else if (verb === 'key') await page.keyboard.press(value);
  else if (verb === 'eval') console.log(`eval ${value} ->`, JSON.stringify(await page.evaluate(value)));
  else if (verb === 'shot') {
    const [name, region] = value.split('@');
    const file = path.join(outDir, `${name}.png`);
    const options = { path: file };
    if (region) {
      const [x, y, w, h] = region.split('/').map(Number);
      options.clip = { x, y, width: w, height: h };
    }
    await page.screenshot(options);
    console.log('saved', file);
  }
}
if (problems.length) console.log('--- console problems ---\n' + [...new Set(problems)].slice(0, 30).join('\n'));
else console.log('no console errors or warnings');
await browser.close();
