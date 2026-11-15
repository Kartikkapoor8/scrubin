# VIPER

**Visual Instruction for Procedures & Emergency Repair.** A surgical suture trainer for HoloLens: the trainee
sees a holographic patient through the headset, and everyone else sees the trainee's own view on a screen with
the repair drawn onto the real arm and a Gemini attending they can talk to.

![VIPER Vision annotating a marker-pen incision on a forearm](docs/screens/hero.jpg)

Built in a weekend at UCSC DevFest 2026. **Training simulator, concept. Not medical guidance.**

## What it does

- **Follows a real line on a real arm.** A green marker line stands in for the wound. VIPER Vision finds it in
  the headset's live video, ignores the holograms around it, and pins every overlay to it in millimetres, so
  the drawing moves with the arm.
- **Walks through a repair.** Scan, assess, what is under the skin, plan, five sutures, debrief: a step rail,
  targets on the wound, a card that confirms each suture, and a debrief at the end. One key (`K`) scans and
  annotates the line in one go.
- **Has an attending you can talk to.** Say "Hey Gemini" (or hold a button) and ask. Gemini Live hears the
  question, sees the trainee's view when it needs to, answers out loud and in writing, and can point at a
  structure or move the procedure on. It cannot place or skip a suture.
- **Is built for a demo table.** Lettering sized to read from two metres, an idle screen between groups, a
  clicker and a phone remote, and fallbacks (webcam, recorded clip, simulated arm) if the headset drops.

![Every state of a run](docs/screens/states.jpg)

## How it works

```
HoloLens 1 (Unity app: holographic body)
   |  Device Portal live stream (what the wearer sees)
   v
Mac: VIPER Vision  --- relay (Node) ---> Chrome page
                                           |- wound tracking (colour mask + line fit, per frame)
                                           |- overlays (canvas, drawn in wound millimetres)
                                           |- HUD (step rail, Gemini panel, feedback, debrief)
                                           '- Gemini Live (voice in, voice + tools out; key stays on the server)
```

| Part | Built with |
|------|------------|
| VIPER Vision (`vision/`) | TypeScript, Vite, Canvas 2D, Motion, MediaPipe Hands, a small Node server |
| Attending | Gemini Live API (`@google/genai`), short-lived tokens, Chrome Web Speech API for the wake phrase |
| HoloLens app (`Assets/`) | Unity 2019.4, C# 7.3, built-in render pipeline, Windows Mixed Reality |

## Try it in two minutes (no headset needed)

```bash
cd vision
npm install
npm run dev          # http://localhost:4747
```

Open `http://localhost:4747/?input=sim` in Chrome for the simulated arm. Space is Next, `K` scans and
annotates, `R` resets, `?` lists every key. With a headset and a Gemini key, copy `vision/.env.example` to
`vision/.env.local`, fill it in, and follow [`docs/MORNING.md`](docs/MORNING.md).

More: [`vision/README.md`](vision/README.md) (the app in detail), [`docs/FACTS.md`](docs/FACTS.md) (what was
measured and how), [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md), [`CLAUDE.md`](CLAUDE.md) (how the repo is organised).

## What is real and what is scripted

Real: the live stream, the tracking of the line (position, direction, scale), the overlays following it, hand
detection, and every Gemini answer. Scripted for this concept: the patient, the "42 mm" (the marker's known
length, which sets the scale), the per-suture spacing and depth read-outs, and the debrief numbers. The screen
says "Training simulator · concept" in every state.

Measured on the build: 60 fps through a full run with 0 slow frames in 3,433, and 96 back-to-back runs over 90
minutes with flat memory (both with a stand-in headset; details in `docs/FACTS.md`).

(The repo, folders and code namespace are still called `scrubin` / `ScrubIn`, the project's working name.)

## Two apps

- **VIPER Vision** (`vision/`): the audience view and the main build. It runs on a Mac, shows the wearer's
  point of view (the HoloLens live stream, a webcam or a recorded video) and draws every overlay and the Gemini
  attending on top. Start here: `vision/README.md`.
- **The HoloLens app** (`Assets/`, Unity 2019.4): a light holographic forearm the wearer aligns to the real
  arm. Everything below is about this app.

## Run the HoloLens app

- **In the Unity editor, no headset:** open the project in Unity 2019.4 and press Play. The Game view shows the
  whole experience from a fixed camera at standing eye height, and every operator key works. Right-drag orbits,
  scroll zooms, `C` resets the view.
- **On a HoloLens (1st gen):** `tools\ship.ps1` builds and installs it; `tools/DEMO_CHECKLIST.md` is the
  demo-day checklist. First-time project setup: `docs/SETUP_WINDOWS.md`.
- **Operator keys:** the table in `CLAUDE.md`. On the headset: the outline follows your gaze; air tap places it.

Requirements: Unity 2019.4 LTS (built-in render pipeline, legacy XR / Windows Mixed Reality), TextMeshPro.

## How it is built

One scene, one GameObject, one component: `ScrubInBootstrap` builds everything from code at Start, so the
scene never changes. Features plug in by implementing `IScrubInModule`. All on-screen text and the step script
come from `Assets/StreamingAssets/procedure.json`. `CLAUDE.md` is the full guide (constraints, ownership, the
shared event contract, the visual kit, the performance budget for rendering on the headset itself).

## Build order

The HoloLens app is done for now (bootstrap, gaze-follow placement, air tap, the forearm hologram) and parked.
VIPER Vision is built in this order:

1. Relay for the HoloLens stream, with webcam, video-file and simulated-arm fallbacks.
2. Wound detection (marker colour + line fit) and the suture targets pinned to it; hand tracking.
3. The stitch flow: plan, per-stitch animation, feedback, score.
4. The Gemini attending: spoken questions, answer cards, tools.
5. Anatomy, danger zone and polish.

## Checking the code without Unity

`tools/check-compile.sh` type-checks every script as C# 7.3 against Unity 2019.4 reference assemblies (see the
header of the script). `python3 tools/gen_meta.py` creates `.meta` files for assets added outside Unity.

## Third-party assets

| Asset | Where | License |
|-------|-------|---------|
| TextMesh Pro essential resources (shaders, settings, default sprite asset) | `Assets/TextMesh Pro/` | Unity Companion License |
| Liberation Sans font (inside the TextMesh Pro resources) | `Assets/TextMesh Pro/Fonts/` | SIL Open Font License 1.1 |

Everything else (shader, meshes, lines, audio) is generated procedurally by the project's own code.
