// Builds a test clip for Arm mode from two photos: a forearm and an open hand. Nobody has to hold an arm
// in front of a camera. The arm slides into view, holds still apart from a little head motion, can have
// red marker "cuts" drawn on it, then slides out again.
//
//   node dev/make-arm-clip.mjs --forearm <photo.jpg> --hand <hand.png> [--cuts 0|2] [--out dev/media/arm-clip]
//
// It writes <out>.mp4 (play it as input 3, or with ?clip=) and <out>.mjpeg (a fake webcam: input 2 in
// dev/shot.mjs --camera <out>.mjpeg). Both are gitignored, and so are the photos. The ones used on 2026-11-14:
//   forearm  Wikimedia Commons, "Allergy test on arm.jpg" (CC0), the 1280 px preview
//   hand     Pixabay 1921036, open hand palm up (Pixabay Content License), the 1280 px PNG with transparency
// The forearm photo shows two arms palm up on a table; the left one is cut out and laid across the view,
// and the hand is colour-matched and joined on at the wrist.
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
const forearmFile = arg('forearm', '');
const handFile = arg('hand', '');
if (!forearmFile || !handFile) {
  console.error('usage: node dev/make-arm-clip.mjs --forearm <photo.jpg> --hand <hand.png> [--cuts 0|2] [--out dev/media/arm-clip]');
  process.exit(1);
}
const cuts = Number(arg('cuts', '2'));
const out = path.resolve(here, '..', arg('out', 'dev/media/arm-clip'));
const fps = 30;
fs.mkdirSync(path.dirname(out), { recursive: true });

const dataUrl = (file) => {
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${fs.readFileSync(path.resolve(file)).toString('base64')}`;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.setContent('<canvas id="c" width="1280" height="720"></canvas>');

const info = await page.evaluate(async ({ forearm, hand, cuts }) => {
  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  const arm = await load(forearm);
  const palm = await load(hand);
  const W = arm.width;
  const H = arm.height;

  // ----- 1. The left forearm: skin pixels joined to a seed in it, holes (ink marks) filled row by row -----
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(arm, 0, 0);
  const pixels = sctx.getImageData(0, 0, W, H);
  const d = pixels.data;
  const skin = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // Skin is warm and clearly saturated; the white table, paper and sleeves are not.
    skin[p] = r > 80 && g > 30 && b > 10 && r >= g && r > b && mx - mn > 0.2 * mx && r - b > 40 ? 1 : 0;
  }
  // Seed: the nearest skin pixel to a point in the middle of the left forearm.
  let seed = -1;
  const sx0 = Math.round(W * 0.22), sy0 = Math.round(H * 0.5);
  for (let radius = 0; radius < 80 && seed < 0; radius += 2) {
    for (let dy = -radius; dy <= radius && seed < 0; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        const p = (sy0 + dy) * W + (sx0 + dx);
        if (skin[p]) { seed = p; break; }
      }
    }
  }
  const comp = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  stack[top++] = seed;
  comp[seed] = 1;
  while (top > 0) {
    const p = stack[--top];
    const x = p % W, y = (p - x) / W;
    const next = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
    for (const q of next) if (q >= 0 && skin[q] && !comp[q]) { comp[q] = 1; stack[top++] = q; }
  }
  // Keep the forearm between the sleeve and the wrist (the fist at the bottom is cropped by the photo).
  const yTop = Math.round(H * 0.11);
  const yWrist = Math.round(H * 0.835);
  const rows = [];
  for (let y = yTop; y <= yWrist; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < W; x++) if (comp[y * W + x]) { if (lo < 0) lo = x; hi = x; }
    rows.push({ y, lo, hi });
  }
  // Smooth the silhouette: a running median of each edge, so ragged pixels at the border do not show.
  const median = (values) => values.slice().sort((a, b) => a - b)[values.length >> 1];
  const lo = rows.map((r, i) => median(rows.slice(Math.max(0, i - 6), i + 7).filter((q) => q.lo >= 0).map((q) => q.lo)));
  const hi = rows.map((r, i) => median(rows.slice(Math.max(0, i - 6), i + 7).filter((q) => q.hi >= 0).map((q) => q.hi)));
  const cut = document.createElement('canvas');
  cut.width = W; cut.height = H;
  const cctx = cut.getContext('2d');
  cctx.beginPath();
  cctx.moveTo(lo[0], rows[0].y);
  for (let i = 1; i < rows.length; i++) cctx.lineTo(lo[i], rows[i].y);
  for (let i = rows.length - 1; i >= 0; i--) cctx.lineTo(hi[i], rows[i].y);
  cctx.closePath();
  cctx.filter = 'blur(2px)';
  cctx.fillStyle = '#fff';
  cctx.fill();
  cctx.filter = 'none';
  cctx.globalCompositeOperation = 'source-in';
  cctx.drawImage(arm, 0, 0);
  // Feather the wrist end so it blends into the hand photo's own wrist.
  cctx.globalCompositeOperation = 'destination-out';
  const fade = cctx.createLinearGradient(0, yWrist - 70, 0, yWrist);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  cctx.fillStyle = fade;
  cctx.fillRect(0, yWrist - 70, W, 72);
  cctx.globalCompositeOperation = 'source-over';

  // The arm's axis (least squares through the row centres) and its width at the wrist and in the middle.
  let n = 0, sy = 0, sxc = 0, syy = 0, sxy = 0;
  for (let i = 0; i < rows.length; i++) {
    const cx = (lo[i] + hi[i]) / 2;
    n++; sy += rows[i].y; sxc += cx; syy += rows[i].y ** 2; sxy += rows[i].y * cx;
  }
  const slope = (n * sxy - sy * sxc) / (n * syy - sy * sy);
  const icept = (sxc - slope * sy) / n;
  const wristX = slope * yWrist + icept;
  const elbowX = slope * yTop + icept;
  // Widths as medians over a band of rows, so one ragged row cannot throw them.
  const widthAt = (from, to) => median(rows.slice(from, to).map((r, i) => hi[from + i] - lo[from + i]));
  const wristWidth = widthAt(rows.length - 40, rows.length - 10);
  const midWidth = widthAt((rows.length >> 1) - 20, (rows.length >> 1) + 20);
  // Direction from the wrist toward the elbow, in the photo.
  const ux = elbowX - wristX, uy = yTop - yWrist;
  const armLength = Math.hypot(ux, uy);
  const theta = Math.atan2(uy, ux);

  // Mean skin colour of the forearm (for matching the hand to it).
  let mr = 0, mg = 0, mb = 0, mc = 0;
  for (let i = 0; i < rows.length; i += 4) {
    const y = rows[i].y;
    for (let x = lo[i] + 20; x < hi[i] - 20; x += 4) {
      const q = (y * W + x) * 4;
      if (d[q] > 120) { mr += d[q]; mg += d[q + 1]; mb += d[q + 2]; mc++; }
    }
  }
  mr /= mc; mg /= mc; mb /= mc;

  // ----- 2. The hand: colour-matched, scaled to the wrist, flipped so its fingers point away from the elbow -----
  const hw = palm.width, hh = palm.height;
  const hc = document.createElement('canvas');
  hc.width = hw; hc.height = hh;
  const hctx = hc.getContext('2d', { willReadFrequently: true });
  hctx.drawImage(palm, 0, 0);
  const hp = hctx.getImageData(0, 0, hw, hh);
  const hd = hp.data;
  let hr = 0, hg = 0, hb = 0, hn = 0;
  for (let i = 0; i < hd.length; i += 16) if (hd[i + 3] > 220 && hd[i] > 90) { hr += hd[i]; hg += hd[i + 1]; hb += hd[i + 2]; hn++; }
  hr /= hn; hg /= hn; hb /= hn;
  const gain = [mr / hr, mg / hg, mb / hb];
  for (let i = 0; i < hd.length; i += 4) {
    hd[i] = Math.min(255, hd[i] * gain[0]);
    hd[i + 1] = Math.min(255, hd[i + 1] * gain[1]);
    hd[i + 2] = Math.min(255, hd[i + 2] * gain[2]);
  }
  hctx.putImageData(hp, 0, 0);
  // The hand photo's wrist: the narrowest opaque column near its left edge (the forearm stub runs off that edge).
  let handWristX = 0, handWristTop = 0, handWristBottom = 0, best = Infinity;
  for (let x = Math.round(hw * 0.12); x < Math.round(hw * 0.3); x += 2) {
    let a = -1, b = -1;
    for (let y = 0; y < hh; y++) if (hd[(y * hw + x) * 4 + 3] > 128) { if (a < 0) a = y; b = y; }
    if (a >= 0 && b - a < best) { best = b - a; handWristX = x; handWristTop = a; handWristBottom = b; }
  }
  const handScale = wristWidth / Math.max(1, handWristBottom - handWristTop);
  const handWristY = (handWristTop + handWristBottom) / 2;

  window.__clip = { cut, hand: hc, theta, wristX, yWrist, handWristX, handWristY, handScale, armLength, midWidth, cuts };
  return { W, H, wristWidth, midWidth, armLength: Math.round(armLength), handScale: +handScale.toFixed(3), skinColour: [mr, mg, mb].map(Math.round) };
}, { forearm: dataUrl(forearmFile), hand: dataUrl(handFile), cuts });
console.log('arm', info);

// Timeline, in seconds: empty view, the arm arrives, it holds, cuts are drawn, it leaves, empty view.
const T = { arrive: 2.5, settle: 4.2, cutA: 6.4, cutB: 8.0, leave: 15.0, gone: 16.6, end: 18.0 };
const frames = Math.round(T.end * fps);

const ffmpegArgs = [
  '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${out}.mp4`,
  '-c:v', 'mjpeg', '-q:v', '6', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg', `${out}.mjpeg`,
];
const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

for (let f = 0; f < frames; f++) {
  const jpeg = await page.evaluate(({ t, T }) => {
    const c = window.__clip;
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    const easeIn = (x) => Math.pow(Math.min(1, Math.max(0, x)), 3);

    // A dark table, seen from a head that is never quite still.
    const camX = Math.sin(t * 0.37) * 7 + Math.sin(t * 1.9) * 1.4;
    const camY = Math.cos(t * 0.29) * 5 + Math.sin(t * 2.4) * 1.1;
    const camRoll = Math.sin(t * 0.21) * 0.012;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, '#34414a');
    bg.addColorStop(0.6, '#222c33');
    bg.addColorStop(1, '#12181d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2 + camX, H / 2 + camY);
    ctx.rotate(camRoll);
    ctx.translate(-W / 2, -H / 2);
    // Grain in the table top, so the background visibly moves with the head.
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#0b0f12';
    ctx.lineWidth = 3;
    for (let i = -2; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(-100, i * 60);
      ctx.bezierCurveTo(300, i * 60 + 25, 900, i * 60 - 30, 1400, i * 60 + 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Where the arm is: slides in from the right, holds, slides back out.
    let offset = 0;
    if (t < T.arrive) offset = 1;
    else if (t < T.settle) offset = 1 - ease((t - T.arrive) / (T.settle - T.arrive));
    else if (t < T.leave) offset = 0;
    else if (t < T.gone) offset = easeIn((t - T.leave) / (T.gone - T.leave));
    else offset = 1;
    if (offset < 1) {
      const scale = 0.64;
      const wristScreenX = 548 + offset * 1350;
      const wristScreenY = 392 + offset * 40;
      const armAngle = -0.05 + offset * 0.12;

      const placeArm = () => {
        ctx.translate(wristScreenX, wristScreenY);
        ctx.rotate(armAngle);
        ctx.scale(scale, scale);
      };
      const drawArm = () => {
        // Hand first (fingers toward -x), then the forearm over it (toward +x), feathered at the wrist.
        ctx.save();
        ctx.scale(-c.handScale, c.handScale);
        ctx.drawImage(c.hand, -c.handWristX, -c.handWristY);
        ctx.restore();
        ctx.save();
        ctx.rotate(-c.theta);
        ctx.translate(-c.wristX, -c.yWrist);
        ctx.drawImage(c.cut, 0, 0);
        ctx.restore();
      };

      // Soft shadow on the table.
      ctx.save();
      ctx.translate(14, 18);
      placeArm();
      ctx.filter = 'blur(14px) brightness(0)';
      ctx.globalAlpha = 0.45;
      drawArm();
      ctx.restore();

      ctx.save();
      placeArm();
      drawArm();

      // Red marker cuts, in arm coordinates (photo pixels from the wrist, +x toward the elbow).
      const mm = c.midWidth / 65;
      const strokes = c.cuts >= 2 ? [
        { at: T.cutA, pts: [[0.33, -0.03], [0.4, -0.04], [0.47, -0.02], [0.52, 0.01]], width: 1.6 },
        { at: T.cutB, pts: [[0.66, 0.1], [0.7, 0.03], [0.74, -0.05]], width: 1.6 },
      ] : [];
      for (const s of strokes) {
        const shown = Math.min(1, Math.max(0, (t - s.at) / 0.8));
        if (shown <= 0) continue;
        const points = s.pts.map(([fx, fy]) => [fx * c.armLength, fy * c.midWidth]);
        let total = 0;
        for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([shown * total, total + 10]);
        const path = new Path2D();
        path.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length - 1; i++) {
          const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
          path.quadraticCurveTo(points[i][0], points[i][1], mx, my);
        }
        path.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
        // Marker ink: absorbed into the skin (multiply), with a denser core.
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = 'rgba(228, 30, 48, 0.92)';
        ctx.lineWidth = s.width * mm;
        ctx.stroke(path);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(196, 14, 34, 0.35)';
        ctx.lineWidth = s.width * mm * 0.6;
        ctx.stroke(path);
        ctx.restore();
      }
      ctx.restore();
    }

    // Sensor noise and a touch of softness, like a real camera.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const noise = ctx.getImageData(0, 0, W, H);
    const nd = noise.data;
    let seed = Math.floor(t * 1000) + 1;
    for (let i = 0; i < nd.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = ((seed >> 8) & 15) - 7;
      nd[i] += v; nd[i + 1] += v; nd[i + 2] += v;
    }
    ctx.putImageData(noise, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.93).split(',')[1];
  }, { t: f / fps, T });
  if (!ffmpeg.stdin.write(Buffer.from(jpeg, 'base64'))) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
}
ffmpeg.stdin.end();
await new Promise((resolve) => ffmpeg.on('close', resolve));
await browser.close();
console.log(`wrote ${out}.mp4 and ${out}.mjpeg (${frames} frames, ${T.end} s): empty until ${T.arrive} s, arm settled at ${T.settle} s` +
  (cuts >= 2 ? `, cuts drawn at ${T.cutA} s and ${T.cutB} s` : '') + `, leaves at ${T.leave} s, gone by ${T.gone} s`);
