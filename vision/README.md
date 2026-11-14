# VIPER Vision

The audience view. VIPER Vision runs on the Mac, shows the HoloLens wearer's point of view full-screen, and
draws the surgical overlays and the Gemini attending on top of it, as if looking through the trainee's eyes.

The HoloLens itself only shows a light holographic forearm (the Unity app in `../Assets`). Everything the
audience sees is drawn here.

## Run it

```
cd vision
npm install          # once; also copies the hand-tracking runtime and downloads its model for offline use
cp .env.example .env.local   # then fill in the headset address and login, and the Gemini key
npm run dev          # http://localhost:4747  (open it in Chrome)
```

On stage, use the built version (no development server involved):

```
npm run build && npm start
```

Press `F` for full screen and `?` for the operator's key list.

## Where the picture comes from

| Key | Input | Notes |
|-----|-------|-------|
| `1` | HoloLens stream | The headset's Mixed Reality Capture live stream (holograms + camera), pulled by a relay on this Mac. Needs `HOLOLENS_IP`, `HOLOLENS_USER`, `HOLOLENS_PASS`. |
| `2` | Webcam | The Mac's camera or any camera plugged in. |
| `3` | Video file | Drop a recording on the window, or put clips in `vision/media/` (the first one plays). |
| `4` | Simulated arm | A drawn forearm with a green marker wound. Needs nothing; always works. |

At launch the app picks the best input that works (HoloLens, then webcam, then the simulated arm). Whatever
the operator picks by key is kept: if it drops, the last frame holds, the screen says "reconnecting", the
overlays stay up, and it comes back by itself.

You can also choose in the address: `?input=hololens|webcam|file|sim`, `?clip=name.mp4`, `?fit=contain`.

## Tracking

**The wound.** Draw the "laceration" on the forearm with a bright, saturated marker: a straight line 42 mm long
(default colour: bright green). Every video frame the app keeps the pixels close to the marker's colour, picks
the most line-like blob, fits a line to it and smooths it over time. Everything surgical is then drawn in
millimetres from the centre of that line, so it stays pinned to the arm as the head moves. If a hand covers
the marker for a moment the overlays hold their place; if it is gone for longer they fade out and come back.

- `K`, then click the marker line: track that colour instead (kept between sessions). `M` steps through
  presets (green, magenta, blue, orange).
- `X` / `Z`: flip which end is suture 1 / which side of the wound is the far side.
- `[` / `]`: squash or stretch the overlays across the arm, to match the camera's angle.
- `D`: debug view. The marker pixels light up, with the fitted line and the timings.
- Tips: matte marker, even light, nothing else of that colour in view (a green drape will confuse it: pick a
  different marker colour). The length of the line is what turns pixels into millimetres, so draw it 42 mm.

**The hand.** MediaPipe Hand Landmarker runs in the page. The working fingertip (or the pinch point, when
thumb and index are together as if holding an instrument) gets a small reticle; when it is on the current
suture target it reads **Aligned**. Hand tracking is a bonus: the space bar or a clicker registers the stitch
whether or not it is aligned.

## The procedure

| Step | What the audience sees |
|------|------------------------|
| Standing by | The wound is found and bracketed: "Wound locked". |
| Scan | A scan line sweeps the picture; a second pass leaves contour arcs over the arm. |
| Assess | The wound is measured: extension lines, a dimension line, "42 mm". |
| Anatomy | (milestone 5) Arteries, veins, nerve and tendons laid along the arm; the danger zone. |
| Plan | Five numbered targets with entry and exit points, the 8 mm spacing ruler, the 5 mm bite. The view zooms in. |
| Stitch | One suture per press: the target tightens, a curved needle passes under the wound, the thread is pulled flat, the knot pops, the suture turns green with a burst and "Suture 3/5 · spacing 7.9 mm ✓ · depth ✓". The Attending comments on each. |
| Complete | The view pulls back; the score card fills: sutures, average spacing, depth, time. |

Wording, counts and timings live in `src/procedure/data.ts`. **Autoplay** (`A`) runs the whole thing hands-free
for recording, and stops on the score card; `?autoplay=1` in the address starts it at launch. Sounds are
synthesised in the page (`N` mutes them; `?sound=0`).

## The Gemini attending

Press `G` to turn it on (the browser asks for the microphone the first time). The trainee asks out loud,
"what's that artery?", and the answer appears on the Attending card: the question as it is heard, then the
answer typed out, with the current step as context.

- **Setup:** put `GEMINI_API_KEY` in `vision/.env.local` and restart the server. The chip at the bottom
  shows "Attending listening" when it is connected.
- **Model:** `gemini-3.8-live`, the default Live model in Google's docs when this was built (2026-11-14).
  Set `GEMINI_LIVE_MODEL` to change it. It answers in speech; the card shows the transcript of what it says,
  replaced by a written card when it sends one.
- **The key stays on the server.** The page asks `POST /api/gemini-token` for an ephemeral token each time it
  opens a session: single use, two minutes to start a session, thirty to talk, locked to that model.
- **What it can do (tools):** `show_answer_card`, `highlight_structure` (radial artery, ulnar artery, veins,
  median nerve, flexor tendons, danger zone, wound), `look_at_view` (it is sent the current picture with the
  overlays, so it can answer "what am I looking at?"), `get_procedure_state`, `next_step`, `previous_step`,
  `repeat_step`, `go_to_step`.
- **Context:** the system prompt holds the procedure and the anatomy; the app also tells it, silently, every
  time the step changes or a suture goes in.
- **Voice:** `V` makes it speak its answers through the Mac as well. Off by default: a speaker near an open
  microphone can make it interrupt itself. `L` sends it the current picture without being asked.
- **It cannot break the demo.** If Gemini is unreachable or closes the session (connections last about ten
  minutes), the chip says so and it reconnects by itself, resuming the conversation; everything else runs
  without it. Replies that are not answers to something the trainee said are never shown.
- **From the console:** `__viper.ask('what is that artery?')` asks in text (after `G`).

Not yet run against the real API: there was no key on the machine this was built on. The token request was
checked as far as Google's "API key not valid" reply, and the card, tools and step changes were exercised
with simulated Live messages. First thing to check with a real key: press `G`, ask a question, watch the chip.
If a session opens and closes at once, start the server with `GEMINI_TOKEN_UNLOCKED=1` (the token's model
lock is the likeliest cause) and tell the Mac agent.

## Keys

| Key | Action |
|-----|--------|
| `Space` / clicker forward (`PageDown`) | Place the next suture; when none are left, next step |
| `→` / `←` (or clicker back, `PageUp`) | Next / previous step |
| `S` | Place the next suture |
| `R` | Reset |
| `A` | Autoplay (for recording the video) |
| `H` | Hide every overlay |
| `G` / `V` / `L` | Gemini attending on or off / speak answers aloud / send it the current picture |
| `T` | Zoom toward the wound while planning and stitching: on / off |
| `F` / `O` | Full screen / fill the screen or show the whole picture |
| `?` | The full key list, on screen |

### The relay

`server/relay.mjs` logs in to the headset's Device Portal and passes the live stream to the page
(`GET https://<ip>/api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false`).

- The user name and password stay on the server; the page never sees them.
- The headset's self-signed certificate is accepted for that one address only. Set `HOLOLENS_CERT_SHA256` to
  pin it (the relay prints the fingerprint it saw).
- The server only answers requests from this Mac.
- The page plays the stream through Media Source Extensions and holds it at the live edge; the relay and
  player add roughly 0.1 to 0.2 s on top of the headset's own encoding delay.

### Rehearsing with no headset

```
node dev/mock-hololens.mjs --drop-after 12      # a fake Device Portal: HTTPS, login, live MP4; drops every 12 s
HOLOLENS_IP=127.0.0.1 HOLOLENS_PORT=8443 HOLOLENS_USER=dev HOLOLENS_PASS=dev npm run dev
```

`node dev/shot.mjs --url "http://localhost:4747/?input=sim" --do "wait:3000;;shot:page"` opens the app in
headless Chrome and saves screenshots to `vision/shots/`.

## Third-party

| What | License |
|------|---------|
| Space Grotesk, Inter, JetBrains Mono (via `@fontsource-variable/*`) | SIL Open Font License 1.1 |
| MediaPipe Tasks Vision and the Hand Landmarker model | Apache 2.0 |
| `@google/genai` | Apache 2.0 |
| Vite, TypeScript, Playwright (development only) | MIT / Apache 2.0 |
