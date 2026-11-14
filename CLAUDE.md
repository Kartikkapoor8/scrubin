# ScrubIn — shared brain for all three agents

Read this whole file before writing code. Three people work on this repo with three agents; the rules below are
what keep us from colliding. If you change a shared contract, change this file in the same commit.

## Pitch

ScrubIn is a HoloLens surgical suture trainer. Holograms are aligned onto a real forearm with a marker "laceration"
on it, and the trainee is walked through a laceration repair: the field is scanned, the wound assessed, the anatomy
under the skin revealed, five sutures planned and then placed one by one, and the result scored, with an attending
surgeon card coaching every step. It is a hackathon build for UCSC DevFest 2026 (submissions close Sunday
11:30 AM). The only goal is a beautiful, reliable live demo and demo video on a HoloLens (1st gen). Everything is
scripted for one procedure. Fake whatever needs faking. It must look incredible and never break on stage.

## Demo flow (what the judge sees)

A teammate rests a forearm palm-up on a table. The wearer stands over it. The procedure plays in steps:

| # | Step id | What happens |
|---|---------|--------------|
| 1 | `boot` | Title "ScrubIn · Surgical Training" assembles above the table ("Simulated training · not medical guidance" under it). A horizontal scan plane sweeps down over the arm, tracing glowing contour lines along its outline. |
| 2 | `assess` | Patient card ("Training Patient 01 · Laceration repair · L forearm"), vitals panel (animated ECG, HR 72, BP 118/76, SpO2 98%), dimension lines measuring the wound: "42 mm". |
| 3 | `xray` | A scanline wipe reveals the anatomy: radial and ulnar arteries (red, flow pulses), superficial veins (blue), median nerve (yellow), flexor tendons (white), radius and ulna (faint). Labels with leader lines. A red danger zone pulses around the radial artery. |
| 4 | `plan` | Five numbered suture points appear one by one along the wound. Each has entry and exit dots ~5 mm from the wound edge, a small arc for the needle path entering at 90°, and ~8 mm spacing ticks. |
| 5 | `stitch` | The current target pulses. On trigger (air tap, or operator `S`): a curved needle runs the arc, thread follows, a knot pops, the point turns green with a burst, feedback appears ("Suture 3/5 · spacing 8 mm ✓ · depth ✓"). Repeat for all five. |
| 6 | `complete` | The wound line fades, stitches stay, score card with a radial ring: "5/5 sutures · avg spacing 7.9 mm · time 1:42". |

Throughout: an **Attending** card floats beside the arm (world-locked, never head-locked) and types out the
current instruction. Scripted now; Gemini later (Phase 2). Fallback **virtual patient** mode renders a holographic
forearm on the table and runs the same procedure on it.

## Hard constraints

- **HoloLens 1st gen**: x86, Windows Mixed Reality, legacy built-in XR. **Unity 2019.4 LTS**, built-in render pipeline.
- **C# 7.3 only.** Not allowed: nullable reference types (`string?`), switch expressions, `using var`, ranges and
  indices (`^1`, `a..b`), records, `init`, default interface methods, `??=`, target-typed `new()`, `is not`,
  static local functions. Allowed: tuples, `out var`, `is T x`, local functions, `default` literal, expression bodies.
- **No new packages** unless verified 2019.4-compatible. TextMeshPro is fine. **No MRTK** (the rig does not have it
  unless Kartik says otherwise). No new Input System, no XR Plugin Management, no URP.
- **Scenes are procedural.** Never edit `.unity` YAML by hand and do not add objects to the scene in the editor.
  The scene holds one GameObject with `ScrubInBootstrap`, which builds everything at `Start`.
- **Additive display rules.** Black is invisible on a HoloLens. Use the `ScrubIn/HoloGlow` shader (emissive,
  additive, unlit). Prefer thin glowing lines, rims, points and outlines over bright filled areas; fills wash out
  the real arm and strain the eyes. Text is white or cyan, at least ~1 cm cap height at 0.7 m.
- The arm is 0.6–0.8 m from the eyes. Camera near clip is 0.1 (the bootstrap sets it).
- Budget: under ~150k triangles, 60 fps. Rendering happens on the PC during remoting.
- **Hand input is a bonus, never a dependency.** Air tap and hand position on HL1 are coarse. The keyboard
  operator controls are the guaranteed demo path.
- **Never break the demo path. If something new is flaky, put it behind a toggle that defaults off.**

## Folder ownership

Only write inside your own folder. Ask before touching someone else's.

| Folder | Owner | Contents |
|--------|-------|----------|
| `Assets/ScrubIn/Core/` | Kartik | `ScrubInBootstrap`, `ScrubInContext`, `IScrubInModule`, `ScrubInEvents`, `ProcedureData`, `PatientAlignment`, `OperatorInput`, `DesktopPreviewCamera`; later `ProcedureController`, `HoloInput` |
| `Assets/ScrubIn/Visuals/` | Kartik | `Shaders/HoloGlow.shader`, `Palette`, `HoloMaterials`, `HoloElement`, `LineBuilder`, `TubeBuilder`, `LabelBuilder`, `ForearmShape`, `ArmOutline`; later `ScanSweep`, `SutureSystem`, `Hud`, `TitleSequence`, `ProceduralAudio` |
| `Assets/ScrubIn/Editor/` | Kartik | `ScrubInProjectSetup` (menu **ScrubIn**) |
| `Assets/ScrubIn/Anatomy/` | Teammate A | `ForearmAnatomy` (arteries, veins, nerve, tendons, bones, flow pulses, danger zone, labels), `VirtualArm` skin mesh |
| `Assets/ScrubIn/Attending/` | Teammate B | `AttendingPanel` (typewriter text), `IAttending`, `ScriptedAttending`; later `GeminiAttending` |
| `Assets/StreamingAssets/procedure.json` | SHARED | The step script. Text edits welcome from anyone; schema changes by agreement, additive only. |
| `CLAUDE.md`, `docs/` | SHARED | Keep current. |

## How your code gets run: `IScrubInModule`

Do not edit `ScrubInBootstrap` to hook your feature in. Implement `IScrubInModule` anywhere in your folder:

```csharp
namespace ScrubIn
{
    public class ForearmAnatomy : MonoBehaviour, IScrubInModule
    {
        public void Build(ScrubInContext ctx)
        {
            // Parent your objects under ctx.PatientRoot (patient frame) or ctx.Stage (viewer-facing frame).
            // Subscribe to ScrubInEvents here.
        }
    }
}
```

At startup the bootstrap finds every non-abstract `IScrubInModule` in the assembly (sorted by type name), creates
it (a `MonoBehaviour` module gets its own GameObject under the ScrubIn root; a plain class is `new`ed) and calls
`Build` once, inside a try/catch so one broken module cannot take the demo down. Everything uses namespace
`ScrubIn`. No `.asmdef` files; everything stays in `Assembly-CSharp`.

`ScrubInContext` (also at `ScrubInContext.Current`):

| Field | Meaning |
|-------|---------|
| `Root` | The ScrubIn root transform (world space, identity). |
| `PatientRoot` | The patient frame (below). Anatomy, wound, sutures live here. |
| `Stage` | Sits at the wound, +Z pointing away from the viewer, level with the floor. Re-aimed while alignment is unlocked and when it is locked, then frozen, so cards placed in it are world-locked. HUD cards live here. |
| `AttendingAnchor` | Child of `Stage`: suggested spot and tilt for the Attending card. |
| `Head`, `Camera` | The main camera (driven by the headset). |
| `IsHeadset` | True when an XR device is active. False in the desktop preview. |
| `Procedure` | The loaded `ProcedureData` (from `procedure.json`, with built-in defaults if the file is bad). |

## Patient coordinate frame

Everything anatomical lives under `PatientRoot`. Units are meters.

- **+X** runs wrist (x = 0) to elbow (x = 0.26).
- **+Y** is up. The volar (palm-up) surface faces +Y. **y = 0 is the skin surface at the wound centre**, so
  anatomy is at negative y and the table is at about y = -0.050.
- **+Z** points toward the thumb side (radial side). z = 0 is the midline.
- Forearm ~0.26 m long, elliptical cross-section ~0.065 m wide at the wrist to ~0.085 m at the elbow.
- The wound runs along the volar surface from x = 0.100 to x = 0.142 at z = 0. Sutures sit at
  x = 0.105, 0.113, 0.121, 0.129, 0.137 (8 mm apart), bites 5 mm either side of the wound.
- The radial artery runs on the thumb side, close enough for the danger zone to matter; the suture plan stays clear.

Use `ForearmShape` (Visuals) instead of hard-coding the arm's shape. It is the single source of truth:
`HalfWidth(x)`, `HalfHeight(x)`, `CenterY(x)`, `SurfaceY(x, z)`, `Surface(x, z)`, `SurfaceNormal(x, z)`,
`Below(x, z, depth)` (a point `depth` meters under the skin), `Ring(x, angleRad)`.

**Left or right arm:** Unity's axes are left-handed, so this frame (X wrist to elbow, Y up, Z thumb) physically
matches a **right** forearm lying palm-up. On a left forearm the thumb is on -Z. Open question for Kartik; until
it is settled, build to the frame exactly as written.

## `ScrubInEvents` (shared contract)

Static C# events in `Core/ScrubInEvents.cs`. Subscribe with `+=`; fire only through the `Raise…` helpers (each
listener is called in its own try/catch). The bootstrap clears all subscribers when it starts. Change only by
agreement; additions only.

| Event | Raised by | Meaning |
|-------|-----------|---------|
| `StepChanged(int index, StepData step)` | Core (`ProcedureController`) | The procedure moved to step `index`. |
| `StitchCompleted(int index)` | Visuals (`SutureSystem`) | Suture `index` (0-based) finished its animation. |
| `LayerVisibility(string layer, bool visible)` | Core | A named layer should animate in or out. Raised for every known layer on each step change, and by operator toggles. |
| `AttendingSay(string text)` | Attending (or anyone) | The Attending card should type this line. |
| `AlignmentLocked(bool locked)` | Core (`PatientAlignment`) | The operator locked or unlocked alignment. |

Layer names in use (a step lists the ones that are visible): `title`, `scan`, `patientCard`, `vitals`, `wound`,
`woundDims`, `anatomy`, `dangerZone`, `suturePlan`, `stitches`, `feedback`, `score`. Operator toggles:
`virtualArm`, `hud`. A system owns its layer names; add new ones freely and list them here.

## `procedure.json` schema

`Assets/StreamingAssets/procedure.json`, parsed with `JsonUtility` into `ProcedureData`. All text the judge sees
comes from here, so wording changes never need code changes. Unknown fields are ignored; missing fields fall
back to defaults. Keep it valid JSON (no comments, no trailing commas): if it fails to parse, the built-in
defaults are used and the editor legend shows a warning.

```jsonc
{
  "version": 1,
  "title": "ScrubIn · Surgical Training",
  "disclaimer": "Simulated training · not medical guidance",
  "patient":  { "name": "...", "procedure": "...", "site": "..." },
  "vitals":   { "hr": 72, "bp": "118/76", "spo2": 98 },
  "wound":    { "xStart": 0.100, "xEnd": 0.142, "z": 0.0, "label": "42 mm" },
  "sutures":  { "count": 5, "firstX": 0.105, "spacing": 0.008, "bite": 0.005,
                "measuredSpacingMm": [0, 8.1, 7.8, 7.9, 7.8],
                "feedback": "Suture {n}/{count} · spacing {spacing} mm {ok} · depth {ok}",
                "attendingLines": ["...one per suture..."] },
  "score":    { "summary": "{done}/{count} sutures · avg spacing {avg} mm · time {time}" },
  "steps": [
    { "id": "boot",              // stable id; code switches on this, never on the index
      "title": "Scanning field", // short heading
      "attending": "…",          // the line the Attending card types on entering the step
      "layers": ["title","scan"],// layers visible in this step (all others hide)
      "highlights": [],          // free-form ids a system may emphasize, e.g. "radialArtery"
      "duration": 7.0 }          // seconds before autoplay advances
  ]
}
```

`{ok}` is drawn as a vector check mark by Visuals. Do not type "✓" into text: the default TMP font
(Liberation Sans) only covers Latin-1, so "·", "°" and "±" are fine but "✓" is not.

## Visual kit (Visuals/, use it, don't reinvent it)

- `Palette`: `Cyan` #3FE0FF primary · `White` text · `Green` #4DFFB0 success · `Amber` #FFB547 attention ·
  `Red` #FF4D5E danger and arteries · `Blue` #4D8BFF veins · `Yellow` #FFE14D nerve · `Bone` #E8F0FF
  low-intensity bone and tendon.
- `HoloMaterials`: materials on `ScrubIn/HoloGlow`. `Line`, `Dashed`, `Solid` (fill + fresnel rim, for tubes and
  meshes), `Disc`, `Ring`. Material knobs: `_Color`, `_Intensity`, `_Alpha`, `_Fill`, `_RimStrength`, `_RimPower`,
  `_PulseSpeed`/`_PulseAmount`/`_PulsePhase`, `_Draw` (0..1 trace-on along the line's length),
  `_FlowSpeed`/`_FlowCount`/`_FlowStrength` (bright bands travelling along U, for artery flow),
  `_RevealOn`/`_RevealAxis`/`_RevealPos`/`_RevealBand`/`_RevealGlow` (scan-in wipe along an axis in patient space).
  Property ids are in `HoloProps`.
- `LineBuilder`: `Polyline` and `Segment` (thin camera-facing glow lines), `Dot` (faces the viewer) and `Quad`
  (lies flat on a surface) for `Disc` / `Ring` materials, plus point helpers `Arc` and `Circle`.
- `TubeBuilder`: `CatmullRom` path sampling and `Tube` meshes (U runs along the tube, so flow pulses just work).
- `LabelBuilder`: TMP labels sized by cap height in meters, optional leader line, billboarded to the viewer.
- `HoloElement`: `HoloElement.On(group)` animates everything under an object in and out (`Show(delay)`,
  `Hide()`, `Snap(bool)`; `On(group, true)` makes lines trace themselves on). **Every appearance animates**
  (ease-out, stagger 100–150 ms); nothing pops in.
- Line widths that read well at 0.7 m: 2.5–3 mm for primary contours, 1.5 mm for fine detail.
- Look: cinematic medical sci-fi, clean and confident, never cluttered.

## Operator controls (keyboard on the Windows PC; the guaranteed demo path)

| Key | Action |
|-----|--------|
| `Space` | Next step |
| `→` / `←` | Next / previous step **when alignment is locked**; nudge the patient **when unlocked** |
| `S` | Perform the next stitch |
| `R` | Reset the procedure |
| Arrows | (unlocked) Move PatientRoot 5 mm: `←`/`→` across the wearer's view, `↑`/`↓` away from / toward the wearer. `Shift` = 1 mm |
| `PageUp` / `PageDown` | (unlocked) Move up / down 5 mm. `Shift` = 1 mm |
| `Q` / `E` | (unlocked) Yaw 2° about the wound. `Shift` = 0.5° |
| `Z` / `X` | (unlocked) Roll about the arm's long axis, 2°. `Shift` = 0.5° |
| `1` / `2` | (unlocked) Pitch (elbow up / down), 1°. `Shift` = 0.25° |
| `[` / `]` | (unlocked) Scale the patient frame 1% (fit a bigger or smaller arm) |
| `C` | (unlocked) Re-place the patient 0.7 m in front of and 0.45 m below the head, facing the wearer |
| `L` | Lock / unlock alignment (unlocked shows the outline and axis gizmo; locked hides them) |
| `V` | Toggle virtual arm skin |
| `A` | Autoplay |
| `H` | Hide / show all HUD |
| `G` | Ask the attending (Phase 2) |

Keys repeat when held and speed up after a second. On the HoloLens, air tap = context action (next step, or stitch during `stitch`).
A small operator legend is drawn with IMGUI in the editor Game view only; it never reaches the headset.
Without a headset, the editor runs a **desktop preview**: right-drag orbits, scroll zooms.

## Running it

First time on the Windows machine: see `docs/SETUP_WINDOWS.md` (copy the rig's settings with
`tools\setup-from-rig.ps1`, open in Unity 2019.4, run **ScrubIn ▸ Switch Platform to UWP (HoloLens)** and
**ScrubIn ▸ Setup Project** once).

Every time:
1. On the HoloLens, start **Holographic Remoting Player** and note the IP it shows.
2. Unity: **Window ▸ XR ▸ Holographic Emulation** ▸ Emulation Mode **Remote to Device** ▸ enter the IP ▸ **Connect**
   (wait for the green "Connected").
3. Press **Play** with the Game view focused (the keyboard controls need focus).
4. Align the outline to the real arm, press `L` to lock, then `Space` to run the procedure.

No headset: just press Play. You get the desktop preview with the same keys.

## Working rules

- Work in the build order in `README.md`. After each step: it compiles in Unity 2019.4, commit with a clear
  message, push, and tell your human in 3 lines what to test. Don't go past a step that hasn't been confirmed on
  the headset unless told to.
- If an API might not exist in 2019.4 or on HL1, say so and pick the safer path. Guard device-only APIs
  (`UnityEngine.XR.WSA.*`, `UnityEngine.Windows.Speech.*`) with `#if UNITY_WSA` (it is defined in the editor
  too once the platform is switched to UWP, which remoting needs anyway) and keep a keyboard path for whatever
  they do. The project must still compile with the platform set to Standalone.
- Keep everything data-driven from `procedure.json`.
- Git: `main` only, small commits, `git pull --rebase` before every push. **Always commit the `.meta` file with
  every new asset or folder** (mismatched GUIDs between machines are the usual way a Unity repo breaks). Never
  commit `Library/`, `Temp/`, `*.csproj`, `*.sln`, or `Assets/StreamingAssets/secrets.json`.
- If you create files outside Unity (as an agent on a machine without Unity), run `python3 tools/gen_meta.py`
  to create matching `.meta` files with stable GUIDs.
- Third-party assets: list each one with its license in `README.md`.

## Phase 2 — Gemini attending (not built yet; the seam only)

```csharp
public interface IAttending
{
    void OnStepChanged(StepData step);
    void Ask(string question, Action<string> onAnswer);
}
```

`ScriptedAttending` implements it from `procedure.json` lines. Later `GeminiAttending` calls the Gemini API
(model id configurable, key read from `Assets/StreamingAssets/secrets.json`, which is gitignored:
`{ "geminiApiKey": "...", "geminiModel": "..." }`) with a system prompt ("you are an attending surgeon coaching
a trainee, answer in under 25 words") plus the current step, taking questions from Windows `DictationRecognizer`.
The panel shows answers with the same typewriter effect. It ships behind a toggle that defaults off.
