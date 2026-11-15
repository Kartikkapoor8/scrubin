# VIPER: facts for the write-up

Plain facts for the Devpost page. No claims beyond what is listed here. Each number says how and on what it
was measured. "Mock" means the fake HoloLens Device Portal in `vision/dev/mock-hololens.mjs`, not the real
headset. Last updated 2026-11-15 early morning; numbers marked TBD are filled in when they are measured.

## What it is

VIPER (Visual Instruction for Procedures & Emergency Repair) is a surgical suture-training demo built at UCSC
DevFest 2026 (2026-11-14 to 11-15). A trainee wears a HoloLens (1st generation) over a forearm with a 42 mm
"laceration" drawn in green marker. A Mac shows the wearer's point of view to the audience and draws the
guidance on top: wound tracking, measurement, a five-suture plan, per-stitch feedback and a score, with a
Gemini voice attending answering spoken questions. Simulated training on a model; not medical guidance.

## What is built

- **VIPER Vision** (`vision/`, the main build): a Mac web app (TypeScript, Vite, no framework) and a small
  Node server. Canvas 2D for everything pinned to the picture, DOM for the panels.
  - Inputs: the HoloLens Mixed Reality Capture live stream (relayed by the local server), the Mac webcam, a
    recorded video, or a drawn simulated arm. Keys `1` to `4`. A dropped stream holds the last frame, says
    "Reconnecting" and comes back by itself.
  - Wound tracking: colour mask for the marker, connected blobs, a line fit, One Euro filtering. Glowing
    hologram lines in the stream are rejected (ink never glows). Scale comes from the line's known 42 mm.
  - Hand tracking: MediaPipe Hand Landmarker in the page (index fingertip or pinch point; "Aligned" on target).
  - The procedure: Ready, Scan, Assess (42 mm measurement), Anatomy (radial and ulnar arteries, veins, median
    nerve, flexor tendons, a danger zone; a teaching diagram laid out around the wound, not a scan), Plan (five
    simple interrupted sutures, 8 mm apart, 5 mm bites), Stitch (needle, thread and knot animation per suture,
    feedback line), Complete (score card). One state machine, driven by keyboard, clicker, phone remote,
    autoplay and Gemini's tool calls.
  - Gemini attending: Gemini Live (`gemini-3.8-live`, Google's default Live model as of 2026-11-14) opened from
    the page with single-use ephemeral tokens issued by the local server (the API key never reaches the
    browser). Push-to-talk; tool calls for answer cards, highlighting a structure, looking at the current
    picture, reading and moving the procedure. Spoken answers are captioned.
  - Table mode: idle screen, instant reset, presenter keys, a phone remote (`/remote`, PIN, over WebSocket).
  - Latency tools: an adaptive live-edge player (Media Source Extensions), three stream presets, a
    glass-to-glass lag probe (a flashing square found in the headset's picture by correlation), a preset sweep.
  - Recording of the raw stream to MP4 (no re-encoding).
  - Arm mode (backup, off by default, parked unfinished): a three.js exoskeleton that assembles round a bare
    forearm found with MediaPipe hands and the multiclass selfie segmenter. Cut detection and its plan were
    not built.
- **HoloLens app** (`Assets/`, Unity 2019.4, C# 7.3, built-in render pipeline): a holographic body
  generated procedurally at runtime (`Assets/ScrubIn/Body/BodyBuilder.cs`; no third-party model), placed
  with gaze and air tap. It appears in the live stream the Mac shows.
- **Tooling** (`tools/`, Windows): build, deploy, hotspot, stream checks, recording.

## Tech stack

TypeScript 5.6, Vite 8.3, Node 26 (server: `node:http`, `ws` 8.23), MediaPipe Tasks Vision 1.2.3, `@google/genai`
3.3 (Gemini Live, ephemeral tokens), three.js 0.187 (Arm mode only, loaded on demand), Space Grotesk, Inter and
JetBrains Mono (Fontsource), ffmpeg (optional: repackaging and recording), Playwright 1.65 (testing only).
HoloLens app: Unity 2019.4 LTS, TextMesh Pro, Windows Mixed Reality (legacy XR).

Size at the time of writing: about 8,800 lines of TypeScript and 1,700 of CSS in the Mac app, 1,100 in its
server, 1,200 in its test and tooling scripts; 22 C# files (about 4,200 lines) in the HoloLens app; 38 commits.

## Measured

| What | Number | How, on what |
|---|---|---|
| Player buffer behind the newest frame | 90 to 160 ms | Mock, 100 ms fragments, live-edge controller settled (was up to 450 ms before 2026-11-14 evening) |
| Same, with longer fragments | about 0.25 s average (0.1 to 0.47 s) | Mock, about 300 ms fragments |
| Lag probe accuracy | within 10 ms | Self-test with made-up delays of 850, 1730 and 120 ms |
| Glass-to-glass delay, real headset | TBD | `Shift`+`Y` in the morning (per preset) |
| Stream drop mid-run, back to live | 0.1 to 0.2 s | Mock dropping the connection; step and last frame kept |
| Headset unreachable at launch, switch to webcam | 8.3 s, with a banner saying why | App left to choose its input, headset address unanswered |
| Network lost silently: on screen as "Waiting for the headset" | 2.1 s | Mock frozen (no reset sent), banner and drained picture |
| Network back: picture back | 2.2 s after the headset returns | Mock killed, then restarted |
| Gemini unreachable or key rejected | demo unaffected | Procedure and sutures carry on; the attending retries |
| Page reload, picture back | 0.3 to 0.4 s, settings kept | Mid-run reload on the mock |
| 30 resets in a row, then a full run | passes; page elements 274 before, 288 after | `node vision/dev/drills.mjs --only resets`; the full run took 53 s |
| 90 minutes of continuous runs | TBD | `node vision/dev/drills.mjs --soak 90` (memory, CPU, frame rate every minute) |
| Frame rate through a full run | 60 fps in every step; 1 slow frame in 3,425 (the key press that starts autoplay) | `node vision/dev/profile.mjs`, 1920x1080 at 2x, mock headset input, production build, headless Chrome on the Mac; before the wound tracker read only a window: 25 slow frames (0.8%) |
| Wound analysis per video frame | about 1 ms (was about 4 ms) | Same run; only a window round the tracked wound is read back from the GPU |

Not measured on real hardware yet: the HoloLens stream delay, wound tracking and hands on real headset
footage with the holographic body in view, a real Gemini session (no key was on the build Mac overnight).

## Licences and credits

| What | Licence |
|---|---|
| Space Grotesk, Inter, JetBrains Mono (`@fontsource-variable/*`) | SIL Open Font License 1.1 |
| MediaPipe Tasks Vision, Hand Landmarker and selfie multiclass segmenter models | Apache 2.0 |
| `@google/genai` | Apache 2.0 |
| three.js | MIT |
| `ws` | MIT |
| Vite, TypeScript, Playwright (development only) | MIT / Apache 2.0 |
| TextMesh Pro essential resources (HoloLens app) | Unity Companion License |
| Liberation Sans (inside TextMesh Pro) | SIL Open Font License 1.1 |
| Holographic body | Generated by the project's own code; no third-party model |
| Test photos for Arm mode's synthetic clip (not shipped, not in the repo) | Wikimedia Commons "Allergy test on arm.jpg" (CC0); Pixabay 1921036 (Pixabay Content License) |

Gemini is Google's model, used through its public API. No Google logo artwork is used.
