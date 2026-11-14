# VIPER demo script

Two things to deliver: a 90-second live demo and a demo video. Spoken lines are left blank for Kartik.

## How the video gets recorded (until remoting is proven)

The laptop runs Windows 11 26H2, where Holographic Remoting may not work. So the demo video is recorded from
the **deployed UWP build running on the HoloLens**, not through remoting:

1. `tools\ship.ps1` builds and installs the current code on the headset.
2. Start VIPER from the HoloLens Start menu.
3. `tools\record.ps1 start` begins a Mixed Reality Capture (holograms + camera + audio);
   `tools\record.ps1 stop` ends it and downloads the clip to `tools\captures\`.
4. `tools\spectate.ps1` shows the wearer's view live on the laptop for framing checks.

Between deploys, review visuals in the Unity editor with no headset: press Play and the Game view shows the
whole experience from a fixed camera at standing eye height, with every operator key working.

## Roles

- **Wearer**: wears the HoloLens, stands over the arm, does the talking.
- **Patient**: forearm palm-up on the table, marker "laceration" already drawn.
- **Operator**: at the PC, Game view focused, hands on the keyboard. The operator drives every step; the
  wearer's air taps are a bonus on top.

## Before the judges arrive (about 3 minutes)

1. HoloLens on, Holographic Remoting Player open, Unity connected (green "Connected"), then **Play**.
2. Wearer stands where they will stand for the demo and looks at the arm.
3. Operator presses `C` to drop the outline in front of the wearer, then aligns it to the real arm:
   arrows / `PgUp` `PgDn` to move, `Q` `E` yaw, `Z` `X` roll, `1` `2` pitch, `[` `]` size. The amber dashed
   line must sit on the marker laceration.
4. Operator presses `L` to lock. The outline disappears. Do not bump the table after this.
5. Leave it idling on the lock screen until it is time. If anything looks off: `L` to unlock, fix, `L` again.
6. If it all goes wrong mid-demo: `R` resets the procedure; stopping and pressing Play again takes ~10 seconds.

## The 90-second live demo

| Time | Beat | Operator | What the judge sees | Spoken line |
|------|------|----------|---------------------|-------------|
| 0:00 | Hook | (nothing) | Wearer over a real arm with a drawn wound |  |
| 0:08 | Boot | `Space` | Title assembles; scan plane sweeps down the arm leaving contour lines |  |
| 0:18 | Assess | `Space` | Patient card, live vitals, the wound measured: "42 mm" |  |
| 0:28 | X-ray | `Space` | Scanline wipe reveals arteries, veins, nerve, tendons, bone; the red danger zone pulses by the radial artery |  |
| 0:42 | Plan | `Space` | Five numbered suture points appear one by one with entry / exit dots and needle arcs |  |
| 0:52 | Stitch 1 | `S` (or air tap) | Needle runs the arc, thread follows, knot pops, point turns green, feedback line |  |
| 0:58 | Stitch 2–4 | `S` `S` `S` | Three more, a beat apart; the Attending card comments on each |  |
| 1:12 | Stitch 5 | `S` (or air tap) | Last suture; wearer does this one by air tap if the hand tracking is behaving |  |
| 1:18 | Complete | `Space` | Wound line fades, stitches stay, score ring fills: "5/5 sutures · avg spacing 7.9 mm" |  |
| 1:25 | Close | (nothing) | Hold on the finished repair |  |

Notes for the wearer:
- Keep your head about 0.7 m from the arm and move slowly; the HoloLens field of view is small, so look at
  the thing you are talking about.
- The Attending card is to the right of the arm. Glance at it once so the judge knows it is there.
- Hand off the headset only after the Complete beat. If a judge wears it, the operator re-runs with `R`.

## Demo video shot list

Record more than you need; each shot at least twice.

| # | Shot | How | Covers | Narration |
|---|------|-----|--------|-----------|
| 1 | Wide establishing: table, patient's arm, wearer stepping in | Phone or camera on a tripod, landscape | Hook |  |
| 2 | Close-up: the marker laceration on the bare arm, no holograms | Phone, macro-ish, steady | Hook |  |
| 3 | POV: boot title and scan sweep | `tools\record.ps1` on the deployed build | Boot |  |
| 4 | POV: patient card, vitals, wound measurement | `tools\record.ps1` | Assess |  |
| 5 | POV: the X-ray reveal, slow push in toward the radial artery and the danger zone | `tools\record.ps1`, wearer leans in slowly | X-ray |  |
| 6 | POV: suture plan appearing point by point | `tools\record.ps1` | Plan |  |
| 7 | POV close-up: one full stitch (needle, thread, knot, green burst, feedback) | `tools\record.ps1`, head still, 0.5 m | Stitch (the money shot) |  |
| 8 | Over-the-shoulder: wearer air-tapping above the arm | Phone behind the wearer's shoulder | Stitch |  |
| 9 | POV: all five sutures done, score card | `tools\record.ps1` | Complete |  |
| 10 | Wide: wearer steps back, patient lifts the arm, smiles | Tripod | Close |  |
| 11 | Screen: the operator view in Unity with the legend (optional, shows it is live) | Screen recording | Cutaway |  |
| 12 | Fallback: the virtual patient mode on an empty table (optional) | `tools\record.ps1` | "No arm? No problem" beat |  |

Capture tips:
- Mixed Reality Capture films through the HoloLens camera, which sits above the eyes, so holograms can look
  slightly offset on close objects. Check a test clip first; if they are off, unlock and nudge the alignment
  for the capture pass only.
- Use autoplay (`A`) for the POV shots so the timing is identical on every take.
- Bright, even room light makes the arm look good on camera; holograms still read because they are additive.
  Avoid a white tabletop (it washes holograms out): put a dark cloth under the arm.
- Record room audio separately on a phone for the blips and narration, or add narration in the edit.

## Edit outline (about 1:30)

1. Shots 1–2 (0:00–0:10), title card.
2. Shots 3–6 in order (0:10–0:50).
3. Shot 7, with shot 8 cut in (0:50–1:10).
4. Shot 9 (1:10–1:22).
5. Shot 10, end card: "VIPER · Built at UCSC DevFest 2026" (1:22–1:30).
