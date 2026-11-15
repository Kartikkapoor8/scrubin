// Checks everything the real-headset test depends on, in about ten seconds, and says what to fix.
//
//   node dev/preflight.mjs [--url http://localhost:4747]
//
// It never prints an address, a login, a key or a token: only whether each thing is present and working.
// Run the app first (npm run dev). Exit code 0 when the headset stream is playable.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const at = process.argv.indexOf('--url');
const base = (at > 0 && process.argv[at + 1] ? process.argv[at + 1] : 'http://localhost:4747').replace(/\/$/, '');

// Belt and braces: nothing that looks like an address or a key ever reaches the terminal.
const safe = (text) => String(text ?? '')
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<address>')
  .replace(/AIza[0-9A-Za-z_-]{10,}/g, '<key>')
  .replace(/auth_tokens\/[0-9A-Za-z_-]+/g, '<token>')
  .slice(0, 220);
let trouble = 0;
const line = (mark, label, detail = '') => {
  if (mark === 'FIX') trouble += 1;
  console.log(`${mark.padEnd(4)} ${label}${detail ? `: ${safe(detail)}` : ''}`);
};

const getJson = async (path, init) => {
  const res = await fetch(`${base}${path}`, init);
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, body };
};

// ---- the server and its settings ----
let config;
try {
  config = (await getJson('/api/config')).body;
} catch {
  console.log(`FIX  VIPER Vision is not running at ${base}. Start it: cd vision && npm run dev`);
  process.exit(2);
}
line('ok', 'VIPER Vision is running');
line(config.hololens?.configured ? 'ok' : 'FIX', 'Headset settings',
  config.hololens?.configured ? 'address and user name are set' : 'HOLOLENS_IP / HOLOLENS_USER / HOLOLENS_PASS are missing from vision/.env.local');
line(config.gemini?.configured ? 'ok' : 'FIX', 'Gemini key',
  config.gemini?.configured ? `set; model ${config.gemini.model}` : 'GEMINI_API_KEY is missing from vision/.env.local');
line('ok', 'Phone remote', config.remote?.enabled ? 'on (address and PIN are in the ? help)' : 'off');

const ffmpeg = (() => { try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
line(ffmpeg ? 'ok' : 'note', 'ffmpeg', ffmpeg ? 'found (recording and repackaging work)' : 'not found: recordings are kept unconverted and the stream cannot be repackaged');
line(fs.existsSync('/Applications/Google Chrome.app') ? 'ok' : 'note', 'Google Chrome', fs.existsSync('/Applications/Google Chrome.app') ? 'installed' : 'not in /Applications: open the app in Chrome');

// ---- the headset ----
let streamOk = false;
if (config.hololens?.configured) {
  const probe = (await getJson('/api/stream/probe')).body;
  const why = {
    auth: 'the headset rejected the user name or password',
    unreachable: `the headset is not answering (${probe.detail || 'no reply'}): is it on, awake, on the same network, Device Portal on?`,
    upstream_status: `Device Portal answered ${probe.detail || 'an error'}`,
  }[probe.error] || probe.error || 'unknown';
  line(probe.ok ? 'ok' : 'FIX', 'Headset reachable and login accepted', probe.ok ? '' : why);

  if (probe.ok) {
    // Read a few seconds of each stream preset and say what is in it. The fragment length is the part of the
    // delay the headset itself adds before anything can be shown; the app's lag probe (Shift+Y, headset
    // looking at the screen) measures the whole chain.
    const results = [];
    for (const quality of ['high', 'med', 'low']) {
      const sample = await sampleStream(quality);
      results.push({ quality, ...sample });
      if (sample.failure) { line(quality === 'high' ? 'FIX' : 'note', `live_${quality}`, sample.failure); continue; }
      line('ok', `live_${quality}`, `first bytes after ${sample.firstByte} ms, ${sample.mbps.toFixed(1)} Mbit/s, ${sample.report.summary}`);
      for (const text of sample.report.lines) line('info', `  ${text}`);
    }
    const good = results.filter((r) => !r.failure && r.report.playable);
    streamOk = good.length > 0;
    const main = good.find((r) => r.quality === 'high') || good[0];
    if (!main) {
      const first = results.find((r) => !r.failure);
      if (first) line('FIX', 'Stream format', first.report.problem);
    } else if (main.report.needsRepack) {
      line(ffmpeg ? 'ok' : 'note', 'Playback route', ffmpeg
        ? 'Chrome\'s low-latency player will refuse this as sent; the relay repackages it automatically (still about 0.1 s behind)'
        : 'Chrome\'s low-latency player will refuse this and ffmpeg is missing: the slower route (about 0.6 s behind) will be used');
    } else {
      line('ok', 'Playback route', 'low-latency, as sent');
    }
    const timed = good.filter((r) => r.report.fragmentMs > 0).sort((a, b) => a.report.fragmentMs - b.report.fragmentMs);
    if (timed.length > 1) {
      line('info', `Shortest fragments: live_${timed[0].quality} (${timed[0].report.fragmentMs} ms). In the app, Shift+Y with the headset looking at the screen measures each preset end to end and keeps the fastest.`);
    }
  }
}

/** A few seconds of one stream preset through the relay: when the first bytes came, the bit rate, what is in it. */
async function sampleStream(quality) {
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 7000);
  const chunks = [];
  let total = 0;
  let firstByte = -1;
  let failure = '';
  try {
    const res = await fetch(`${base}/api/stream?q=${quality}`, { signal: abort.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      failure = body.detail || `the relay answered ${res.status}`;
    } else {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (firstByte < 0) firstByte = Date.now() - started;
        chunks.push(Buffer.from(value));
        total += value.length;
        if (total > 3_000_000 || Date.now() - started > 5000) { abort.abort(); break; }
      }
    }
  } catch (err) {
    if (total === 0) failure = err.name === 'AbortError' ? 'no video arrived in 7 s (is something else already pulling the stream?)' : err.message;
  }
  clearTimeout(timer);
  // The headset serves one capture at a time: give it a moment to let go before the next preset.
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (failure) return { failure };
  const seconds = (Date.now() - started - Math.max(0, firstByte)) / 1000;
  return { failure: '', firstByte, mbps: (total / 1048576 / Math.max(0.5, seconds)) * 8, report: describe(Buffer.concat(chunks)) };
}

// ---- Gemini ----
if (config.gemini?.configured) {
  const token = await getJson('/api/gemini-token', { method: 'POST' }).catch((err) => ({ ok: false, status: 0, body: { error: err.message } }));
  line(token.ok ? 'ok' : 'FIX', 'Gemini token', token.ok ? 'issued (not shown). Next: node dev/ask.mjs'
    : `${token.body.error || ''} ${token.body.detail || ''} (HTTP ${token.status})`.trim());
}

console.log(trouble === 0 ? '\nReady.' : `\n${trouble} thing(s) to fix.`);
process.exit(config.hololens?.configured && streamOk ? 0 : 1);

// ---------------------------------------------------------------------------------------------------
// What is in the first few seconds of an MP4 live stream.
function describe(buf) {
  const lines = [];
  function* boxes(start, end) {
    let off = start;
    while (off + 8 <= end) {
      let size = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      let header = 8;
      if (size === 1) { if (off + 16 > end) return; size = Number(buf.readBigUInt64BE(off + 8)); header = 16; }
      else if (size === 0) size = end - off;
      if (size < header) return;
      yield { type, start: off, body: off + header, end: Math.min(end, off + size), complete: off + size <= end };
      if (off + size > end) return;
      off += size;
    }
  }
  const child = (box, type) => { for (const c of boxes(box.body, box.end)) if (c.type === type) return c; return null; };
  const top = [...boxes(0, buf.length)];
  lines.push(`boxes: ${top.slice(0, 10).map((b) => b.type).join(' ')}${top.length > 10 ? ' ...' : ''}`);
  const moov = top.find((b) => b.type === 'moov' && b.complete);
  if (!moov) return { lines, playable: false, needsRepack: false, problem: 'no complete moov box at the start: this is not a fragmented MP4 a browser can start from', fragmentMs: 0, summary: 'no moov' };

  const tracks = new Map();
  for (const trak of boxes(moov.body, moov.end)) {
    if (trak.type !== 'trak') continue;
    const tkhd = child(trak, 'tkhd');
    const mdia = child(trak, 'mdia');
    const mdhd = mdia && child(mdia, 'mdhd');
    const hdlr = mdia && child(mdia, 'hdlr');
    if (!tkhd || !mdhd) continue;
    const id = buf.readUInt32BE(tkhd.body + (buf[tkhd.body] === 1 ? 20 : 12));
    const timescale = buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12));
    const handler = hdlr ? buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) : '????';
    const width = buf.readUInt32BE(tkhd.end - 8) >>> 16;
    const height = buf.readUInt32BE(tkhd.end - 4) >>> 16;
    let codec = '';
    const avcC = buf.indexOf('avcC', trak.start, 'latin1');
    if (handler === 'vide' && avcC > 0 && avcC < trak.end) {
      const hex = (n) => n.toString(16).padStart(2, '0');
      const profile = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High' }[buf[avcC + 5]] || `profile ${buf[avcC + 5]}`;
      codec = `H.264 ${profile} level ${(buf[avcC + 7] / 10).toFixed(1)} (avc1.${hex(buf[avcC + 5])}${hex(buf[avcC + 6])}${hex(buf[avcC + 7])})`;
    } else if (handler === 'vide') {
      codec = buf.indexOf('hvcC', trak.start, 'latin1') > 0 ? 'H.265 (Chrome may not play this)' : 'unknown video codec';
    } else if (handler === 'soun') {
      codec = buf.indexOf('mp4a', trak.start, 'latin1') > 0 ? 'AAC audio' : 'audio';
    }
    tracks.set(id, { timescale, handler, size: handler === 'vide' ? `${width}x${height}` : '' });
    lines.push(`track ${id}: ${handler === 'vide' ? `video ${width}x${height}, ${codec}` : codec || handler}, timescale ${timescale}`);
  }
  const video = [...tracks.entries()].find(([, tr]) => tr.handler === 'vide');
  let fragmentMs = 0;
  const size = video ? video[1].size : '';
  if (!video) return { lines, playable: false, needsRepack: false, problem: 'the stream has no video track', fragmentMs: 0, summary: 'no video' };

  let based = false;
  let noClock = false;
  const times = [];
  const moofs = top.filter((b) => b.type === 'moof' && b.complete);
  for (const moof of moofs) {
    for (const traf of boxes(moof.body, moof.end)) {
      if (traf.type !== 'traf') continue;
      const tfhd = child(traf, 'tfhd');
      if (!tfhd) continue;
      if (buf.readUInt32BE(tfhd.body) & 1) based = true;
      if (buf.readUInt32BE(tfhd.body + 4) !== video[0]) continue;
      const tfdt = child(traf, 'tfdt');
      if (!tfdt) { noClock = true; continue; }
      times.push(buf[tfdt.body] === 1 ? Number(buf.readBigUInt64BE(tfdt.body + 4)) : buf.readUInt32BE(tfdt.body + 4));
    }
  }
  if (moofs.length === 0) {
    lines.push('no fragments arrived yet in the sample');
  } else {
    const each = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) / video[1].timescale : 0;
    lines.push(`${moofs.length} fragments${each > 0 ? `, ${(each * 1000).toFixed(0)} ms each` : ''}`
      + `${times.length ? `, clock starts at ${(times[0] / video[1].timescale).toFixed(2)} s` : ''}`
      + `${noClock ? ', no decode times (tfdt)' : ''}`
      + `, data addressed ${based ? 'from the start of the stream (base data offset)' : 'from each fragment'}`);
    if (each > 0.6) lines.push(`long fragments: expect about ${each.toFixed(1)} s of extra delay on every route`);
    fragmentMs = Math.round(each * 1000);
  }
  return { lines, playable: true, needsRepack: based, problem: '', fragmentMs, summary: `${size}${fragmentMs ? `, ${fragmentMs} ms fragments` : ''}` };
}
