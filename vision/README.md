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
- **`R` is instant.** Back to Ready with no fades: overlays cleared, zoom reset, Gemini cut off
  mid-sentence. Pressing Next on the debrief does the same, so one button runs group after group.
- **It tidies up by itself.** A finished run goes back to Ready after 45 s (`?done=`), an abandoned one
  after 3 minutes (`?idle=`). `0` means never.
- **Bluetooth presenter.** Forward (`PageDown`) is Next, back (`PageUp`) is Back, and the "blank screen"
  button (`B` or `.`) is the talk button.
- **Phone remote.** Open `http://<this Mac's address>:4747/remote` on a phone on the same Wi-Fi and type the
  4-digit PIN. The address and PIN are in the `?` help and in the server's start-up lines. Buttons: **NEXT**,
  **HOLD TO TALK**, **BACK**, **RESET**. `VISION_REMOTE_PIN=1234` fixes the PIN; `VISION_REMOTE=0` turns the
  remote off.
- **Hands-free: "Hey Gemini".** Say it and ask; the question ends when you stop speaking. Chrome's Web
  Speech API listens for the phrase (it needs the internet; `?wake=0` turns it off).
- **Push-to-talk** is always there as well: hold `Space` (a tap is still Next), hold `G`, the presenter's
  blank button, or HOLD TO TALK on the phone. A quick tap of a talk button also works: it listens until you
  stop speaking. The microphone reaches Gemini only during a question and never while Gemini is thinking or
  speaking, so its **voice is on by default** and it cannot interrupt itself. `?talk=open` goes back to an
  always-open microphone.
- **The Gemini panel** (top right) shows the question as it is spoken, the answer typing out, a waveform for
  listening / thinking / speaking, and one line of procedure context ("Step 5 of 6 · Suture 2 of 5").
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
| Anatomy | The view moves in on the wound. A scan line crosses a window around it and what lies underneath appears behind the line: the radial and ulnar arteries in red with blood pulsing toward the hand, the median nerve in yellow, a superficial vein in blue, named at the end of the window. A hatched red **danger zone** marks the radial artery beside the wound. Nothing is drawn away from the wound: the headset's holographic body is already in the picture. |
| Plan | Five numbered targets with entry and exit points, the 8 mm spacing ruler, the 5 mm bite. The view zooms in. |
| Stitch | One suture per press: the target tightens, a curved needle passes under the wound, the thread is pulled flat, the knot pops, the suture turns green with a burst, the measured gap to the last suture is drawn under it, and a card confirms it: "Suture 3/5 · Spacing 7.9 mm ✓ · Depth ✓" with a one-line comment. |
| Complete | The debrief comes up along the bottom: a ring that fills to 5/5, average spacing, depth, time, each number counting up. |

The **step rail** (left) lists the six steps, fills as they are done, and opens the current one into a card
with its name, what to do, and the suture count. The danger zone stays on, dashed, through Plan and Stitch. The anatomy is a teaching diagram laid out in
millimetres from the wound (`src/overlay/layers/anatomy.ts`), not a scan of the real arm; it assumes the
wound is drawn along the forearm, about 12 cm from the wrist, with the thumb side on the far side of the
picture (`Z` flips the side, `X` flips wrist and elbow).

Wording, counts and timings live in `src/procedure/data.ts`. **Autoplay** (`A`) runs the whole thing hands-free
for recording, and stops on the debrief; `?autoplay=1` in the address starts it at launch. Sounds are
synthesised in the page (`N` mutes them; `?sound=0`).

## Gemini (the attending)

With a key configured Gemini connects by itself at launch (the browser asks for the microphone the first
time; `Shift` + `G` turns it off and on, `?attending=0` starts without it) and its panel appears top right.
Say "Hey Gemini, what's that artery?", or hold `Space` (or `G`, or the clicker's talk button), ask, and let
go: the question appears as it is spoken, then the answer, typed out and spoken, with the current step as
context. Without a session the panel is simply not there; the demo runs the same.

- **Setup:** put `GEMINI_API_KEY` in `vision/.env.local`. The chip at the bottom shows "Gemini ready" when it
  is connected ("Gemini offline" after three failed attempts; it keeps trying).
- **"Hey Gemini"** is heard by Chrome's Web Speech API (`src/brain/wake.ts`), which sends the microphone to
  Google's speech service, so it needs Chrome and the internet. When the phrase is recognised the Live turn
  opens with the last 1.8 s of audio, so the question is whole; a pause ends it. Nothing is heard while
  Gemini is thinking or speaking. The panel's hint says "Say “Hey Gemini”" while this is working and "Hold
  Space and ask" when it is not. Only the greeting triggers it; the word "Gemini" alone does not.
- **The panel** keeps a long answer to six lines (it scrolls as it is typed), clears a question that got no
  answer, and drops the previous answer the moment a new question starts.
- **Model:** `gemini-3.8-live`, the default Live model in Google's docs when this was built (2026-11-14).
  Set `GEMINI_LIVE_MODEL` to change it. It answers in speech; the panel shows the transcript of what it says,
  replaced by a written answer when it sends one.
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
was heard, appeared on the panel, was answered in writing and in voice, and that the tool calls fired
(highlight, next step, repeat, look at the view). It then runs a hands-free turn: the recogniser's results
are fed in ("hey gemini, how many sutures are planned"), and the turn must open on the wake phrase, show the
question without it, end on the pause and be answered. It prints the compatibility level the session opened at.
`node dev/ask.mjs --dry` runs the same checks against a stand-in session, with no key.

Not yet run against the real API: there was no key on the machine this was built on. The token request was
checked as far as Google's "API key not valid" reply, and the panel, tools and step changes were exercised
with simulated Live messages and the dry run above. First thing to do with a real key: `node dev/ask.mjs`.
If Gemini refuses a session before it starts, the app steps down by itself: first to plain tools with an
unlocked token and none of the optional session features, then to no tools at all (answers still appear on
the panel). If even that is refused it stops and says "Gemini is not available right now"; Google's reason
is in the browser console. Tell the Mac agent which level it settled on (`__viper.brain` in the console shows `compat`).

## Keys

| Key | Action |
|-----|--------|
| `Space` (tap), `→`, or a clicker's forward button (`PageDown`) | Next: place the next suture; when none are left, next step; on the debrief, start over |
| `Space` (hold) | Talk to Gemini: hold, ask, let go |
| `←` or a clicker's back button (`PageUp`) | Previous step |
| `Shift` + `→` | Next step, skipping any sutures not yet placed |
| `S` | Place the next suture |
| `R` | Reset to Ready, instantly |
| `A` | Autoplay (for recording the video) |
| `H` | Hide every overlay |
| `G` (hold), `B`, `.` | Talk to Gemini: hold and speak, or tap and speak |
| `Shift` + `G` / `V` / `L` | Gemini on or off / its voice on or off / send it the current picture |
| `1` `2` `3` `4` | Input: HoloLens / webcam / video file / simulated arm |
| `C` / `Shift` + `C` | Record the raw HoloLens stream to `vision/media/` (press again to stop) / record exactly 60 s |
| `K` / `Shift` + `M` / `J` | Pick the marker colour by clicking it / step through colour presets / ignore holograms on or off |
| `M` | Arm mode on / off (the backup demo, below) |
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
- **Measuring it for you, and picking the fastest preset.** While the clock is up (`Y`) a square on the left
  of the screen flashes at random moments; when the headset looks at the screen, the app finds that pattern
  in the picture and shows the real glass-to-glass delay (camera, encoder, network, relay, player, display),
  no reading of digits needed. `Shift` + `Y` runs a sweep: it plays `live_high`, `live_med` and `live_low` in
  turn (keep looking at the screen for about 40 s), measures each, and keeps the fastest one that played
  cleanly (`live_low` only if it beats `live_med` by more than 80 ms). `Q` steps through the presets by hand;
  `?hlq=med` picks one in the address. The choice is remembered. `__viper.latencySelfTest(850)` checks the
  maths with no headset.
- **Staying at the live edge.** Fragments arrive whole, so the picture's lead over the newest frame is a
  sawtooth. The player watches its low point (just before the next fragment lands) and plays 3 to 15% faster
  or 3% slower to keep it about 50 ms from empty, jumping to the edge if it falls more than 1.2 s behind;
  after a stall it keeps 0.2 s in hand for 8 s. On the mock headset that is 90 to 160 ms of buffer with
  100 ms fragments (it was up to 450 ms before). The sync clock panel shows the live numbers.
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
| Motion (`motion`): the spring animation of the panels | MIT |
| Vite, TypeScript, Playwright (development only) | MIT / Apache 2.0 |

## Before going on stage

0. `node dev/preflight.mjs` (with the app running): about twenty seconds, and it says whether the settings,
   the headset, the stream's format and the Gemini key are in order, and what to fix. It samples
   `live_high`, `live_med` and `live_low` in turn and prints each one's picture size, fragment length (the
   delay the headset adds before anything can be shown), bit rate and time to first byte. It never prints
   an address, a login or a key.
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

## Arm mode (backup demo, off by default; parked)

`M`, or `?mode=arm` in the address, swaps the procedure for a demo that needs nothing but a bare forearm in
front of the HoloLens or the webcam: a holographic exoskeleton (three.js with bloom) assembles round the
forearm, holds while it is tracked and flies apart when it leaves. Detection: MediaPipe hand landmarks for the
wrist, the multiclass selfie segmenter's body-skin mask (fused with skin colour, because the model often calls
a lone forearm "clothes"), a principal-axis fit for direction and width, One Euro filters and enter/exit
hysteresis (0.4 s / 1 s). Scale assumes a 65 mm mid-forearm. `D` shows the mask and the fit.

Built to milestone 1 of 3 (detection and exoskeleton) and then parked on 2026-11-14 when the headset stream
came good; the cut detection, suture plan and Gemini walkthrough were not built. The code is in `src/arm/`,
loaded only when the mode is first switched on. `node dev/make-arm-clip.mjs --forearm <photo> --hand <png>`
renders a test clip (an arm enters, holds, gets red marker cuts, leaves) to feed in as a fake webcam:
`node dev/shot.mjs --camera dev/media/arm-clip.mjpeg --url "http://localhost:4747/?input=webcam&mode=arm"`.

## Layout of the code

| Folder | What is in it |
|--------|---------------|
| `server/` | The local server: stream relay and recorder, Gemini token route, phone remote, static files. |
| `src/input/` | The four picture sources and the switcher with its fallback rules. |
| `src/tracking/` | Wound detection and smoothing; MediaPipe hands. |
| `src/procedure/` | The step script (`data.ts`) and the state machine every control goes through. |
| `src/overlay/` | The canvas overlays: glow primitives, wound space, one file per layer in `layers/`. |
| `src/ui/` | The DOM panels: brand and chips, the step rail, the Gemini panel, suture feedback, the debrief, the title and the idle screen. `hud.css` holds their look and the type scale; `motion.ts` is the one spring they all move with (Motion). |
| `src/brain/` | Gemini: microphone, Live session, tools, and the "Hey Gemini" listener (`wake.ts`). |
| `dev/` | Mock HoloLens Device Portal (and raw replay of a capture), the headless screenshot script, the spoken-question test for the attending, the preflight check. |
