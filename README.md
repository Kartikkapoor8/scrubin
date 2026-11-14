# VIPER

**Visual Instruction for Procedures & Emergency Repair.** A HoloLens surgical suture trainer: holograms are
aligned onto a real forearm and walk a trainee through a laceration repair. Scan the field, assess the wound,
see the anatomy under the skin, plan five sutures, place them one by one, and get scored, with an attending
surgeon card coaching each step.

Built at UCSC DevFest 2026.

Simulated training only. Not medical guidance.

(The repo, folders and code namespace are still called `scrubin` / `ScrubIn`, the project's working name.)

## Run it

- **In the Unity editor, no headset:** open the project in Unity 2019.4 and press Play. The Game view shows the
  whole experience from a fixed camera at standing eye height, and every operator key works. Right-drag orbits,
  scroll zooms, `C` resets the view.
- **On a HoloLens (1st gen):** `tools\ship.ps1` builds and installs it; `tools/DEMO_CHECKLIST.md` is the
  demo-day checklist. First-time project setup: `docs/SETUP_WINDOWS.md`.
- **Operator keys:** the table in `CLAUDE.md`. On the headset: air tap places the outline, starts the
  procedure, places each suture and advances.

Requirements: Unity 2019.4 LTS (built-in render pipeline, legacy XR / Windows Mixed Reality), TextMeshPro.

## How it is built

One scene, one GameObject, one component: `ScrubInBootstrap` builds everything from code at Start, so the
scene never changes. Features plug in by implementing `IScrubInModule`. All on-screen text and the step script
come from `Assets/StreamingAssets/procedure.json`. `CLAUDE.md` is the full guide (constraints, ownership, the
shared event contract, the visual kit, the performance budget for rendering on the headset itself).

## Build order

1. Bootstrap, PatientRoot placed in front of the wearer, operator alignment controls, arm contour outline,
   HoloGlow shader.
2. ProcedureController reading `procedure.json`, operator next / previous, air tap, Attending panel with
   scripted lines.
3. Plan + Stitch: the full suture animation, feedback text, procedural audio.
4. X-ray: procedural anatomy, reveal wipe, flow pulses, labels, danger zone.
5. Boot title and scan sweep, Assess HUD (patient card, ECG and vitals, wound dimensions), Complete score card.
6. Autoplay demo mode; virtual patient mode.
7. Stretch: hand-proximity "Aligned" feedback, voice keywords, grape mode.

## Checking the code without Unity

`tools/check-compile.sh` type-checks every script as C# 7.3 against Unity 2019.4 reference assemblies (see the
header of the script). `python3 tools/gen_meta.py` creates `.meta` files for assets added outside Unity.

## Third-party assets

| Asset | Where | License |
|-------|-------|---------|
| TextMesh Pro essential resources (shaders, settings, default sprite asset) | `Assets/TextMesh Pro/` | Unity Companion License |
| Liberation Sans font (inside the TextMesh Pro resources) | `Assets/TextMesh Pro/Fonts/` | SIL Open Font License 1.1 |

Everything else (shader, meshes, lines, audio) is generated procedurally by the project's own code.
