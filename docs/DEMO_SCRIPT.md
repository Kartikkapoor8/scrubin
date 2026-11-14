# VIPER demo script

Two things to deliver: a 90-second live demo and a demo video. Spoken lines are left blank for Kartik.

The audience watches **VIPER Vision** on the big screen: the wearer's own point of view, streamed from the
HoloLens to the Mac, with every overlay and the attending drawn on top. The HoloLens itself shows the wearer
only a light holographic forearm on the patient's arm.

## Roles and kit

- **Wearer**: wears the HoloLens, stands over the arm, does the pretend surgery and the talking, and asks the
  attending questions out loud.
- **Patient**: right forearm palm-up on the table. On it, a "laceration" drawn with a bright green marker:
  one straight line, **42 mm long**, running along the forearm, about 12 cm up from the wrist.
- **Operator**: at the Mac, VIPER Vision full-screen on the projector, one hand on the space bar (or holding
  a clicker). The operator can run the whole demo alone; nothing depends on the headset's hand tracking.
- **Windows laptop**: installs the HoloLens app (`tools\ship.ps1`). Not needed during the demo.
- Everything on one network (the laptop's hotspot is fine): the Mac must be able to reach the HoloLens.
- A dark cloth under the arm. No green anywhere else in view.

## Before the judges arrive (about 4 minutes)

1. **HoloLens**: start VIPER. A cyan outline of a forearm follows your gaze. Look at the patient's arm (or
   have them slide their arm into the outline) and **air tap** to place it. The guides fade; a quiet cage
   stays on the arm.
2. **Mac**: `cd vision && npm run build && npm start`, open http://localhost:4747 in Chrome, press `F`.
3. Press `1`. The chip bottom-right should turn green: **Live · HoloLens**. Close anything else watching the
   headset's stream first (`tools\spectate.ps1`, Device Portal's live preview): assume the headset serves
   one viewer at a time.
4. The next chip should read **Wound locked**, with brackets around the marker line. If not: press `K`, click
   the marker line. (`D` shows what the tracker sees.)
5. Step through once with the space bar. If the anatomy is mirrored for where the patient is sitting, press
   `Z`; if wrist and elbow are swapped, `X`; if targets are too wide across the arm, `[`.
6. Press `G` (allow the microphone), ask one question, wait for the Attending card. Press `R`.
7. Leave it on "Standing by" until it is time.

Fallbacks, in order, if the stream will not come up: `2` webcam pointed at the arm, `3` a recorded clip from
`vision/media/`, `4` the simulated arm. The overlays, the procedure and the attending work the same on all four.

## The 90-second live demo

| Time | Beat | Operator | What the audience sees | Spoken line |
|------|------|----------|------------------------|-------------|
| 0:00 | Hook | (nothing) | The wearer's live view of a real arm; "Wound locked" brackets on the marker line |  |
| 0:08 | Scan | `Space` | A scan line sweeps the picture; contour arcs appear along the arm |  |
| 0:16 | Assess | `Space` | The wound is measured, "42 mm"; vitals come up with a live ECG |  |
| 0:26 | Anatomy | `Space` | Arteries pulsing, veins, nerve, tendons, labelled; the red danger zone beside the wound |  |
| 0:34 | Ask | (wearer speaks) | Wearer asks out loud, e.g. "What's that artery?" The question appears on the Attending card, the radial artery lights up, the answer types out |  |
| 0:46 | Plan | `Space` | The view moves in; five numbered targets, entry and exit points, 8 mm ruler, 5 mm bite |  |
| 0:54 | Stitch 1 | `Space`, `Space` | (first press enters the step) Needle through, thread pulled flat, knot, green burst, "Suture 1/5 · bite 5 mm ✓ · depth ✓" |  |
| 1:00 | Stitch 2–4 | `Space` ×3 | Three more, a beat apart; the attending comments on each; "Aligned" when the wearer's fingertip is on the target |  |
| 1:14 | Stitch 5 | `Space` | The last suture |  |
| 1:20 | Complete | `Space` | The view pulls back; the score ring fills: 5 of 5, average spacing 7.9 mm, time |  |
| 1:27 | Close | (nothing) | Hold on the finished repair |  |

Notes for the wearer:
- Keep the wound in the middle of your view and about 0.5 to 0.7 m away. The HoloLens camera sits above your
  eyes, so it sees slightly higher than you do.
- When you "stitch", bring your fingertip (or pinched fingers, as if holding a needle driver) to the target and
  hold it there for a second. Try not to cover the whole marker line with your hand.
- Ask the attending one clear question at a time and pause after it. Good ones: "What's that artery?",
  "What am I looking at?", "What do I do next?", "How am I doing?".
- If the attending is slow or silent, carry on. The operator's space bar drives everything.

Notes for the operator:
- `Space` is the one button: it places a suture when there is one to place and otherwise moves on. `→` and a
  presentation clicker's forward button do the same. Holding a key down counts once.
- `←` (or the clicker's back button) goes back a step, `Shift` + `→` skips ahead, `R` resets, `H` shows the
  clean picture, `A` plays the whole procedure by itself.
- If the stream drops, the screen says "reconnecting" and holds the last frame. Keep going; it comes back.

## The demo video

Record the Mac's screen with VIPER Vision in full screen (QuickTime ▸ New Screen Recording, or
Shift-Command-5). Two ways to get the picture underneath:

- **Live**: the HoloLens stream, exactly as in the live demo. Most real; needs everything working at once.
- **From a recorded point-of-view clip (recommended for clean takes)**: first record the raw view on the
  headset with `tools\record.ps1 start` / `stop` (this records from the deployed build, not through
  remoting), copy the clip into `vision/media/`, press `3` in VIPER Vision, then run the procedure over it,
  by hand or with `A` (autoplay), as many takes as needed. The tracking, overlays and attending behave the
  same on a recorded clip.

Shot list. Record more than you need; each shot at least twice.

| # | Shot | How | Covers | Narration |
|---|------|-----|--------|-----------|
| 1 | Wide establishing: table, patient's arm, wearer stepping in | Phone or camera on a tripod, landscape | Hook |  |
| 2 | Close-up: the green marker laceration on the bare arm | Phone, steady | Hook |  |
| 3 | VIPER Vision: wound locks, scan sweep | Screen recording | Scan |  |
| 4 | VIPER Vision: measurement and vitals | Screen recording | Assess |  |
| 5 | VIPER Vision: anatomy reveal, then the spoken question and the answer card | Screen recording, live microphone | Anatomy + attending |  |
| 6 | VIPER Vision: the plan appearing as the view moves in | Screen recording | Plan |  |
| 7 | VIPER Vision: one full stitch, then all five | Screen recording | Stitch (the money shot) |  |
| 8 | Over-the-shoulder: the wearer's hands over the arm, the big screen visible behind | Phone behind the wearer's shoulder | Stitch |  |
| 9 | VIPER Vision: the score card | Screen recording | Complete |  |
| 10 | Wide: wearer steps back, patient lifts the arm, smiles | Tripod | Close |  |
| 11 | Through the headset: the holographic forearm on the real arm (optional) | `tools\record.ps1` | "What the trainee sees" cutaway |  |

Capture tips:
- Bright, even room light. Shadows across the marker line make tracking flicker.
- Use `?sound=0` in the address, or `N`, if you want to add sound in the edit instead.
- `H` hides everything for a clean plate of the same camera move.

## Edit outline (about 1:30)

1. Shots 1–2 (0:00–0:10), title card.
2. Shots 3–6 in order (0:10–0:50).
3. Shot 7, with shot 8 cut in (0:50–1:12).
4. Shot 9 (1:12–1:22).
5. Shot 10, end card: "VIPER · Built at UCSC DevFest 2026" (1:22–1:30).
