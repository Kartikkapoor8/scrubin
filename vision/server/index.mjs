// VIPER Vision server. One process, one port, bound to this Mac only:
//   /api/config         what is configured (never any secret)
//   /api/stream         the HoloLens point-of-view stream, relayed (see relay.mjs)
//   /api/stream/probe   is the headset reachable and are the credentials right?
//   /api/gemini-token   a short-lived token for Gemini Live (the API key stays here)
//   everything else     the app: Vite dev server with --dev, the built files in dist/ otherwise
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { currentConfig, VISION_ROOT } from './env.mjs';
import { createRecorder } from './recorder.mjs';
import { createRelay } from './relay.mjs';
import { createRemote } from './remote.mjs';

const DEV = process.argv.includes('--dev');
const config = currentConfig();
// The phone remote is the one thing other devices may reach. VISION_REMOTE=0 keeps the server to this Mac only.
// Read at start-up (shell or vision/.env.local); changing it needs a restart.
const REMOTE_ON = config.remote.enabled;
const recorder = createRecorder(path.join(VISION_ROOT, 'media'));
const relay = createRelay(() => currentConfig().hololens, recorder);

let gemini = null;
try {
  const mod = await import('./gemini.mjs');
  gemini = mod.createGemini(() => currentConfig().gemini);
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') console.warn('[gemini] disabled:', err.message);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.binarypb': 'application/octet-stream',
};

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Only this machine may talk to the server: it holds credentials and relays a private camera view.
function isLocal(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Serves a file with range support, so recorded clips in vision/media can be scrubbed and looped.
function sendFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: 'not_found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1,
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(root, relative) {
  const target = path.resolve(root, '.' + path.posix.normalize('/' + relative));
  return target.startsWith(root + path.sep) || target === root ? target : null;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/config') {
    const mediaDir = path.join(VISION_ROOT, 'media');
    let clips = [];
    try {
      // Newest first: key 3 plays the most recent recording.
      clips = fs.readdirSync(mediaDir).filter((f) => /\.(mp4|webm|mov|m4v)$/i.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(mediaDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t).map((x) => x.f);
    } catch { /* no media folder yet */ }
    return json(res, 200, {
      remote: { enabled: remote.enabled, pin: remote.pin, addresses: remote.addresses(config.port) },
      hololens: { configured: relay.status.configured },
      gemini: { configured: Boolean(gemini && gemini.configured), model: gemini ? gemini.model : '' },
      clips,
    });
  }
  if (url.pathname === '/api/stream') return relay.handleStream(req, res, url);
  if (url.pathname === '/api/stream/probe') return json(res, 200, { ...(await relay.probe()), status: relay.status });
  if (url.pathname === '/api/record') return json(res, 200, recorder.status());
  if (url.pathname === '/api/record/start' && req.method === 'POST') {
    return json(res, 200, recorder.start(url.searchParams.get('seconds') || 0));
  }
  if (url.pathname === '/api/record/stop' && req.method === 'POST') return json(res, 200, await recorder.stop());
  if (url.pathname === '/api/gemini-token') {
    if (!gemini) return json(res, 503, { error: 'not_available', detail: 'Gemini support is not built yet.' });
    return gemini.handleToken(req, res);
  }
  return json(res, 404, { error: 'not_found' });
}

let vite = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // The phone remote's page: the only thing served to other devices.
    if (remote.handlePage(req, res, url)) return;
    if (!isLocal(req)) {
      res.writeHead(403);
      return res.end('VIPER Vision only answers requests from this Mac.');
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // Recorded clips dropped into vision/media/ (gitignored) are served at /media/<name>.
    if (url.pathname.startsWith('/media/')) {
      const file = safeJoin(path.join(VISION_ROOT, 'media'), decodeURIComponent(url.pathname.slice('/media/'.length)));
      return file ? sendFile(req, res, file) : json(res, 404, { error: 'not_found' });
    }

    if (vite) return vite.middlewares(req, res, () => json(res, 404, { error: 'not_found' }));

    // VISION_DIST serves another build folder (dev/drills.mjs tests a private build while the app is being edited).
    const dist = process.env.VISION_DIST ? path.resolve(VISION_ROOT, process.env.VISION_DIST) : path.join(VISION_ROOT, 'dist');
    let file = safeJoin(dist, decodeURIComponent(url.pathname));
    if (!file) return json(res, 404, { error: 'not_found' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('No build found. Run "npm run build" first, or use "npm run dev".');
    }
    return sendFile(req, res, file);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) json(res, 500, { error: 'server_error' });
    else res.end();
  }
});

const remote = createRemote(server, REMOTE_ON, config.remote.pin);

if (DEV) {
  // Vite runs inside this server, hot-reload socket included, so the whole app is one port.
  const { createServer } = await import('vite');
  vite = await createServer({ root: VISION_ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
}

// Usually an earlier VIPER Vision (often a forgotten `npm run dev`) is still running: say so, plainly, and stop.
const portTaken = () => {
  console.error(`\n  VIPER Vision could not start: port ${config.port} is already in use, most likely by another VIPER Vision.`);
  console.error(`  Stop that one (Ctrl+C in its terminal, or: kill $(lsof -ti tcp:${config.port} -sTCP:LISTEN)) and start again,`);
  console.error(`  or run this one on another port: VISION_PORT=4748 npm start\n`);
  process.exit(1);
};
// Ask first: on macOS a 127.0.0.1 listener can sit beside an all-interfaces one on the same port and quietly
// take localhost away from it, so the listen error below does not catch every case.
try {
  await fetch(`http://127.0.0.1:${config.port}/`, { signal: AbortSignal.timeout(700) });
  portTaken();
} catch { /* nothing answering there: good */ }
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') portTaken();
  throw err;
});

server.listen(config.port, REMOTE_ON ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`\n  VIPER Vision  ${DEV ? '(dev)' : ''}  http://localhost:${config.port}\n`);
  console.log(`  HoloLens stream : ${relay.status.configured ? 'configured' : 'not configured yet (add vision/.env.local; it is picked up without a restart)'}`);
  console.log(`  Gemini attending: ${gemini && gemini.configured ? 'configured' : 'not configured'}`);
  if (REMOTE_ON) {
    console.log(`  Phone remote    : PIN ${remote.pin}  (same Wi-Fi; only this page is reachable from other devices)`);
    for (const address of remote.addresses(config.port)) console.log(`                    ${address}`);
  } else {
    console.log('  Phone remote    : off (VISION_REMOTE=0)');
  }
  console.log('');
});
