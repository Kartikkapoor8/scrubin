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
import https from 'node:https';
import { maskIp } from './env.mjs';

const QUALITIES = new Set(['high', 'med', 'low']);
const CONNECT_TIMEOUT_MS = 6000;
const STALL_TIMEOUT_MS = 5000;

export function createRelay(config) {
  const hl = config.hololens;
  const status = {
    configured: Boolean(hl.ip && hl.user),
    target: maskIp(hl.ip),
    state: 'idle', // idle | connecting | streaming | error
    lastError: '',
    connects: 0,
    bytes: 0,
    since: 0,
    certSha256: '',
  };

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

    status.state = 'connecting';
    status.connects += 1;
    let finished = false;
    let stallTimer = null;

    const upstream = https.request({
      host: hl.ip,
      port: hl.port,
      path,
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${hl.user}:${hl.pass}`).toString('base64'),
        Accept: '*/*',
      },
      // The headset's certificate is self-signed. Accept it for this one host only.
      rejectUnauthorized: false,
      agent: false,
      timeout: CONNECT_TIMEOUT_MS,
    });

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(stallTimer);
      upstream.destroy();
      if (status.state === 'streaming' || status.state === 'connecting') status.state = 'idle';
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
      const code = err.message === 'timeout' ? 504 : 502;
      const detail =
        err.message === 'timeout' ? 'The headset did not answer. Is it on, awake and on the same network?'
        : err.message === 'certificate_mismatch' ? 'The headset certificate does not match the pinned one.'
        : ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)
          ? 'The headset is not answering on the network'
          : `Could not reach the headset (${err.code || err.message})`;
      finished = true;
      clearTimeout(stallTimer);
      fail(res, code, 'unreachable', detail);
    });

    upstream.on('response', (up) => {
      if (up.statusCode !== 200) {
        const detail =
          up.statusCode === 401 || up.statusCode === 403
            ? 'The headset rejected the user name or password.'
            : `The headset answered ${up.statusCode}. Is Device Portal on and is another capture already running?`;
        up.resume();
        finished = true;
        fail(res, 502, up.statusCode === 401 || up.statusCode === 403 ? 'auth' : 'upstream_status', detail);
        return;
      }

      status.state = 'streaming';
      status.lastError = '';
      status.since = Date.now();
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'close',
      });
      if (res.socket) res.socket.setNoDelay(true);

      armStallTimer();
      up.on('data', (chunk) => {
        status.bytes += chunk.length;
        armStallTimer();
        // Forward immediately. If the page falls behind, pause the headset side rather than buffer here.
        if (!res.write(chunk)) {
          up.pause();
          res.once('drain', () => up.resume());
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
      if (!status.configured) return resolve({ ok: false, error: 'not_configured' });
      const request = https.request(
        {
          host: hl.ip,
          port: hl.port,
          path: '/api/os/info',
          method: 'GET',
          headers: { Authorization: 'Basic ' + Buffer.from(`${hl.user}:${hl.pass}`).toString('base64') },
          rejectUnauthorized: false,
          agent: false,
          timeout: 3000,
        },
        (up) => {
          up.resume();
          if (up.statusCode === 200) resolve({ ok: true });
          else if (up.statusCode === 401 || up.statusCode === 403) resolve({ ok: false, error: 'auth' });
          else resolve({ ok: false, error: 'upstream_status', detail: String(up.statusCode) });
        },
      );
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (err) => resolve({ ok: false, error: 'unreachable', detail: err.code || err.message }));
      request.end();
    });
  }

  return { status, handleStream, probe };
}
