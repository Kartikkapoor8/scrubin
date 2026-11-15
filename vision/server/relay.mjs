// Relay for the HoloLens point-of-view stream.
//
// The headset's Device Portal serves a live Mixed Reality Capture stream (holograms + camera) as a
// fragmented MP4 over HTTPS with a self-signed certificate and basic auth:
//   GET https://<ip>/api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false
// (endpoint from Microsoft's Device Portal API reference; also used by tools/spectate.ps1).
//
// A browser page cannot fetch that directly (certificate warning, credentials, cross-origin), so this relay
// logs in on the server and passes the bytes straight through to the local page. Rules it keeps:
//   - The credentials never leave the server.
//   - The self-signed certificate is accepted for the configured headset IP only, per request. TLS
//     verification is never switched off globally. Optionally the certificate can be pinned.
//   - Bytes are forwarded as they arrive (no buffering, Nagle off) to add as little delay as possible.
//   - A stalled or dropped upstream ends the response quickly so the page can reconnect.
import http from 'node:http';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';

const QUALITIES = new Set(['high', 'med', 'low']);
// How long the repackager may take to produce its first bytes before the request is given up on.
const REPACK_START_MS = 5000;

// ffmpeg, if this Mac has it. It is only ever used to repackage the headset's video (same pictures, never
// re-encoded) into the plainest fragmented MP4, for a browser that refuses the stream as the headset sends it.
let ffmpegFound = null;
function hasFfmpeg() {
  if (ffmpegFound === null) {
    try { ffmpegFound = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { ffmpegFound = false; }
  }
  return ffmpegFound;
}
const CONNECT_TIMEOUT_MS = 6000;
// A headset that has gone quiet (Wi-Fi lost without a goodbye) is given up on after this long, then retried.
const STALL_TIMEOUT_MS = 3500;

/**
 * @param getHeadset  returns the current headset settings ({ ip, user, pass, port, certSha256 }); read on
 *                    every request, so they can be added or corrected while the server runs.
 * @param recorder    optional: every forwarded byte is also offered to it (see recorder.mjs).
 */
export function createRelay(getHeadset, recorder = null) {
  let warnedPlain = false;
  const status = {
    get configured() {
      const hl = getHeadset();
      return Boolean(hl.ip && hl.user);
    },
    state: 'idle', // idle | connecting | streaming | error
    /** Streams being relayed right now (the headset serves one at a time: preflight checks this first). */
    active: 0,
    lastError: '',
    connects: 0,
    bytes: 0,
    since: 0,
    certSha256: '',
    legacyTls: false,
  };

  // HoloLens 1 runs a 2016-era Windows. If it cannot negotiate current TLS, the next attempt allows the
  // older protocol versions and ciphers, for this one host only.
  const tlsOptions = () => (status.legacyTls ? { minVersion: 'TLSv1', ciphers: 'DEFAULT:@SECLEVEL=0' } : {});
  const looksLikeTlsMismatch = (err) =>
    /EPROTO|ERR_SSL|ERR_TLS|wrong version|unsupported protocol|handshake failure|no shared cipher|protocol version|dh key too small/i
      .test(`${err.code || ''} ${err.message || ''}`);

  function fail(res, code, error, detail) {
    status.state = 'error';
    status.lastError = detail || error;
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error, detail: detail || '' }));
    } else {
      res.end();
    }
  }

  function handleStream(req, res, url) {
    const hl = getHeadset();
    if (!status.configured) {
      return fail(res, 503, 'not_configured', 'Set HOLOLENS_IP, HOLOLENS_USER and HOLOLENS_PASS (see .env.example).');
    }

    const quality = QUALITIES.has(url.searchParams.get('q')) ? url.searchParams.get('q') : 'high';
    const flag = (name, fallback) => (url.searchParams.get(name) ?? fallback) === 'true';
    const query = new URLSearchParams({
      holo: String(flag('holo', 'true')),
      pv: String(flag('pv', 'true')),
      mic: String(flag('mic', 'false')),
      loopback: String(flag('loopback', 'false')),
    });
    const path = `/api/holographic/stream/live_${quality}.mp4?${query}`;
    // ?remux=1: pass the stream through ffmpeg on the way (see hasFfmpeg above).
    const repack = url.searchParams.get('remux') === '1';
    if (repack && !hasFfmpeg()) {
      return fail(res, 501, 'no_remux', 'ffmpeg is not installed on this Mac, so the stream cannot be repackaged.');
    }

    status.state = 'connecting';
    status.connects += 1;
    let finished = false;
    let counted = false; // this request is one of status.active
    let stallTimer = null;
    let ticket = null; // this connection's place in the recorder
    let packer = null; // the ffmpeg process, when repackaging
    let packTimer = null;

    // https unless the settings say the headset's Device Portal is serving plain http.
    const secure = hl.scheme !== 'http';
    if (!secure && !warnedPlain) {
      warnedPlain = true;
      console.warn('[relay] the headset is set to plain http: its login crosses the local network unencrypted.');
    }
    const upstream = (secure ? https : http).request({
      host: hl.ip,
      port: hl.port,
      path,
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${hl.user}:${hl.pass}`).toString('base64'),
        Accept: '*/*',
      },
      agent: false,
      timeout: CONNECT_TIMEOUT_MS,
      // The headset's certificate is self-signed. Accept it for this one host only.
      ...(secure ? { rejectUnauthorized: false, ...tlsOptions() } : {}),
    });

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(stallTimer);
      clearTimeout(packTimer);
      if (packer) {
        try { packer.stdin.destroy(); } catch { /* already closed */ }
        packer.kill('SIGKILL');
      }
      if (recorder && ticket) recorder.endStream(ticket);
      upstream.destroy();
      if (counted) { counted = false; status.active = Math.max(0, status.active - 1); }
      if (status.active > 0) status.state = 'streaming';
      else if (status.state === 'streaming' || status.state === 'connecting') status.state = 'idle';
      if (!res.writableEnded) res.end();
    };

    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        status.lastError = 'The headset stopped sending video.';
        finish();
      }, STALL_TIMEOUT_MS);
    };

    upstream.on('socket', (socket) => {
      socket.setNoDelay(true);
      if (!secure) {
        // Plain http: there is no certificate to check.
        upstream.end();
        return;
      }
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate();
        const seen = (cert && cert.fingerprint256 ? cert.fingerprint256 : '').replace(/:/g, '').toUpperCase();
        if (seen && seen !== status.certSha256) {
          status.certSha256 = seen;
          console.log(`[relay] headset certificate SHA-256: ${seen}`);
        }
        if (hl.certSha256 && seen !== hl.certSha256) {
          console.error('[relay] certificate does not match HOLOLENS_CERT_SHA256. Refusing to send credentials.');
          upstream.destroy(new Error('certificate_mismatch'));
          return;
        }
        // Only now is the request (with the Authorization header) written to the wire.
        upstream.end();
      });
    });

    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));

    upstream.on('error', (err) => {
      if (finished) return;
      if (!status.legacyTls && looksLikeTlsMismatch(err)) {
        status.legacyTls = true;
        console.warn(`[relay] TLS handshake with the headset failed (${err.code || err.message}); the next attempt allows older TLS.`);
      }
      const code = err.message === 'timeout' ? 504 : 502;
      const detail =
        err.message === 'timeout' ? 'The headset did not answer. Is it on, awake and on the same network?'
        : err.message === 'certificate_mismatch' ? 'The headset certificate does not match the pinned one.'
        : ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)
          ? 'The headset is not answering on the network'
          : err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN'
            ? 'The headset address in vision/.env.local is not valid: check HOLOLENS_IP'
            : 'The headset could not be reached';
      console.warn(`[relay] headset not reached: ${err.code || err.message}`);
      finished = true;
      clearTimeout(stallTimer);
      fail(res, code, 'unreachable', detail);
    });

    upstream.on('response', (up) => {
      if (up.statusCode !== 200) {
        const detail =
          up.statusCode === 401 || up.statusCode === 403
            ? 'The headset rejected the user name or password.'
            : 'The headset refused the stream. Is Device Portal on, and is something else already showing it?';
        if (up.statusCode !== 401 && up.statusCode !== 403) console.warn(`[relay] the headset answered HTTP ${up.statusCode}`);
        up.resume();
        finished = true;
        fail(res, 502, up.statusCode === 401 || up.statusCode === 403 ? 'auth' : 'upstream_status', detail);
        return;
      }

      status.state = 'streaming';
      status.active += 1;
      counted = true;
      status.lastError = '';
      status.since = Date.now();
      const begin = () => {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-store, no-transform',
          'X-Accel-Buffering': 'no',
          Connection: 'close',
        });
        if (res.socket) res.socket.setNoDelay(true);
      };

      if (repack) {
        // Same video, new wrapping: small fragments addressed the way browsers' low-latency players require.
        packer = spawn('ffmpeg', ['-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay',
          '-probesize', '131072', '-analyzeduration', '0', '-i', 'pipe:0', '-map', '0:v:0', '-c', 'copy',
          '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '100000',
          '-flush_packets', '1', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let complaint = '';
        packer.stderr.on('data', (text) => { complaint = (complaint + text).slice(-400); });
        packer.stdin.on('error', () => { /* ffmpeg went away; its exit ends the request */ });
        packer.on('error', () => finish());
        packer.on('exit', () => {
          if (finished) return;
          if (!res.headersSent) {
            finished = true;
            clearTimeout(stallTimer);
            clearTimeout(packTimer);
            if (recorder && ticket) recorder.endStream(ticket);
            upstream.destroy();
            console.warn(`[relay] could not repackage the stream: ${complaint.trim().split('\n').pop() || 'ffmpeg stopped'}`);
            fail(res, 502, 'remux_failed', 'The stream could not be repackaged.');
          } else {
            finish();
          }
        });
        packer.stdout.on('data', (out) => {
          if (!res.headersSent) { clearTimeout(packTimer); begin(); }
          if (!res.write(out)) {
            packer.stdout.pause();
            res.once('drain', () => packer && packer.stdout.resume());
          }
        });
        packTimer = setTimeout(() => { if (!res.headersSent && packer) packer.kill('SIGKILL'); }, REPACK_START_MS);
      } else {
        begin();
      }

      armStallTimer();
      if (recorder) ticket = recorder.beginStream();
      up.on('data', (chunk) => {
        status.bytes += chunk.length;
        armStallTimer();
        // The recording is always the stream exactly as the headset sent it.
        if (recorder) recorder.feed(ticket, chunk);
        // Forward immediately. If the page falls behind, pause the headset side rather than buffer here.
        const sink = packer ? packer.stdin : res;
        if (!sink.destroyed && !sink.write(chunk)) {
          up.pause();
          sink.once('drain', () => up.resume());
        }
      });
      up.on('end', finish);
      up.on('error', finish);
    });

    req.on('close', finish);
  }

  // A quick authenticated probe, so the page can say why the headset is not available before it tries to play.
  function probe() {
    return new Promise((resolve) => {
      const hl = getHeadset();
      if (!status.configured) return resolve({ ok: false, error: 'not_configured' });
      const secure = hl.scheme !== 'http';
      const request = (secure ? https : http).request(
        {
          host: hl.ip,
          port: hl.port,
          path: '/api/os/info',
          method: 'GET',
          headers: { Authorization: 'Basic ' + Buffer.from(`${hl.user}:${hl.pass}`).toString('base64') },
          agent: false,
          timeout: 3000,
          ...(secure ? { rejectUnauthorized: false, ...tlsOptions() } : {}),
        },
        (up) => {
          up.resume();
          if (up.statusCode === 200) resolve({ ok: true });
          else if (up.statusCode === 401 || up.statusCode === 403) resolve({ ok: false, error: 'auth' });
          else resolve({ ok: false, error: 'upstream_status', detail: String(up.statusCode) });
        },
      );
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (err) => {
        if (!status.legacyTls && looksLikeTlsMismatch(err)) status.legacyTls = true;
        resolve({ ok: false, error: 'unreachable', detail: err.code || err.message });
      });
      request.end();
    });
  }

  return { status, handleStream, probe };
}
