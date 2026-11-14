// VIPER Vision server. One process, one port, bound to this Mac only:
//   /api/config         what is configured (never any secret)
//   /api/stream         the HoloLens point-of-view stream, relayed (see relay.mjs)
//   /api/stream/probe   is the headset reachable and are the credentials right?
//   /api/gemini-token   a short-lived token for Gemini Live (the API key stays here)
//   everything else     the app: Vite dev server with --dev, the built files in dist/ otherwise
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, maskIp, VISION_ROOT } from './env.mjs';
import { createRelay } from './relay.mjs';

const DEV = process.argv.includes('--dev');
const config = loadEnv();
const relay = createRelay(config);

let gemini = null;
try {
  const mod = await import('./gemini.mjs');
  gemini = mod.createGemini(config);
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
      clips = fs.readdirSync(mediaDir).filter((f) => /\.(mp4|webm|mov|m4v)$/i.test(f)).sort();
    } catch { /* no media folder yet */ }
    return json(res, 200, {
      hololens: { configured: relay.status.configured, target: maskIp(config.hololens.ip) },
      gemini: { configured: Boolean(gemini && gemini.configured), model: gemini ? gemini.model : '' },
      clips,
    });
  }
  if (url.pathname === '/api/stream') return relay.handleStream(req, res, url);
  if (url.pathname === '/api/stream/probe') return json(res, 200, { ...(await relay.probe()), status: relay.status });
  if (url.pathname === '/api/gemini-token') {
    if (!gemini) return json(res, 503, { error: 'not_available', detail: 'Gemini support is not built yet.' });
    return gemini.handleToken(req, res);
  }
  return json(res, 404, { error: 'not_found' });
}

let vite = null;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: VISION_ROOT, server: { middlewareMode: true }, appType: 'spa' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isLocal(req)) {
      res.writeHead(403);
      return res.end('VIPER Vision only answers requests from this Mac.');
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // Recorded clips dropped into vision/media/ (gitignored) are served at /media/<name>.
    if (url.pathname.startsWith('/media/')) {
      const file = safeJoin(path.join(VISION_ROOT, 'media'), decodeURIComponent(url.pathname.slice('/media/'.length)));
      return file ? sendFile(req, res, file) : json(res, 404, { error: 'not_found' });
    }

    if (vite) return vite.middlewares(req, res, () => json(res, 404, { error: 'not_found' }));

    const dist = path.join(VISION_ROOT, 'dist');
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

server.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  VIPER Vision  ${DEV ? '(dev)' : ''}  http://localhost:${config.port}\n`);
  console.log(`  HoloLens stream : ${relay.status.configured ? 'configured for ' + maskIp(config.hololens.ip) : 'not configured (webcam, video file and simulated arm still work)'}`);
  console.log(`  Gemini attending: ${gemini && gemini.configured ? 'configured' : 'not configured'}\n`);
});
