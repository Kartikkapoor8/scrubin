// Loads settings for the VIPER Vision server.
// Order of precedence: real environment variables, then vision/.env.local, then tools/.env.local
// (the Windows machine keeps the HoloLens settings there under the same names).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VISION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ENV_FILES = [path.join(VISION_ROOT, '.env.local'), path.join(VISION_ROOT, '..', 'tools', '.env.local')];
// What the shell gave us at startup. These always win over the files.
const SHELL_ENV = { ...process.env };

function fileStamp() {
  return ENV_FILES.map((file) => {
    try { return String(fs.statSync(file).mtimeMs); } catch { return '-'; }
  }).join('|');
}

let cached = null;
let cachedStamp = '';

/**
 * Current settings. Re-reads the settings files whenever one of them appears or changes, so credentials can
 * be added or corrected while the server is running (no restart in the middle of a rehearsal).
 */
export function currentConfig() {
  const stamp = fileStamp();
  if (!cached || stamp !== cachedStamp) {
    const first = cached === null;
    cached = loadEnv();
    cachedStamp = stamp;
    if (!first) console.log('[env] settings file changed: reloaded');
  }
  return cached;
}

/**
 * The headset's address as people actually write it. All of these are accepted, matching what the Windows
 * scripts in tools/ accept:
 *   HOLOLENS_IP=192.168.1.50            https on 443
 *   HOLOLENS_IP=192.168.1.50:10443      a port in the address
 *   HOLOLENS_IP=https://192.168.1.50/   a pasted Device Portal address
 *   HOLOLENS_SCHEME=http                Device Portal with "SSL connection required" switched off (port 80)
 *   HOLOLENS_PORT=8443                  the port on its own (used by the local mock)
 */
export function parseHeadsetAddress(address, schemeSetting = '', portSetting = '') {
  let host = address;
  let scheme = schemeSetting.toLowerCase();
  const prefix = host.match(/^(https?):\/\//i);
  if (prefix) {
    if (!scheme) scheme = prefix[1].toLowerCase();
    host = host.slice(prefix[0].length);
  }
  host = host.replace(/[/?#].*$/, '');
  let port = Number(portSetting) || 0;
  const withPort = host.match(/^([^:\[\]]+):(\d+)$/);
  if (withPort) {
    host = withPort[1];
    if (!port) port = Number(withPort[2]);
  }
  if (scheme !== 'http') scheme = 'https';
  return { host, scheme, port: port || (scheme === 'http' ? 80 : 443) };
}

export function loadEnv() {
  const merged = {};
  for (const file of [...ENV_FILES].reverse()) Object.assign(merged, parseEnvFile(file));
  const env = { ...merged };
  for (const [key, value] of Object.entries(SHELL_ENV)) {
    if (value !== undefined && value !== '') env[key] = value;
  }

  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const headset = parseHeadsetAddress(clean(env.HOLOLENS_IP), clean(env.HOLOLENS_SCHEME), clean(env.HOLOLENS_PORT));
  return {
    port: Number(clean(env.VISION_PORT)) || 4747,
    hololens: {
      ip: headset.host,
      user: clean(env.HOLOLENS_USER),
      pass: env.HOLOLENS_PASS ?? '',
      // https on 443 unless the settings say otherwise (see parseHeadsetAddress).
      scheme: headset.scheme,
      port: headset.port,
      certSha256: clean(env.HOLOLENS_CERT_SHA256).replace(/[^0-9a-fA-F]/g, '').toUpperCase(),
    },
    gemini: {
      apiKey: clean(env.GEMINI_API_KEY) || clean(env.GOOGLE_API_KEY),
      liveModel: clean(env.GEMINI_LIVE_MODEL),
    },
  };
}

