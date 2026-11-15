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

The server re-reads `.env.local` whenever the file changes, so the headset login or the Gemini key can be
added or corrected while it runs. No restart.

## Table mode (a science-fair table, groups of judges, two minutes each)

This is how the app behaves by default.

- **Idle screen.** After 8 quiet seconds in Ready the screen shows the name, one line of what it is and
  "Ready". Any key, clicker press or remote button brings the working view back. `?attract=20` changes the
  wait; `?attract=0` turns the idle screen off.
- **`R` is instant.** Back to Ready with no fades: overlays cleared, zoom reset, the attending cut off
  mid-sentence. Pressing Next on the score card does the same, so one button runs group after group.
- **It tidies up by itself.** A finished run goes back to Ready after 45 s (`?done=`), an abandoned one
  after 3 minutes (`?idle=`). `0` means never.
- **Bluetooth presenter.** Forward (`PageDown`) is Next, back (`PageUp`) is Back, and the "blank screen"
  button (`B` or `.`) is the talk button.
- **Phone remote.** Open `http://<this Mac's address>:4747/remote` on a phone on the same Wi-Fi and type the
  4-digit PIN. The address and PIN are in the `?` help and in the server's start-up lines. Buttons: **NEXT**,
  **HOLD TO TALK**, **BACK**, **RESET**. `VISION_REMOTE_PIN=1234` fixes the PIN; `VISION_REMOTE=0` turns the
  remote off.
- **Push-to-talk.** The microphone reaches Gemini only while a talk button is held (`G`, the presenter's
  blank button, or HOLD TO TALK on the phone). A quick tap also works: it listens until you stop speaking.
  Because the attending cannot hear itself, its **voice is on by default**. `?talk=open` goes back to an
  always-open microphone.
- **Captions.** The question as it is heard and the answer as it is spoken appear large at the bottom.
- **Sized for two metres.** Every screen was checked at a quarter of its size; anything a judge must read
  survives that. `?big=0` gives the smaller lettering on the picture (for a close-up screen recording).

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
- **Holograms are ignored.** The headset's own holograms are in the stream, and some are green. A line that
  glows (brighter than the surface beside it, with a burnt-out core) is never taken for the marker; ink on
  skin is never both. `J` turns this off, for the case where the "wound" is itself a hologram. In the debug
  view the line "glowing (hologram) N" counts what was rejected.
- Tips: matte marker, even light, nothing else of that colour in view (a green drape will confuse it: pick a
  different marker colour). The length of the line is what turns pixels into millimetres, so draw it 42 mm.

**The hand.** MediaPipe Hand Landmarker runs in the page. The working fingertip (or the pinch point, when
thumb and index are together as if holding an instrument) gets a small reticle; when it is on the current
suture target it reads **Aligned**. Hand tracking is a bonus: the space bar or a clicker registers the stitch
whether or not it is aligned.

## The procedure

| Step | What the audience sees |
|------|------------------------|
| Ready | The wound is found and bracketed: "Wound locked". |
| Scan | A scan line sweeps the picture; a second pass leaves contour arcs over the arm. |
| Assess | The wound is measured: extension lines, a dimension line, "42 mm". |
| Anatomy | A scan line runs wrist to elbow and the anatomy appears behind it: radial and ulnar arteries in red with blood pulsing toward the hand, superficial veins in blue, the median nerve in yellow, flexor tendons in white, each labelled on a leader. A hatched red **danger zone** marks the radial artery beside the wound. |
| Plan | Five numbered targets with entry and exit points, the 8 mm spacing ruler, the 5 mm bite. The view zooms in. |
| Stitch | One suture per press: the target tightens, a curved needle passes under the wound, the thread is pulled flat, the knot pops, the suture turns green with a burst and "Suture 3/5 · spacing 7.9 mm ✓ · depth ✓". The Attending comments on each. |
| Complete | The view pulls back; the score card fills: sutures, average spacing, depth, time. |

From Assess onward the **vitals panel** (top right) shows a sweeping ECG, heart rate, blood pressure and SpO2.
The danger zone stays on, dashed, through Plan and Stitch. The anatomy is a teaching diagram laid out in
millimetres from the wound (`src/overlay/layers/anatomy.ts`), not a scan of the real arm; it assumes the
wound is drawn along the forearm, about 12 cm from the wrist, with the thumb side on the far side of the
picture (`Z` flips the side, `X` flips wrist and elbow).

Wording, counts and timings live in `src/procedure/data.ts`. **Autoplay** (`A`) runs the whole thing hands-free
for recording, and stops on the score card; `?autoplay=1` in the address starts it at launch. Sounds are
synthesised in the page (`N` mutes them; `?sound=0`).

## The Gemini attending

With a key configured the attending connects by itself at launch (the browser asks for the microphone the
first time; `Shift` + `G` turns it off and on, `?attending=0` starts without it). Hold `G`, ask out loud,
"what's that artery?", and let go: the question appears as it is heard, then the answer, spoken and
captioned, with the current step as context.

- **Setup:** put `GEMINI_API_KEY` in `vision/.env.local`. The chip at the bottom shows "Attending listening"
  when it is connected.
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
- **Voice:** it speaks its answers through the Mac; `V` turns that off and on. `L` sends it the current
  picture without being asked.
- **It cannot break the demo.** If Gemini is unreachable or closes the session (connections last about ten
  minutes), the chip says so and it reconnects by itself, resuming the conversation; everything else runs
  without it. Replies that are not answers to something the trainee said are never shown.
- **From the console:** `__viper.ask('what is that artery?')` asks in text (after `G`).

**Test it with nobody at the microphone:** `node dev/ask.mjs` (with the app running). It speaks five
questions with macOS `say`, feeds them through the page's own path to the Live session, and checks that each
was heard, appeared on the card, was answered in captions and in voice, and that the tool calls fired
(highlight, next step, repeat, look at the view). It prints the compatibility level the session opened at.
`node dev/ask.mjs --dry` runs the same checks against a stand-in session, with no key.

Not yet run against the real API: there was no key on the machine this was built on. The token request was
checked as far as Google's "API key not valid" reply, and the card, tools and step changes were exercised
with simulated Live messages and the dry run above. First thing to do with a real key: `node dev/ask.mjs`.
If Gemini refuses a session before it starts, the app steps down by itself: first to plain tools with an
unlocked token and none of the optional session features, then to no tools at all (answers still appear on
the card). If even that is refused it stops and shows Google's reason in the banner; the browser console has
the detail. Tell the Mac agent which level it settled on (`__viper.brain` in the console shows `compat`).

## Keys

| Key | Action |
|-----|--------|
| `Space`, `→`, or a clicker's forward button (`PageDown`) | Next: place the next suture; when none are left, next step; on the score card, start over |
| `←` or a clicker's back button (`PageUp`) | Previous step |
| `Shift` + `→` | Next step, skipping any sutures not yet placed |
| `S` | Place the next suture |
| `R` | Reset to Ready, instantly |
| `A` | Autoplay (for recording the video) |
| `H` | Hide every overlay |
| `G` (hold), `B`, `.` | Talk to the attending: hold and speak, or tap and speak |
| `Shift` + `G` / `V` / `L` | Attending on or off / its voice on or off / send it the current picture |
| `1` `2` `3` `4` | Input: HoloLens / webcam / video file / simulated arm |
| `C` / `Shift` + `C` | Record the raw HoloLens stream to `vision/media/` (press again to stop) / record exactly 60 s |
| `K` / `M` / `J` | Pick the marker colour by clicking it / step through colour presets / ignore holograms on or off |
| `D` | Debug view of the tracker |
| `Y` | Sync clock, for measuring how far the headset's picture trails real life |
| `-` / `=` | Suture trigger delay, down / up 0.1 s (HoloLens input only; remembered) |
| `T` | Zoom toward the wound while planning and stitching: on / off |
| `F` / `O` | Full screen / fill the screen or show the whole picture |
| `?` | The full key list, on screen |

### The relay

`server/relay.mjs` logs in to the headset's Device Portal and passes the live stream to the page
(`GET https://<ip>/api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false`).

- The user name and password stay on the server; the page never sees them.
- `HOLOLENS_IP` takes the address the way the Windows scripts do: `192.168.1.50`, with a port
  (`192.168.1.50:10443`), or pasted from the browser (`https://192.168.1.50/`). It is https on 443 unless
  told otherwise; `HOLOLENS_SCHEME=http` is for a headset with "SSL connection required" switched off.
- The headset's self-signed certificate is accepted for that one address only. Set `HOLOLENS_CERT_SHA256` to
  pin it (the relay prints the fingerprint it saw).
- Only this Mac can use the app, the stream and the token route. Other devices on the network can reach
  exactly one thing: the phone remote (`/remote`), behind its PIN.
- The page plays the stream through Media Source Extensions and holds it at the live edge; the relay and
  player add roughly 0.1 to 0.2 s on top of the headset's own encoding delay. If the browser refuses the
  stream as the headset sends it, the page steps down by itself: first it asks the relay to repackage the
  stream through `ffmpeg` (same video, never re-encoded, still about 0.1 s behind; needs `ffmpeg` on the
  Mac), and if that fails too it hands the stream straight to the video element (about 0.6 s behind).
  `?hlmode=remux` and `?hlmode=progressive` force either one. All three reconnect by themselves when the
  stream ends or stalls; the browser console says which one is in use.
- **The lag, and matching it.** The headset's picture arrives a second or more after real life. Press `Y`:
  a large running clock appears. Point the headset at the Mac's screen and compare the clock with its own
  image in the picture; the difference is the lag. Set it with `-` and `=` (0.1 s steps), then `Y` again.
  From then on a suture triggered by Space, the clicker or the phone starts that much later, so an operator
  who presses as the trainee's hand lands sees the stitch play when the screen shows it land. Step changes
  and Reset are never delayed, and other inputs ignore the setting. If the operator watches the screen
  rather than the hands, leave it at 0.
- **Recording.** `C` saves the stream exactly as the headset sent it to `vision/media/hololens-<date>-<time>.mp4`
  (no re-encoding; press `C` again to stop, `Shift` + `C` for exactly 60 s). Key `3` plays the newest clip, so a
  recording is at once the backup for a dead headset and footage for the video.

### Rehearsing with no headset

```
node dev/mock-hololens.mjs --drop-after 12      # a fake Device Portal: HTTPS, login, live MP4; drops every 12 s
HOLOLENS_IP=127.0.0.1 HOLOLENS_PORT=8443 HOLOLENS_USER=dev HOLOLENS_PASS=dev npm run dev
```

To replay bytes captured from the real headset (`tools\run capture-sample` on the Windows machine writes
`captures/mrc-live-sample.mp4`):

```
node dev/mock-hololens.mjs --raw ../captures/mrc-live-sample.mp4 --loop
```

It prints what the file contains (tracks, fragments, timing) and serves it exactly as it was sent, fragment
by fragment on its own clock. With `--loop` it plays as one endless stream; without, each connection ends
where the capture ended, which is also a dropped-connection test.

`node dev/shot.mjs --url "http://localhost:4747/?input=sim" --do "wait:3000;;shot:page"` opens the app in
headless Chrome and saves screenshots to `vision/shots/`. `?input=sim&sim=body` adds glowing holograms
(one in marker green) to the simulated picture and `&marker=0` removes the real marker: the worst case for
the tracker.

## Third-party

| What | License |
|------|---------|
| Space Grotesk, Inter, JetBrains Mono (via `@fontsource-variable/*`) | SIL Open Font License 1.1 |
| MediaPipe Tasks Vision and the Hand Landmarker model | Apache 2.0 |
| `@google/genai` | Apache 2.0 |
| Vite, TypeScript, Playwright (development only) | MIT / Apache 2.0 |

## Before going on stage

1. `npm run build && npm start`, open http://localhost:4747 in Chrome, press `F`.
2. Press `1` (HoloLens). If the chip does not go green in a few seconds, `2` (webcam) or `3` (a recorded clip in
   `vision/media/`) or `4` (simulated arm) keep the show going; `1` again retries.
3. Check the chip says **Wound locked** with the real marker under the real light. If it does not: `K` and
   click the marker line; `D` shows what the tracker sees.
4. Step to Anatomy and Plan once. If the anatomy is mirrored or back to front for where the patient sits,
   press `Z` or `X`. If targets look too wide or too narrow across the arm, `[` or `]`. These are remembered.
5. Hold `G`, ask one question, let go, wait for the answer. `R` to reset. You are ready.
6. Pair the presenter, or open the phone remote (`?` shows its address and PIN), and press Next once from
   where you will stand.

If something goes wrong mid-demo: `R` resets the procedure, `H` shows the clean picture, and reloading the
page takes about two seconds (settings are kept).

## Layout of the code

| Folder | What is in it |
|--------|---------------|
| `server/` | The local server: stream relay and recorder, Gemini token route, phone remote, static files. |
| `src/input/` | The four picture sources and the switcher with its fallback rules. |
| `src/tracking/` | Wound detection and smoothing; MediaPipe hands. |
| `src/procedure/` | The step script (`data.ts`) and the state machine every control goes through. |
| `src/overlay/` | The canvas overlays: glow primitives, wound space, one file per layer in `layers/`. |
| `src/ui/` | The DOM panels: brand and chips, step panel, vitals, captions (Attending card), feedback line, score card, title, idle screen. |
| `src/brain/` | The Gemini attending: microphone, Live session, tools. |
| `dev/` | Mock HoloLens Device Portal (and raw replay of a capture), the headless screenshot script, the spoken-question test for the attending. |
