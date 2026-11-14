# VIPER

**Visual Instruction for Procedures & Emergency Repair.** A HoloLens surgical suture trainer: holograms are
aligned onto a real forearm and walk a trainee through a laceration repair. Scan the field, assess the wound,
see the anatomy under the skin, plan five sutures, place them one by one, and get scored, with an attending
surgeon card coaching each step.

Built at UCSC DevFest 2026.

Simulated training only. Not medical guidance.

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
