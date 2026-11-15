# Morning: cold start to demo-ready in about 12 minutes

Demo day, Sunday 2026-11-15. Devpost closes 11:15 AM; table judging after that (small groups of judges about
2 m from the Mac screen, about 2 minutes each). The Mac runs **VIPER Vision** (the screen the judges watch);
the Windows laptop runs the hotspot and installed the HoloLens app; the HoloLens shows the holographic body.

Everything below runs on the Mac unless it says laptop or headset. Times are cumulative (about 12 minutes).

## Pack (night before)

- HoloLens at 100% (about 2.5 h of use); keep it on the charger until you walk up. Mac, laptop, chargers.
- Clicker (forward = Next, back = previous step, "blank screen" button = talk to Gemini), phone (remote), USB
  cable for the HoloLens, a **bright saturated green** marker for the 42 mm "wound" line on the forearm.

## 0:00 Power, focus, network (2 min)

1. Mac on power. In a terminal: `caffeinate -dims &` (keeps the Mac awake). Focus: Do Not Disturb on.
   Chrome: `chrome://settings/performance`, **Energy Saver off** (on battery it caps the page at 30 fps).
2. Laptop: `tools\run hotspot on -FiveGHz`. The HoloLens and the Mac join that hotspot (both remember it).
3. Laptop: `tools\run hotspot find -Save` prints the HoloLens address (it is also saved on the laptop).
4. On the Mac, open any website: Gemini and "Hey Gemini" (Chrome's speech recognition) need internet, which
   reaches the Mac through the laptop's hotspot. The headset stream does not need internet.

## 0:02 Headset app (1 min)

5. HoloLens on, fitted. Start menu: **VIPER**. Place the body on the table (look at it, air tap).
6. Laptop: close Device Portal's live preview and `tools\run spectate` if open. The headset serves one live
   stream at a time and the Mac needs it.

## 0:03 Settings (1 min)

7. `vision/.env.local` on the Mac (it exists, still holding the template's placeholders): set
   `HOLOLENS_IP` (replace the whole placeholder `192.168.137.xxx` with the address from step 3),
   `HOLOLENS_USER` and `HOLOLENS_PASS` (the Device Portal login), `GEMINI_API_KEY`. Save. The server re-reads
   the file by itself; a page that is already open needs `Cmd`+`R` to see the change.

## 0:04 Start the server (1 min)

8. Make sure no old server holds port 4747 (last night's development server may still be running):
   `lsof -nP -iTCP:4747 -sTCP:LISTEN`. If anything is listed, stop it (`Ctrl`+`C` in its terminal, or
   `kill $(lsof -ti tcp:4747 -sTCP:LISTEN)`; the `-sTCP:LISTEN` matters, without it Chrome's network process
   is killed too). Then `cd ~/hack/ScrubIn/vision && npm run build && npm start`. (If 4747 is still taken,
   `npm start` says so and stops. If the build fails on a type error, `npm start` alone serves the last good
   build.)

## 0:05 Preflight, before opening the page (30 s)

9. In a second terminal: `cd ~/hack/ScrubIn/vision && node dev/preflight.mjs`. It ends with **Ready.** when
   the settings, the headset, the stream format and the Gemini key are right, and says what to fix if not.
   It also prints each stream preset's picture size and fragment length, and never prints an address, a
   login or a key. Run it before the page is open: the headset serves one live stream at a time (if the
   page is already showing it, preflight skips its stream test and says so).
10. Once the Gemini key is in, run `node dev/ask.mjs` once (about a minute): it asks Gemini five spoken
    questions with nobody at the microphone and checks the answers, voice and captions. No live Gemini
    session had ever been run before demo day.

## 0:06 Open the page (30 s)

11. In Chrome open **http://localhost:4747/?input=hololens** (the `?input=hololens` keeps the headset chosen
    across reloads; without it a slow headset makes the page fall back to the webcam). Press `F` (full
    screen). The chip bottom right says **Live · HoloLens**. Allow the microphone if Chrome asks.

## 0:07 Pick the fastest stream and measure the delay (1 min)

12. The wearer looks at the Mac screen through the headset. Press `Shift`+`Y` and keep looking for about
    40 s. The app plays `live_high`, `live_med` and `live_low` in turn, measures each one glass to glass from a
    flashing square, and keeps the fastest that played cleanly. The table stays on the clock until you
    press `Y`: write the kept number down for the judges ("about X s from the camera to this screen").
13. The suture trigger delay is remembered from rehearsals in this Chrome. Only if the operator presses Next
    as the trainee's hand lands (rather than when the screen shows it), set it to the number from step 12
    with `-` and `=` (0.1 s steps); otherwise press `-` until it reads 0.0 s.

## 0:08 One full run (2 min)

14. The forearm with the green line is in view: the chip says **Wound locked**. If it says
    **Searching for wound**, press `K` and click the green line on screen.
15. Next (the clicker's forward button, `→` or `Space`) through: Scan, Assess, Under the skin, Plan, Suture
    (one press to enter it), five sutures (one press each), the debrief: eleven presses from Ready. One press per suture: wait for the knot before the next (a press during a stitch is
    ignored). With Gemini up, a `Space` press held longer than a third of a second becomes a question, so
    use the clicker or `→` for Next. Ask Gemini one question (say "Hey Gemini, what's that artery?", or hold
    the clicker's talk button or `Space`) and wait for the spoken answer. `R` resets instantly.

## 0:10 Backup clip (1 min)

16. With the marked forearm and the body in view and the wearer still, press `Shift`+`C`: it records exactly
    60 s of the headset stream to `vision/media/`. Wait for **Saved media/hololens-... · 60 s**, then press
    `3` once to see the clip play, and `1` to go back to the headset. If the headset dies during judging,
    `3` runs the whole demo on that clip (tell the judges it is a recording). If no clip was saved, `3` only
    says so: the backup is then `4`
    (the simulated arm, which needs nothing). B-roll for the video is in `vision/media/broll/` (its
    `README.txt` says what each file is). `?clean=1` hides the chips and operator notices (for screen
    recordings); at the table leave it off.

## 0:11 Ready

- Each group of judges: `R`, then Next. After 8 quiet seconds in Ready the idle screen comes up; any key
  clears it. A finished run resets itself after 45 s, and a run left untouched for 3 minutes does too.
- Phone remote: `?` shows its address and PIN (the phone joins the laptop's hotspot, like the Mac). Buttons:
  Next, Hold to talk, Back, Reset. The PIN changes at every server start unless `VISION_REMOTE_PIN=1234` is in
  `vision/.env.local`.
- If a judge asks what is measured: the wound's position, direction and length are tracked live from the
  green line, and the 42 mm is the line's known length, which sets the scale. Each suture is placed by the
  operator's press; the spacing and depth shown are the plan's values, not measurements.

---

## Symptom, then fix

| What you see | What to do |
|---|---|
| `npm start` says port 4747 is already in use | An old server holds it (often last night's `npm run dev`): `Ctrl`+`C` it, or `kill $(lsof -ti tcp:4747 -sTCP:LISTEN)`, then `npm start`. |
| Chip **No signal · HoloLens**, banner "Set HOLOLENS_IP, HOLOLENS_USER and HOLOLENS_PASS" | Fill in `vision/.env.local` (step 7); `HOLOLENS_IP` still holding the template's `192.168.137.xxx` counts as not set. The page picks it up within a few seconds. |
| Banner "The headset rejected the user name or password" | The Device Portal login in `vision/.env.local` is wrong. Fix it and save: the page tries again every 3 s by itself. |
| Banner "The headset address in vision/.env.local is not valid" | `HOLOLENS_IP` is mistyped: use the address from step 3. |
| Banner "Reconnecting to HoloLens · The headset did not answer..." | The headset is asleep or off the hotspot. Wake it; laptop `tools\run hotspot status`; the Mac must be on the same hotspot. Meanwhile `3` (backup clip) or `4` (simulated arm) keeps the show going; `1` goes back. |
| Banner "The headset refused the stream. Is Device Portal on, and is something else already showing it?" | Something else is pulling the stream: close Device Portal's live preview, `tools\run spectate` or `tools\run record` on the laptop. |
| The picture trails real life badly | `Shift`+`Y` again (step 12), or `Q` to step through the presets by hand. Put the hotspot on 5 GHz. Reload (`Cmd`+`R`, about 2 s; settings are kept). |
| Picture frozen with **Reconnecting** for more than 10 s | It retries by itself. If not: `1` again, then restart the VIPER app on the headset. Backup: `3`. |
| **Searching for wound** | `K`, then click the green line. More even light. `D` shows what the tracker sees (`D` again hides it). |
| Overlays on the wrong side of the wound / suture 1 at the wrong end | `Z` / `X` (remembered). |
| Suture targets too wide or narrow across the arm | `[` / `]` (remembered). |
| The Gemini panel (top right) is missing | No Gemini session: the chip says why (**Gemini connecting**, or **Gemini offline** after three failed tries; it keeps retrying). The demo runs without it. Internet on the Mac (step 4)? `GEMINI_API_KEY` set? `Shift`+`G` turns Gemini off and on. |
| Gemini does not answer | Chrome must have microphone permission (lock icon in the address bar). Chip states: ready, listening, thinking, speaking. |
| Chip **Gemini off**, or **Gemini offline** right after a talk press with a "Gemini is off" notice | There was no key when the page loaded: add it, then `Cmd`+`R` the page (or `Shift`+`G`). |
| Chip stays on **Gemini connecting** after the page opens | Press `G` once (Chrome can hold audio back until the first key press). |
| Banner "Gemini is not available right now" | Google refused the session several times and the app stopped trying. `Cmd`+`Option`+`J` (Chrome's console) shows Google's reason; `Shift`+`G` tries again. While Gemini is down, do not press the talk buttons. |
| "Hey Gemini" is not picked up | The panel's hint says **Say “Hey Gemini”** when the wake phrase is working and **Hold Space and ask** when it is not (it needs Chrome and the internet). Either way: hold `Space` or the clicker's talk button while asking. `?wake=0` in the address turns the wake phrase off. |
| Gemini does not hear the question | Hold the clicker's talk button (or `G` or `Space`) while speaking. |
| Anything odd on screen | `R` (instant reset). Still odd: reload (`Cmd`+`R`). |
| The Mac app is dead (banner "Reconnecting to HoloLens · The local relay is not answering") | `npm start` again in `vision/`; the page comes back by itself within about 7 s (reopen it, step 11, only if it does not). The phone remote's PIN will have changed (see Ready). Raw view for the judges meanwhile: laptop `tools\run spectate`, and close it again before pressing `1`. |
| `Shift`+`C` says to play the headset stream first while the picture is live | Press `1` once (a fresh connection), then `Shift`+`C` again. |
| Operator key list | `?` |

What the failure drills showed (each from a running demo, on a fake headset, `node dev/drills.mjs`):
see the numbers in `docs/FACTS.md`.
