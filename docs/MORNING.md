# Morning: cold start to demo-ready in 10 minutes

Demo day, Sunday 2026-11-15. Devpost closes 11:15 AM; table judging after that (small groups of judges about
2 m from the Mac screen, about 2 minutes each). The Mac runs **VIPER Vision** (the screen the judges watch);
the Windows laptop runs the hotspot and installed the HoloLens app; the HoloLens shows the holographic body.

Everything below runs on the Mac unless it says laptop or headset. Times are cumulative.

## Pack (night before)

- HoloLens at 100% (about 2.5 h of use); keep it on the charger until you walk up. Mac, laptop, chargers.
- Clicker (forward = Next, back = previous step, "blank screen" button = talk to Gemini), phone (remote), USB
  cable for the HoloLens, a **bright saturated green** marker for the 42 mm "wound" line on the forearm.

## 0:00 Power, focus, network (2 min)

1. Mac on power. In a terminal: `caffeinate -dims &` (keeps the Mac awake). Focus: Do Not Disturb on.
2. Laptop: `tools\run hotspot on -FiveGHz`. The HoloLens and the Mac join that hotspot (both remember it).
3. Laptop: `tools\run hotspot find -Save` prints the HoloLens address (it is also saved on the laptop).
4. On the Mac, open any website: Gemini and "Hey Gemini" (Chrome's speech recognition) need internet, which
   reaches the Mac through the laptop's hotspot. The headset stream does not need internet.

## 0:02 Headset app (1 min)

5. HoloLens on, fitted. Start menu: **VIPER**. Place the body on the table (look at it, air tap).
6. Laptop: close Device Portal's live preview and `tools\run spectate` if open. The headset serves one live
   stream at a time and the Mac needs it.

## 0:03 Settings (1 min)

7. `vision/.env.local` on the Mac (it exists; the values are empty until you fill them):
   `HOLOLENS_IP` (the address from step 3), `HOLOLENS_USER` and `HOLOLENS_PASS` (the Device Portal login),
   `GEMINI_API_KEY`. Save. The server re-reads the file by itself; no restart.

## 0:04 Start the app (1 min)

8. `cd ~/hack/ScrubIn/vision && npm run build && npm start`, open http://localhost:4747 in Chrome, press
   `F` (full screen). Press `1` if the picture is not the headset's (the chip bottom right says
   **Live · HoloLens**). Allow the microphone if Chrome asks.

## 0:05 Preflight (30 s)

9. In a second terminal: `cd ~/hack/ScrubIn/vision && node dev/preflight.mjs`. It ends with **Ready.** when
   the settings, the headset, the stream format and the Gemini key are right, and says what to fix if not.
   It also prints each stream preset's picture size and fragment length. It never prints an address, a
   login or a key.

## 0:06 Pick the fastest stream and measure the delay (1 min)

10. The wearer looks at the Mac screen through the headset. Press `Shift`+`Y` and keep looking for about
   40 s. The app plays `live_high`, `live_med` and `live_low` in turn, measures each one glass to glass from a
   flashing square, and keeps the fastest that played cleanly. The table stays on screen: note the kept
   number for the judges ("about X s from the camera to this screen"). Press `Y` to close it.
11. Only if the operator presses Next as the trainee's hand lands (rather than when the screen shows it): set
    the suture trigger delay to that number with `-` and `=` (0.1 s steps, remembered).

## 0:07 One full run (2 min)

12. The forearm with the green line is in view: the chip says **Wound locked**. If it says
    **Searching for wound**, press `K` and click the green line on screen.
13. `Space` (or the clicker) through: Scan, Assess, Anatomy, Plan, five sutures, the score card. Ask Gemini
    one question (say "Hey Gemini, what's that artery?", or hold the clicker's talk button or `Space`) and
    wait for the spoken answer. `R` resets instantly.

## 0:09 Backup clip (1 min)

14. `Shift`+`C` records exactly 60 s of the headset stream to `vision/media/`. If the headset dies during
    judging, key `3` plays the newest clip and the whole demo runs on it. Key `4` (simulated arm) needs
    nothing at all. B-roll for the video is in `vision/media/broll/`.

## 0:10 Ready

- Each group of judges: `R`, then Next. After 8 quiet seconds in Ready the idle screen comes up; any key
  clears it. A finished run resets itself after 45 s.
- Phone remote: `?` shows its address and PIN (same Wi-Fi). Buttons: Next, Hold to talk, Back, Reset.

---

## Symptom, then fix

| What you see | What to do |
|---|---|
| Chip **No signal · HoloLens**, banner "Set HOLOLENS_IP, HOLOLENS_USER and HOLOLENS_PASS" | Fill in `vision/.env.local` (step 6). No restart needed; press `1`. |
| Banner "The headset rejected the user name or password" | The Device Portal login in `vision/.env.local` is wrong. |
| Banner "Reconnecting to HoloLens · The headset did not answer..." | The headset is asleep or off the hotspot. Wake it; laptop `tools\run hotspot status`; the Mac must be on the same hotspot. Meanwhile `3` (backup clip) or `4` (simulated arm) keeps the show going; `1` goes back. |
| Banner "...Is Device Portal on and is another capture already running?" | Something else is pulling the stream: close Device Portal's live preview, `tools\run spectate` or `tools\run record` on the laptop. |
| The picture trails real life badly | `Shift`+`Y` again (step 10), or `Q` to step through the presets by hand. Put the hotspot on 5 GHz. Reload (`Cmd`+`R`, about 2 s; settings are kept). |
| Picture frozen with **Reconnecting** for more than 10 s | It retries by itself. If not: `1` again, then restart the VIPER app on the headset. Backup: `3`. |
| **Searching for wound** | `K`, then click the green line. More even light. `D` shows what the tracker sees (`D` again hides it). |
| Overlays on the wrong side of the wound / suture 1 at the wrong end | `Z` / `X` (remembered). |
| Suture targets too wide or narrow across the arm | `[` / `]` (remembered). |
| The Gemini panel is missing, or Gemini is not answering | The demo runs without it. Internet on the Mac (step 4)? `GEMINI_API_KEY` set? `Shift`+`G` turns Gemini off and on; Chrome must have microphone permission (lock icon in the address bar). |
| "Hey Gemini" is not picked up | Say it clearly, then the question; or hold `Space` or the clicker's talk button instead. It needs internet. `?wake=0` in the address turns the wake phrase off. |
| Gemini does not hear the question | Hold the clicker's talk button (or `G` or `Space`) while speaking. |
| Anything odd on screen | `R` (instant reset). Still odd: reload (`Cmd`+`R`). |
| The Mac app is dead | `npm start` again in `vision/`. Raw view for the judges meanwhile: laptop `tools\run spectate`. |
| Operator key list | `?` |

What the failure drills showed (each from a running demo, on a fake headset, `node dev/drills.mjs`):
see the numbers in `docs/FACTS.md`.
