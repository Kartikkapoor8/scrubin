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

export function loadEnv() {
  const merged = {};
  for (const file of [...ENV_FILES].reverse()) Object.assign(merged, parseEnvFile(file));
  const env = { ...merged };
  for (const [key, value] of Object.entries(SHELL_ENV)) {
    if (value !== undefined && value !== '') env[key] = value;
  }

  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    port: Number(clean(env.VISION_PORT)) || 4747,
    hololens: {
      ip: clean(env.HOLOLENS_IP),
      user: clean(env.HOLOLENS_USER),
      pass: env.HOLOLENS_PASS ?? '',
      // Only for the local mock (dev/mock-hololens.mjs); a real headset is always https on 443.
      port: Number(clean(env.HOLOLENS_PORT)) || 443,
      certSha256: clean(env.HOLOLENS_CERT_SHA256).replace(/[^0-9a-fA-F]/g, '').toUpperCase(),
    },
    gemini: {
      apiKey: clean(env.GEMINI_API_KEY) || clean(env.GOOGLE_API_KEY),
      liveModel: clean(env.GEMINI_LIVE_MODEL),
    },
  };
}

