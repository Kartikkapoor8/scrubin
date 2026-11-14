// Records the raw incoming HoloLens stream to vision/media/, exactly as the headset sent it (holograms and
// camera, none of VIPER Vision's overlays). The clip is the backup input for autoplay and footage for the video.
//
// The stream is one endless fragmented MP4: a header (ftyp + moov) once, then fragments (moof + mdat). A
// playable file needs that header followed by whole fragments, so the relay feeds every byte through here:
// the header of the current stream is kept, and a recording starts at the next fragment boundary.
// When a recording stops, ffmpeg (if installed) rewrites the container so the clip starts at zero, seeks and
// loops cleanly, and opens in video editors. Without ffmpeg the raw recording is kept as it is.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function createRecorder(mediaDir) {
  let streaming = false;
  let init = null;          // Buffer: ftyp + moov of the stream being relayed right now
  let initParts = [];
  let collectingInit = true;

  // Where we are in the stream's box structure.
  let header = Buffer.alloc(0);
  let boxRemaining = 0;
  let boxType = '';
  let lostTrack = false;

  let rec = null;           // the recording in progress
  let last = null;          // the last finished recording, for the page to announce
  let current = null;       // identifies the relay connection whose bytes we are following

  /**
   * A new relay connection started. Returns its ticket; feed() and endStream() from any older connection
   * (a reconnect can overlap the one it replaces) are ignored.
   */
  function beginStream() {
    if (rec) void stop('the stream restarted');
    current = Symbol('stream');
    streaming = true;
    init = null;
    initParts = [];
    collectingInit = true;
    header = Buffer.alloc(0);
    boxRemaining = 0;
    boxType = '';
    lostTrack = false;
    return current;
  }

  function endStream(ticket) {
    if (ticket !== current) return;
    streaming = false;
    current = null;
    if (rec) void stop('the stream ended');
  }

  function write(bytes) {
    if (rec && rec.writing) {
      rec.out.write(bytes);
      rec.bytes += bytes.length;
    }
  }

  function onBoxStart(type, headerBytes) {
    if (collectingInit) {
      initParts.push(headerBytes);
    } else if (rec && !rec.writing && type === 'moof' && init) {
      // A fragment starts here: this is where a clean recording can begin.
      rec.writing = true;
      rec.startedAt = Date.now();
      rec.out.write(init);
      rec.bytes += init.length;
      write(headerBytes);
      if (rec.seconds > 0) rec.timer = setTimeout(() => void stop('time is up'), rec.seconds * 1000);
    } else {
      write(headerBytes);
    }
  }

  function onBoxData(bytes) {
    if (collectingInit) initParts.push(bytes);
    else write(bytes);
  }

  function onBoxEnd(type) {
    if (collectingInit && type === 'moov') {
      init = Buffer.concat(initParts);
      initParts = [];
      collectingInit = false;
    }
  }

  /** Every chunk the relay forwards also passes through here. Never throws. */
  function feed(ticket, chunk) {
    if (ticket !== current || lostTrack) return;
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (boxRemaining === 0) {
          // Read the next box header: 8 bytes, or 16 when the size field says "see the 64-bit size".
          const large = header.length >= 8 && header.readUInt32BE(0) === 1;
          const need = (large ? 16 : 8) - header.length;
          const take = Math.min(need, chunk.length - offset);
          header = Buffer.concat([header, chunk.subarray(offset, offset + take)]);
          offset += take;
          if (header.length < 8) break;
          let size = header.readUInt32BE(0);
          if (size === 1) {
            if (header.length < 16) continue;
            size = Number(header.readBigUInt64BE(8));
          }
          boxType = header.toString('latin1', 4, 8);
          if (size < header.length || !/^[\x20-\x7e]{4}$/.test(boxType)) {
            // Not a box structure we understand. Stop following it (the relay itself is unaffected).
            lostTrack = true;
            if (rec) void stop('the stream could not be followed');
            return;
          }
          boxRemaining = size - header.length;
          onBoxStart(boxType, header);
          header = Buffer.alloc(0);
          if (boxRemaining === 0) onBoxEnd(boxType);
          continue;
        }
        const take = Math.min(boxRemaining, chunk.length - offset);
        onBoxData(chunk.subarray(offset, offset + take));
        boxRemaining -= take;
        offset += take;
        if (boxRemaining === 0) onBoxEnd(boxType);
      }
    } catch (err) {
      lostTrack = true;
      console.error('[record] stopped following the stream:', err.message);
      if (rec) void stop('an error');
    }
  }

  function start(seconds = 0) {
    if (rec) return { ok: true, already: true, file: path.basename(rec.file) };
    if (!streaming) return { ok: false, error: 'not_streaming', detail: 'Play the HoloLens stream (input 1) first.' };
    if (lostTrack) return { ok: false, error: 'unsupported', detail: 'This stream cannot be recorded as it arrives.' };
    fs.mkdirSync(mediaDir, { recursive: true });
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
    const file = path.join(mediaDir, `hololens-${stamp}.mp4`);
    const temp = file.replace(/\.mp4$/, '.recording');
    rec = {
      file, temp, out: fs.createWriteStream(temp), writing: false, startedAt: 0, askedAt: Date.now(),
      bytes: 0, seconds: Math.max(0, Number(seconds) || 0), timer: null,
    };
    console.log(`[record] recording to media/${path.basename(file)}${rec.seconds ? ` for ${rec.seconds} s` : ''}`);
    return { ok: true, file: path.basename(file) };
  }

  async function stop(reason = 'stopped') {
    if (!rec) return { ok: false, error: 'not_recording' };
    const done = rec;
    rec = null;
    clearTimeout(done.timer);
    await new Promise((resolve) => done.out.end(resolve));
    const seconds = done.writing ? (Date.now() - done.startedAt) / 1000 : 0;

    if (!done.writing || done.bytes < 20000) {
      fs.rmSync(done.temp, { force: true });
      last = { ok: false, error: 'empty', detail: 'Nothing was recorded (no video arrived).', reason };
      console.log('[record] nothing recorded');
      return last;
    }

    // Rewrite the container so the clip starts at zero and has an index. The video itself is copied untouched.
    const fixed = await new Promise((resolve) => {
      let child;
      try {
        child = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'mp4', '-i', done.temp, '-c', 'copy', '-movflags', '+faststart', done.file],
          { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch {
        return resolve(false);
      }
      let errors = '';
      child.stderr.on('data', (d) => { errors += d; });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => {
        if (code !== 0 && errors) console.warn('[record] ffmpeg:', errors.trim().split('\n')[0]);
        resolve(code === 0 && fs.existsSync(done.file) && fs.statSync(done.file).size > 20000);
      });
    });
    if (fixed) fs.rmSync(done.temp, { force: true });
    else fs.renameSync(done.temp, done.file);

    last = {
      ok: true, file: path.basename(done.file), seconds: Math.round(seconds * 10) / 10,
      megabytes: Math.round(fs.statSync(done.file).size / 1e5) / 10, remuxed: fixed, reason,
    };
    console.log(`[record] saved media/${last.file}: ${last.seconds} s, ${last.megabytes} MB${fixed ? '' : ' (raw: ffmpeg was not available)'}`);
    return last;
  }

  function status() {
    return {
      recording: Boolean(rec),
      waiting: Boolean(rec && !rec.writing),
      file: rec ? path.basename(rec.file) : '',
      seconds: rec && rec.writing ? Math.round((Date.now() - rec.startedAt) / 100) / 10 : 0,
      limit: rec ? rec.seconds : 0,
      canRecord: streaming && !lostTrack,
      last,
    };
  }

  return { beginStream, endStream, feed, start, stop, status };
}
