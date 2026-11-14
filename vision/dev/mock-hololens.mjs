// A stand-in for the HoloLens Device Portal, for building and testing the relay with no headset.
// It behaves like the real thing in the ways that matter: HTTPS with a self-signed certificate, basic auth,
// and an endless fragmented-MP4 live stream at /api/holographic/stream/live_<quality>.mp4.
//
//   node dev/mock-hololens.mjs [--clip path/to/video.mp4] [--port 8443] [--drop-after 12]
//   node dev/mock-hololens.mjs --raw ../captures/mrc-live-sample.mp4 [--loop]
//
// --raw FILE replays bytes captured from a real headset's live stream exactly as they were sent (nothing is
// re-encoded): the start of the file at once, then each fragment at the moment it was originally produced.
// Without --loop the stream ends where the capture ended, cut-off last fragment included, which is also a
// dropped-connection test. With --loop it carries on for ever: complete fragments repeat with their
// timestamps moved forward, so a player sees one continuous live stream. It prints what the file contains.
//
// Then run VIPER Vision against it:
//   HOLOLENS_IP=127.0.0.1 HOLOLENS_PORT=8443 HOLOLENS_USER=dev HOLOLENS_PASS=dev npm run dev
//
// --drop-after N ends every stream after N seconds, to rehearse a dropped connection.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', '8443'));
const DROP_AFTER = Number(arg('drop-after', '0'));
const USER = 'dev';
const PASS = 'dev';
let clip = arg('clip', '');

const certDir = path.join(here, '.cert');
const keyFile = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');
if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
  fs.mkdirSync(certDir, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile,
    '-days', '30', '-subj', '/CN=mock-hololens'], { stdio: 'ignore' });
}

// No clip given: make a small moving test picture once (a skin-coloured band with a green marker line).
if (!clip && !process.argv.includes('--raw')) {
  clip = path.join(here, 'media', 'test-arm.mp4');
  if (!fs.existsSync(clip)) {
    fs.mkdirSync(path.dirname(clip), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x1b3340:s=1280x720:r=30:d=12',
      '-f', 'lavfi', '-i', 'color=c=0xd2a283:s=760x190:r=30:d=12',
      '-f', 'lavfi', '-i', 'color=c=0x2ed65c:s=101x5:r=30:d=12',
      '-filter_complex',
      "[0][1]overlay=x='260+24*sin(2*PI*t/6)':y='265+12*cos(2*PI*t/4)'[a];[a][2]overlay=x='590+24*sin(2*PI*t/6)':y='358+12*cos(2*PI*t/4)',noise=alls=6:allf=t",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', clip]);
  }
}

// ---------------------------------------------------------------------------------------------------
// Raw replay of a captured live stream.

const RAW = arg('raw', '');
const RAW_LOOP = process.argv.includes('--loop');
const RAW_SECONDS = Number(arg('raw-seconds', '10'));

function* boxesIn(buf, start, end) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) size = end - off;
    if (size < header) return;
    yield { type, start: off, body: off + header, end: off + size, complete: off + size <= end };
    if (off + size > end) return;
    off += size;
  }
}
const child = (buf, box, type) => {
  for (const c of boxesIn(buf, box.body, box.end)) if (c.type === type && c.complete) return c;
  return null;
};

function loadRaw(file) {
  const buf = fs.readFileSync(file);
  const top = [...boxesIn(buf, 0, buf.length)];
  const firstMoof = top.findIndex((b) => b.type === 'moof');
  const moov = top.find((b) => b.type === 'moov' && b.complete);
  const tracks = new Map();
  if (moov) {
    for (const trak of boxesIn(buf, moov.body, moov.end)) {
      if (trak.type !== 'trak') continue;
      const tkhd = child(buf, trak, 'tkhd');
      const mdia = child(buf, trak, 'mdia');
      const mdhd = mdia && child(buf, mdia, 'mdhd');
      const hdlr = mdia && child(buf, mdia, 'hdlr');
      if (!tkhd || !mdhd) continue;
      const id = buf.readUInt32BE(tkhd.body + (buf[tkhd.body] === 1 ? 20 : 12));
      const timescale = buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12));
      tracks.set(id, { id, timescale, handler: hdlr ? buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) : '????' });
    }
  }
  const initEnd = firstMoof >= 0 ? top[firstMoof].start : buf.length;
  const fragments = [];
  let tail = null;
  for (let i = Math.max(0, firstMoof); firstMoof >= 0 && i < top.length; i++) {
    const box = top[i];
    if (box.type === 'moof' && box.complete) {
      // Everything up to the next moof travels with this one.
      let end = box.end;
      let whole = true;
      let j = i + 1;
      for (; j < top.length && top[j].type !== 'moof'; j++) {
        if (!top[j].complete) { whole = false; break; }
        end = top[j].end;
      }
      const times = [];
      for (const traf of boxesIn(buf, box.body, box.end)) {
        if (traf.type !== 'traf') continue;
        const tfhd = child(buf, traf, 'tfhd');
        const tfdt = child(buf, traf, 'tfdt');
        if (!tfhd || !tfdt) continue;
        const wide = buf[tfdt.body] === 1;
        // Some writers address the pictures from the start of the whole stream (tfhd "base data offset").
        const based = (buf.readUInt32BE(tfhd.body) & 1) === 1;
        times.push({
          baseAt: based ? tfhd.body + 8 - box.start : -1,
          base: based ? Number(buf.readBigUInt64BE(tfhd.body + 8)) : 0,
          track: buf.readUInt32BE(tfhd.body + 4),
          at: tfdt.body + 4 - box.start,
          wide,
          value: wide ? Number(buf.readBigUInt64BE(tfdt.body + 4)) : buf.readUInt32BE(tfdt.body + 4),
        });
      }
      const mfhd = child(buf, box, 'mfhd');
      if (!whole) { tail = buf.subarray(box.start); break; }
      fragments.push({ bytes: buf.subarray(box.start, end), times, sequenceAt: mfhd ? mfhd.body + 4 - box.start : -1 });
      i = j - 1;
    } else if (!box.complete) {
      tail = buf.subarray(box.start);
      break;
    }
  }
  // When each fragment was produced, in seconds from the first, by the video track's clock.
  const video = [...tracks.values()].find((tr) => tr.handler === 'vide') || [...tracks.values()][0];
  const clock = (fragment) => {
    const time = fragment.times.find((tm) => video && tm.track === video.id) || fragment.times[0];
    const scale = (time && tracks.get(time.track)?.timescale) || 0;
    return time && scale ? time.value / scale : NaN;
  };
  const first = fragments.length ? clock(fragments[0]) : NaN;
  const timed = fragments.length > 1 && fragments.every((fr) => Number.isFinite(clock(fr)));
  fragments.forEach((fr, i) => { fr.at = timed ? clock(fr) - first : (i * RAW_SECONDS) / Math.max(1, fragments.length); });
  const step = fragments.length > 1 ? fragments[fragments.length - 1].at / (fragments.length - 1) : 0.1;
  const seconds = fragments.length ? fragments[fragments.length - 1].at + step : 0;

  console.log(`[mock] raw capture: ${file} (${(buf.length / 1048576).toFixed(2)} MB)`);
  console.log(`[mock]   top-level boxes: ${top.slice(0, 12).map((b) => b.type).join(' ')}${top.length > 12 ? ' ...' : ''}`);
  for (const tr of tracks.values()) console.log(`[mock]   track ${tr.id}: ${tr.handler}, timescale ${tr.timescale}`);
  console.log(`[mock]   ${fragments.length} complete fragments over ${seconds.toFixed(2)} s`
    + ` (${(step * 1000).toFixed(0)} ms each, ${timed ? 'timed by their own clock' : 'no usable clock: spread evenly'}),`
    + ` start of file before the first fragment: ${initEnd} bytes${tail ? `, cut-off tail: ${tail.length} bytes` : ''}`);
  if (!moov) console.log('[mock]   WARNING: no complete moov box before the first fragment. A player cannot start from this file.');
  const loopBytes = fragments.reduce((sum, fr) => sum + fr.bytes.length, 0);
  if (fragments.some((fr) => fr.times.some((tm) => tm.baseAt >= 0))) {
    console.log('[mock]   fragments address their data from the start of the stream (base data offset): browsers\' Media Source players refuse this');
  }
  return { init: buf.subarray(0, initEnd), fragments, tail, seconds, tracks, loopBytes };
}

const raw = RAW ? loadRaw(path.resolve(RAW)) : null;

function serveRaw(req, res) {
  res.write(raw.init);
  let index = 0;
  let loop = 0;
  let timer = null;
  const started = Date.now();
  const total = raw.fragments.length;
  const sendNext = () => {
    if (res.destroyed) return;
    if (index >= total) {
      if (!RAW_LOOP || total === 0) {
        if (raw.tail) res.write(raw.tail);
        console.log('[mock] end of the capture: closing the stream');
        return res.end();
      }
      index = 0;
      loop += 1;
    }
    const fragment = raw.fragments[index];
    let bytes = fragment.bytes;
    if (loop > 0) {
      // Same pictures again, later on the clock: move every track's decode time on by whole capture lengths.
      bytes = Buffer.from(bytes);
      for (const time of fragment.times) {
        const scale = raw.tracks.get(time.track)?.timescale || 0;
        const shifted = time.value + Math.round(loop * raw.seconds * scale);
        if (time.wide) bytes.writeBigUInt64BE(BigInt(shifted), time.at);
        else bytes.writeUInt32BE(shifted >>> 0, time.at);
        if (time.baseAt >= 0) bytes.writeBigUInt64BE(BigInt(time.base + loop * raw.loopBytes), time.baseAt);
      }
      if (fragment.sequenceAt >= 0) bytes.writeUInt32BE((bytes.readUInt32BE(fragment.sequenceAt) + loop * total) >>> 0, fragment.sequenceAt);
    }
    res.write(bytes);
    index += 1;
    const due = started + (loop * raw.seconds + (index < total ? raw.fragments[index].at : raw.seconds)) * 1000;
    timer = setTimeout(sendNext, Math.max(0, due - Date.now()));
  };
  timer = setTimeout(sendNext, 0);
  const stop = () => clearTimeout(timer);
  req.on('close', stop);
  res.on('close', stop);
}

const authorized = (req) => req.headers.authorization === 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Windows Device Portal"' });
    return res.end();
  }
  const url = new URL(req.url, 'https://mock');
  if (url.pathname === '/api/os/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ComputerName: 'MOCK-HOLOLENS', OsEdition: 'Holographic' }));
  }
  if (/^\/api\/holographic\/stream\/live(_high|_med|_low)?\.mp4$/.test(url.pathname)) {
    console.log(`[mock] stream opened ${url.search}`);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-cache' });
    if (raw) return serveRaw(req, res);
    const ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-re', '-stream_loop', '-1', '-i', clip, '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-g', '15', '-r', '30', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration', '100000', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    ffmpeg.stdout.pipe(res);
    const timer = DROP_AFTER > 0 ? setTimeout(() => { console.log('[mock] dropping the stream'); res.destroy(); }, DROP_AFTER * 1000) : null;
    const stop = () => { clearTimeout(timer); ffmpeg.kill('SIGKILL'); };
    req.on('close', stop);
    res.on('close', stop);
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] fake HoloLens Device Portal on https://127.0.0.1:${PORT}  (user "${USER}", password "${PASS}")`);
  if (raw) console.log(`[mock] replaying the raw capture${RAW_LOOP ? ' in a loop' : ' once per connection'}`);
  else console.log(`[mock] clip: ${clip}${DROP_AFTER ? `, dropping every ${DROP_AFTER}s` : ''}`);
});
