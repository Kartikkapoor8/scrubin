# ScrubIn

A HoloLens surgical suture trainer. Holograms are aligned onto a real forearm and walk a trainee through a
laceration repair: scan the field, assess the wound, see the anatomy under the skin, plan five sutures, place
them one by one, and get scored, with an attending surgeon card coaching each step.

Built at UCSC DevFest 2026.

Simulated training only. Not medical guidance.

## Run it

- **Windows + HoloLens (1st gen):** `docs/SETUP_WINDOWS.md` (one-time setup, then Holographic Remoting).
- **No headset:** open the project in Unity 2019.4 and press Play. A desktop preview shows the same holograms
  (right-drag orbits, scroll zooms).
- **Operator keys:** see the table in `CLAUDE.md`. `L` locks alignment, `Space` advances.

Requirements: Unity 2019.4 LTS (built-in render pipeline, legacy XR / Windows Mixed Reality), TextMeshPro.

## How it is built

One scene, one GameObject, one component: `ScrubInBootstrap` builds everything from code at Start, so the
scene never changes. Features plug in by implementing `IScrubInModule`. All on-screen text and the step script
come from `Assets/StreamingAssets/procedure.json`. `CLAUDE.md` is the full guide (constraints, folder
ownership, the shared event contract, the visual kit).

## Build order

1. Bootstrap, PatientRoot placed in front of the wearer, operator alignment controls, arm contour outline,
   HoloGlow shader. **(built; waiting on a headset test)**
2. ProcedureController reading `procedure.json`, operator next / previous, Attending panel with scripted lines.
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
| TextMesh Pro essential resources (shaders, settings, default sprite asset) | `Assets/TextMesh Pro/` (added by **ScrubIn ▸ Setup Project**) | Unity Companion License |
| Liberation Sans font (inside the TextMesh Pro resources) | `Assets/TextMesh Pro/Fonts/` | SIL Open Font License 1.1 |

Everything else (shader, meshes, lines, audio) is generated procedurally by the project's own code.
