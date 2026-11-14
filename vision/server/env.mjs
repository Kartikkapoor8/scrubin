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

export function loadEnv() {
  const files = [path.join(VISION_ROOT, '.env.local'), path.join(VISION_ROOT, '..', 'tools', '.env.local')];
  const merged = {};
  for (const file of files.reverse()) Object.assign(merged, parseEnvFile(file));
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }

  const env = process.env;
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

// "192.168.137.42" -> "192.168.137.x": enough to recognise it in the UI without publishing it on a projector.
export function maskIp(ip) {
  if (!ip) return '';
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : 'set';
}
