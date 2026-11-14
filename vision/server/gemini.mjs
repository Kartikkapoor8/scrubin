// Short-lived tokens for the Gemini Live API.
//
// The page talks to Gemini directly over a WebSocket (audio has to be low-latency), but it must never see
// the API key. So the key stays here, and each time the page wants to open a Live session it asks this
// server for an ephemeral token: single use, valid for starting a session for two minutes and for talking
// for thirty, and locked to the one Live model. The server only answers requests from this Mac.
//
// Model: `gemini-3.8-live` is what Google's Live API docs name as the default (checked 2026-11-14).
// Override with GEMINI_LIVE_MODEL if that changes.
const DEFAULT_MODEL = 'gemini-3.8-live';
const START_WINDOW_MS = 2 * 60 * 1000;
const SESSION_WINDOW_MS = 30 * 60 * 1000;

export function createGemini(config) {
  const apiKey = config.gemini.apiKey;
  const model = config.gemini.liveModel || DEFAULT_MODEL;
  let client = null;

  async function handleToken(req, res) {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });
    if (!apiKey) {
      return send(503, { error: 'not_configured', detail: 'Set GEMINI_API_KEY in vision/.env.local and restart the server.' });
    }
    try {
      if (!client) {
        const { GoogleGenAI } = await import('@google/genai');
        client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
      }
      const now = Date.now();
      const tokenConfig = {
        uses: 1,
        newSessionExpireTime: new Date(now + START_WINDOW_MS).toISOString(),
        expireTime: new Date(now + SESSION_WINDOW_MS).toISOString(),
        httpOptions: { apiVersion: 'v1beta' },
      };
      // Lock the token to the Live model, so it is useless for anything else if it leaked. The page asks
      // for an unlocked one (?lock=0) only after a locked session was refused; GEMINI_TOKEN_UNLOCKED=1
      // never locks.
      const wantsLock = new URL(req.url, 'http://localhost').searchParams.get('lock') !== '0';
      if (wantsLock && process.env.GEMINI_TOKEN_UNLOCKED !== '1') tokenConfig.liveConnectConstraints = { model };
      const token = await client.authTokens.create({ config: tokenConfig });
      if (!token || !token.name) throw new Error('Gemini returned no token');
      return send(200, { token: token.name, model, expiresAt: tokenConfig.expireTime });
    } catch (err) {
      // Never echo the key or a raw upstream body to the page.
      const message = String(err && err.message ? err.message : err).replace(apiKey, '[key]').slice(0, 300);
      console.error('[gemini] could not create a token:', message);
      return send(502, { error: 'gemini', detail: 'Gemini refused to issue a token. Check the API key and the model name (server log has the reason).' });
    }
  }

  return { configured: Boolean(apiKey), model, handleToken };
}
