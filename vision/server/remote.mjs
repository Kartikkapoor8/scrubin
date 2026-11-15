// The phone remote.
//
// At a walk-up table the presenter holds a phone, not the Mac's keyboard: /remote is a page with three big
// buttons (Next, Hold to talk, Reset) that drives VIPER Vision over a WebSocket.
//
// This is the only part of the server reachable from other devices on the network, so it is kept narrow:
//   - Other devices can load the /remote page and open its WebSocket, nothing else. The app, the stream,
//     the API and the settings stay reachable from this Mac only.
//   - The WebSocket needs the PIN shown on the Mac (operator key list, and the server's console).
//   - The phone can only send four small commands; it never receives anything but the step name and status.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const COMMANDS = new Set(['next', 'back', 'reset', 'talk']);
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remote.html');

export function isLocalRequest(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** `fixedPin`: VISION_REMOTE_PIN from the shell or vision/.env.local; otherwise a random PIN at each start. */
export function createRemote(server, enabled, fixedPin = '') {
  const pin = /^\d{4,8}$/.test(fixedPin) ? fixedPin : String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const phones = new Set();
  const apps = new Set();
  let lastState = null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

  const send = (socket, message) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  };
  const tellPhones = (message) => { for (const phone of phones) send(phone, message); };
  const tellApps = (message) => { for (const app of apps) send(app, message); };

  function addApp(socket) {
    apps.add(socket);
    send(socket, { t: 'phones', count: phones.size });
    socket.on('message', (data) => {
      // The app reports where the procedure is; phones show it.
      try {
        const message = JSON.parse(String(data));
        if (message && message.t === 'state') {
          lastState = message;
          tellPhones(message);
        }
      } catch { /* ignore */ }
    });
    socket.on('close', () => apps.delete(socket));
    socket.on('error', () => apps.delete(socket));
  }

  function addPhone(socket) {
    phones.add(socket);
    socket.talking = false;
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    if (lastState) send(socket, lastState);
    send(socket, { t: 'hello', app: apps.size > 0 });
    tellApps({ t: 'phones', count: phones.size });

    socket.on('message', (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (!message || !COMMANDS.has(message.t)) return;
      if (message.t === 'talk') {
        socket.talking = message.on === true;
        tellApps({ t: 'talk', on: socket.talking });
      } else {
        tellApps({ t: message.t });
      }
    });
    const gone = () => {
      phones.delete(socket);
      // A phone that drops while its talk button is down must not leave the microphone open.
      if (socket.talking) tellApps({ t: 'talk', on: false });
      tellApps({ t: 'phones', count: phones.size });
    };
    socket.on('close', gone);
    socket.on('error', gone);
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return; }
    const refuse = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname === '/ws/app') {
      if (!isLocalRequest(req)) return refuse(403, 'Forbidden');
      wss.handleUpgrade(req, socket, head, addApp);
    } else if (url.pathname === '/ws/remote') {
      if (!enabled && !isLocalRequest(req)) return refuse(403, 'Forbidden');
      if (url.searchParams.get('pin') !== pin) return refuse(401, 'Unauthorized');
      wss.handleUpgrade(req, socket, head, addPhone);
    }
    // Any other upgrade (the development server's hot reload) is somebody else's.
  });

  // Phones on Wi-Fi vanish without saying goodbye: drop the ones that stop answering.
  const heartbeat = setInterval(() => {
    for (const phone of phones) {
      if (!phone.alive) { phone.terminate(); continue; }
      phone.alive = false;
      phone.ping();
    }
  }, 15000);
  heartbeat.unref();

  /** Serves the remote page. Returns true if it handled the request. */
  function handlePage(req, res, url) {
    if (url.pathname !== '/remote' && url.pathname !== '/remote/') return false;
    if (!enabled && !isLocalRequest(req)) {
      res.writeHead(403);
      res.end('The phone remote is switched off.');
      return true;
    }
    fs.readFile(PAGE, (err, html) => {
      if (err) {
        res.writeHead(500);
        return res.end('remote page missing');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    });
    return true;
  }

  /** Addresses a phone on the same network can try, the Mac's Bonjour name first. */
  function addresses(port) {
    const out = [];
    const name = os.hostname();
    if (name) out.push(`http://${name.endsWith('.local') ? name : name + '.local'}:${port}/remote`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}/remote`);
      }
    }
    return out;
  }

  return { pin, enabled, handlePage, addresses, get phones() { return phones.size; } };
}
