// A stand-in for the HoloLens Device Portal, for building and testing the relay with no headset.
// It behaves like the real thing in the ways that matter: HTTPS with a self-signed certificate, basic auth,
// and an endless fragmented-MP4 live stream at /api/holographic/stream/live_<quality>.mp4.
//
//   node dev/mock-hololens.mjs [--clip path/to/video.mp4] [--port 8443] [--drop-after 12]
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
if (!clip) {
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
  console.log(`[mock] clip: ${clip}${DROP_AFTER ? `, dropping every ${DROP_AFTER}s` : ''}`);
});
