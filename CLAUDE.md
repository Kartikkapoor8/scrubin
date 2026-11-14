# VIPER — shared brain for every agent on this repo

**VIPER** (Visual Instruction for Procedures & Emergency Repair) is the product's display name. The repo
(`scrubin`), the folders (`Assets/ScrubIn/`), the namespace (`ScrubIn`), class names (`ScrubInBootstrap`, …)
and the shader name (`ScrubIn/HoloGlow`) keep the old name on purpose, so nothing breaks. Do not rename them.

Read this whole file before writing code. If you change a shared contract, change this file in the same commit.

## Scope change (Saturday, about 2 pm): two apps now

The beautiful overlays and Gemini moved **off the HoloLens and onto the Mac**.

1. **HoloLens app (Unity, `Assets/`) is minimal and parked.** It shows a light holographic forearm the wearer
   can see and do pretend surgery on, plus alignment (look at the arm, air tap to place). No HUD panels, no
   Attending panel, no score card, no procedure steps in Unity. The step script, suture animation, HUD and
   anatomy described further down were **not built in Unity** and are not planned there; the anatomy x-ray
   may come back only if it is cheap. Keep it light for the HL1 GPU.
2. **VIPER Vision (`vision/`) is the main build.** A Mac app that shows the wearer's point of view full-screen
   for the audience (the HoloLens Device Portal Mixed Reality Capture live stream, with Mac webcam and
   recorded-video fallbacks) and draws every overlay on top of it: wound tracking, suture targets, the stitch
   flow, anatomy, vitals, score, and a Gemini Live "Attending" that answers spoken questions. It must look
   incredible and never break on stage. See `vision/README.md`.

The marker wound on the real forearm is drawn in a **bright saturated green** (configurable in VIPER Vision),
which is what the Mac tracks. The HoloLens app therefore draws nothing over the wound once the outline is placed.

**Who does what (since Saturday afternoon):**
- **Kartik's agent** (on a Mac with no Unity) writes all the Unity runtime code: Core, Visuals, Anatomy, Attending,
  and `procedure.json`. It compile-checks against the Unity 2019.4 assemblies before every push.
- **The Windows agent** (on the laptop with Unity and the HoloLens) owns `Assets/ScrubIn/Editor/` and `tools/`:
  project settings, builds, deploys, recording, headset tests. It reports results; the Mac agent fixes forward.
- One teammate is on the video and the site. Nobody else writes Unity code, but the folders and the
  `IScrubInModule` hook stay as they are in case someone joins.

## Pitch

VIPER is a HoloLens surgical suture trainer. Holograms are aligned onto a real forearm with a marker "laceration"
on it, and the trainee is walked through a laceration repair: the field is scanned, the wound assessed, the anatomy
under the skin revealed, five sutures planned and then placed one by one, and the result scored, with an attending
surgeon card coaching every step. It is a hackathon build for UCSC DevFest 2026 (submissions close Sunday
11:30 AM). The only goal is a beautiful, reliable live demo and demo video on a HoloLens (1st gen). Everything is
scripted for one procedure. Fake whatever needs faking. It must look incredible and never break on stage.

## Demo flow (what the audience sees, on the VIPER Vision screen)

A teammate rests their **right** forearm palm-up on a table. The wearer stands over it. VIPER Vision plays the
procedure in steps over the wearer's live view:

| # | Step id | What happens |
|---|---------|--------------|
| 1 | `boot` | Title "VIPER" assembles above the table, with "Visual Instruction for Procedures & Emergency Repair" and "Simulated training · not medical guidance" under it. A horizontal scan plane sweeps down over the arm, tracing glowing contour lines along its outline. |
| 2 | `assess` | Patient card ("Training Patient 01 · Laceration repair · R forearm"), vitals panel (animated ECG, HR 72, BP 118/76, SpO2 98%), dimension lines measuring the wound: "42 mm". |
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
- **Performance budget: the HoloLens 1 renders everything itself.** The laptop runs Windows 11 26H2, where
  Windows Mixed Reality was removed, so Holographic Remoting may not work; assume a deployed UWP build on the
  headset's own GPU. That means:
  - 60 fps on the headset. Visible triangles low: aim under ~60k.
  - HL1 is fill-rate limited. No large overlapping transparent or additive areas: thin lines beat big glowing
    fills, and cards are outlines and text, never filled panels.
  - Unlit shaders only (`ScrubIn/HoloGlow` and TextMeshPro's). No post-processing, no real-time lights or shadows.
  - Modest text and particle counts. Disable renderers that are hidden; no per-frame allocations.
  - Settings (owned by the Windows agent): Linear color space, product and package name VIPER, 4x MSAA in the
    editor quality level, no MSAA on the device quality level. Lines must look right without MSAA.
- **Hand input is a bonus, never a dependency.** Air tap and hand position on HL1 are coarse. The keyboard
  operator controls are the guaranteed path in the editor (and on the headset with a Bluetooth keyboard paired);
  everything the demo needs must also be reachable by air tap alone.
- **Never break the demo path. If something new is flaky, put it behind a toggle that defaults off.**

## Folder ownership

Only write inside your own folders. Ask before touching someone else's.

| Folder | Owner | Contents |
|--------|-------|----------|
| `Assets/ScrubIn/Core/` | Mac agent (Kartik) | `ScrubInBootstrap`, `ScrubInContext`, `IScrubInModule`, `ScrubInEvents`, `ProcedureData`, `PatientAlignment`, `OperatorInput`, `HoloInput`, `DesktopPreviewCamera`, `link.xml` |
| `Assets/ScrubIn/Visuals/` | Mac agent (Kartik) | `Shaders/HoloGlow.shader`, `Palette`, `HoloMaterials`, `HoloElement`, `LineBuilder`, `TubeBuilder`, `LabelBuilder`, `ForearmShape`, `ArmOutline` (the holographic forearm) |
| `Assets/ScrubIn/Anatomy/` | Mac agent (Kartik) | Empty. The anatomy x-ray would go here if it comes back. |
| `Assets/ScrubIn/Attending/` | Mac agent (Kartik) | Empty. The Attending now lives in VIPER Vision. |
| `Assets/StreamingAssets/procedure.json` | Mac agent (Kartik) | The step script and every on-screen string. Text edits welcome from anyone; schema changes are additive only. |
| `Assets/ScrubIn/Editor/` | **Windows agent** | `ScrubInProjectSetup.cs` (menu **ScrubIn**), `BuildScript.cs`. The Mac agent does not edit these; the Windows agent extends `ScrubInProjectSetup.cs` when the Mac agent asks (see "Requests for the Windows agent" below). |
| `tools/` | **Windows agent** | Setup, build, deploy, record and checklist scripts. The Mac agent runs `tools/check-compile.sh` and `tools/gen_meta.py` but does not edit anything here. |
| `ProjectSettings/`, `Packages/`, the scene, `Assets/TextMesh Pro/` | **Windows agent** | Pushed from the Windows machine. |
| `vision/` | Mac agent (Kartik) | **VIPER Vision**, the main build: relay, tracking, overlays, Gemini. Its own `README.md`. |
| `CLAUDE.md`, `README.md`, `docs/` | SHARED | Keep current. |

### Requests for the Windows agent

Things the runtime code relies on that live in the Windows agent's files. Keep this list current.

- `ScrubIn/HoloGlow` must be in Graphics ▸ Always Included Shaders (the runtime finds it with `Shader.Find`,
  which only works in a device build if the shader is listed there). `ScrubInProjectSetup` already adds it.
- The TextMeshPro essentials must be imported (`Assets/TextMesh Pro/`); without them every label is hidden.
- UWP capabilities: SpatialPerception, Microphone, InternetClient.
- Managed stripping: `Assets/ScrubIn/Core/link.xml` keeps all of `Assembly-CSharp` (modules are found by
  reflection). Do not raise the stripping level in a way that overrides it.

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

**It is a right forearm.** Unity's axes are left-handed, so this frame (X wrist to elbow, Y up, Z thumb)
physically matches a right forearm lying palm-up, and the demo uses the patient's right arm. There is no mirror
option.

## `ScrubInEvents` (shared contract)

Static C# events in `Core/ScrubInEvents.cs`. Subscribe with `+=`; fire only through the `Raise…` helpers (each
listener is called in its own try/catch). The bootstrap clears all subscribers when it starts. Change only by
agreement; additions only.

| Event | Raised by | Meaning |
|-------|-----------|---------|
| `StepChanged(int index, StepData step)` | (parked: nothing raises it in the minimal app) | The procedure moved to step `index`. |
| `StitchCompleted(int index)` | (parked) | Suture `index` (0-based) finished its animation. |
| `LayerVisibility(string layer, bool visible)` | Core | A named layer should animate in or out. Raised for every known layer on each step change, and by operator toggles. |
| `AttendingSay(string text)` | Attending (or anyone) | The Attending card should type this line. |
| `AlignmentLocked(bool locked)` | Core (`PatientAlignment`) | The operator locked or unlocked alignment. |

Layer names actually used by the minimal app: `holoWound` (operator key `W`). The step layers in
`procedure.json` (`title`, `scan`, `vitals`, `wound`, `anatomy`, `suturePlan`, `stitches`, `score`, …) describe
the procedure VIPER Vision plays; nothing in Unity listens to them now.

## `procedure.json` schema

`Assets/StreamingAssets/procedure.json`, parsed with `JsonUtility` into `ProcedureData`. All text the judge sees
comes from here, so wording changes never need code changes. Unknown fields are ignored; missing fields fall
back to defaults. Keep it valid JSON (no comments, no trailing commas): if it fails to parse, the built-in
defaults are used and the editor legend shows a warning.

```jsonc
{
  "version": 1,
  "title": "VIPER",
  "subtitle": "Visual Instruction for Procedures & Emergency Repair",
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

## HoloLens app controls

On the headset with no keyboard:

- The outline **follows the wearer's gaze** (0.83 m along the line of sight) until it is placed. Look at the
  real arm, or have the patient slide their arm into the outline.
- **Air tap places it.** The guides fade and a quieter cage stays on the arm. After that, taps do nothing, so
  a hand doing pretend surgery in view of the headset cannot disturb it.
- To re-place: restart the app, or pair a Bluetooth keyboard and press `L`. (Press-and-hold to re-place exists
  but is off by default, `options.holdToReposition`, because a hand holding an instrument can look like a held
  press.)

Keyboard (in the Unity editor, or a Bluetooth keyboard paired with the headset):

| Key | Action |
|-----|--------|
| `Enter` | Same as an air tap: place the outline |
| `L` | Lock / unlock (placed / not placed) |
| `C` | Put the outline back in front of the wearer and let it follow their gaze again. In the editor preview it also resets the camera |
| Arrows | (not placed) Move 5 mm: `←`/`→` across the wearer's view, `↑`/`↓` away from / toward the wearer. `Shift` = 1 mm |
| `PageUp` / `PageDown` | (not placed) Move up / down 5 mm. `Shift` = 1 mm |
| `Q` / `E` | (not placed) Yaw 2° about the wound. `Shift` = 0.5° |
| `Z` / `X` | (not placed) Roll about the arm's long axis, 2°. `Shift` = 0.5° |
| `1` / `2` | (not placed) Pitch (elbow up / down), 1°. `Shift` = 0.25° |
| `[` / `]` | (not placed) Scale the patient frame 1% (fit a bigger or smaller arm) |
| `W` | Toggle the hologram wound line (for running with no real arm; off by default, `options.holoWound`) |
| `F1` | Hide the operator legend (editor only) |

Keys repeat when held and speed up after a second. Any nudge stops the gaze-follow. A small operator legend is
drawn with IMGUI in the editor Game view only. Without a headset the editor shows a **fixed camera at standing
eye height looking down at the arm**: right-drag orbits, scroll zooms, `C` resets.

Feature switches live in `procedure.json` under `options` (`followGazeUntilPlaced`, `holdToReposition`,
`focusPoint`, `holoWound`, `holoWoundColor`), so the Windows operator can turn something off without a code change.

## Running it

**VIPER Vision:** `cd vision`, then see `vision/README.md` (it runs on the Mac and takes the HoloLens stream,
the Mac webcam or a recorded video as input).

**The HoloLens app** can be run three ways, in order of how often they are used:

1. **Editor, no headset (the review loop).** Open the project in Unity 2019.4 and press Play. On-device deploys
   are slow, so this is where visuals get reviewed between deploys: a fixed camera at standing eye height looks
   down at the arm, every operator key works, and a thin frame shows what fits in the HoloLens field of view.
   This must always work.
2. **Deployed build on the HoloLens (the demo path).** `tools\ship.ps1` builds and installs it; see
   `tools/DEMO_CHECKLIST.md`. The headset renders everything itself, so the performance budget above applies.
3. **Holographic Remoting (optional, only if it works on the laptop).** `tools/REMOTING.md`.

First-time setup on the Windows machine is in `docs/SETUP_WINDOWS.md`.

## Working rules

- Work in the build order in `README.md`. After each step: it compiles in Unity 2019.4, commit with a clear
  message, push, and tell your human in 3 lines what to test. Do not wait for headset confirmation between
  steps (Kartik's call on Saturday): keep building, and fix forward as headset results come in.
- If an API might not exist in 2019.4 or on HL1, say so and pick the safer path. Guard device-only APIs
  (`UnityEngine.XR.WSA.*`, `UnityEngine.Windows.Speech.*`) with `#if UNITY_WSA` (it is defined in the editor
  too once the platform is switched to UWP, which remoting needs anyway) and keep a keyboard path for whatever
  they do. The project must still compile with the platform set to Standalone.
- Keep everything data-driven from `procedure.json`.
- Git: `main` only, small commits, **`git pull --rebase` before every push** (the Windows machine pushes
  `ProjectSettings/`, the manifest, the scene and its own tools). **Always commit the `.meta` file with
  every new asset or folder** (mismatched GUIDs between machines are the usual way a Unity repo breaks). Never
  commit `Library/`, `Temp/`, `*.csproj`, `*.sln`, or `Assets/StreamingAssets/secrets.json`.
- If you create files outside Unity (as an agent on a machine without Unity), run `python3 tools/gen_meta.py`
  to create matching `.meta` files with stable GUIDs, and `tools/check-compile.sh` to type-check at C# 7.3.
- Third-party assets: list each one with its license in `README.md`.

## Gemini attending: moved to VIPER Vision

The Attending (Gemini Live, spoken questions, answer cards) is built in `vision/`, not in Unity. The seam
below was the Unity plan and is kept only for reference.

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
