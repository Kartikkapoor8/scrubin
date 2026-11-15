# VIPER: facts for the write-up

Plain facts for the Devpost page. No claims beyond what is listed here. Each number says how and on what it
was measured. "Mock" means the fake HoloLens Device Portal in `vision/dev/mock-hololens.mjs`, not the real
headset. Last updated 2026-11-15 about 05:10; numbers marked TBD are filled in when they are measured.

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
  - The procedure: Ready, Scan, Assess (a dimension line for the marker's known 42 mm, the length that also
    sets the scale), Under the skin (radial and ulnar arteries, a superficial
    vein, the median nerve and a danger zone, drawn in a window round the wound; a teaching diagram laid out
    from the wound, not a scan; the flexor tendons appear only when Gemini is asked to show them), Plan (five
    simple interrupted sutures, 8 mm apart, 5 mm bites), Stitch (needle, thread and knot animation per suture,
    a feedback card), Debrief (sutures, average spacing, depth, time). One state machine, driven by keyboard,
    clicker, phone remote, autoplay and Gemini's tool calls.
  - What is measured and what is scripted: the wound's position, direction and on-screen length are tracked
    live from the marker line; the 42 mm shown is the marker's known length, which turns pixels into
    millimetres. Each suture is placed when the operator presses Next (key, clicker or phone); nothing
    detects the stitch itself, and Gemini's tools only move the procedure along. The spacing and depth shown
    after each suture and on the debrief are the plan's scripted values; the suture count and the time are
    real.
  - Gemini attending: Gemini Live (`gemini-3.8-live`, Google's default Live model as of 2026-11-14) opened from
    the page with single-use ephemeral tokens issued by the local server (the API key never reaches the
    browser). Tool calls for answer cards, highlighting a structure, looking at the current picture, reading
    and moving the procedure. A panel top right labelled "Gemini" shows the question as it is spoken, the
    answer typing out, a waveform for listening, thinking and speaking, and a line of procedure context
    ("Step 5 of 6 · Suture 2 of 5"). Answers are spoken aloud.
  - Hands-free: Chrome's Web Speech API listens for "Hey Gemini", which opens the Live turn with the last
    1.8 s of audio so the question is whole. Push-to-talk on the clicker, `Space` (hold) or `G` as a fallback.
    Nothing is sent to Gemini while it thinks or speaks (Chrome's speech recognition keeps listening for the
    wake phrase; its results are ignored meanwhile).
  - The panels move on one spring (Motion) and share one type scale; green means good, amber caution, red
    danger. The anatomy is drawn only in a window round the wound (the HoloLens app already shows the body).
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

TypeScript 5.9, Vite 8.3, Node 26 (server: `node:http`, `ws` 8.23), MediaPipe Tasks Vision 1.2.3, `@google/genai`
3.3 (Gemini Live, ephemeral tokens), Chrome's Web Speech API (wake phrase), Motion 14.14 (panel springs),
three.js 0.187 (Arm mode only, loaded on demand), Space Grotesk, Inter and
JetBrains Mono (Fontsource), ffmpeg (optional: repackaging and recording), Playwright 1.65 (testing only).
HoloLens app: Unity 2019.4 LTS, TextMesh Pro, Windows Mixed Reality (legacy XR).

Size at 04:00 on demo day: about 9,100 lines of TypeScript and 1,500 of CSS in the Mac app, 1,200 in its
server, 1,900 in its test and tooling scripts; 22 C# files (about 4,200 lines) in the HoloLens app; about 62
commits (`git rev-list --count HEAD` for the final number).

## Measured

| What | Number | How, on what |
|---|---|---|
| Player buffer behind the newest frame | 90 to 160 ms | Mock, 100 ms fragments, live-edge controller settled (was up to 450 ms before 2026-11-14 evening) |
| Same, with longer fragments | about 0.25 s average (0.1 to 0.47 s) | Mock, about 300 ms fragments |
| Lag probe accuracy | within 10 ms | Self-test with made-up delays of 850, 1730 and 120 ms |
| Glass-to-glass delay, real headset | TBD | `Shift`+`Y` in the morning (per preset) |
| Stream drop mid-run, back to live | 0.1 to 0.4 s | Mock dropping the connection; step and last frame kept (four drill runs) |
| Headset unreachable at launch, switch to webcam | 8.2 to 8.4 s, with a banner saying why | App left to choose its input, headset address unanswered. With `?input=hololens` it keeps retrying instead |
| Network lost silently: on screen as "Waiting for the headset" | 2.1 to 2.3 s | Mock frozen (no reset sent), banner and drained picture |
| Network back: picture back | 2.1 to 2.2 s after the headset returns | Mock killed, then restarted |
| Gemini unreachable or key rejected | demo unaffected | Procedure and sutures carry on; the attending retries |
| Page reload, picture back | about 0.3 s, settings kept | Mid-run reload on the mock |
| 30 resets in a row, then a full run | passes; page elements flat across the resets, 14 to 19 more after the full run | `node vision/dev/drills.mjs --only resets`; the full run took 53 s |
| 90 minutes of continuous runs | passes: 96 full runs, no errors; page elements flat (374); JS heap between 20 and 45 MB with no upward trend; Chrome memory 1.35 GB at the start, 1.07 GB at the end; 60 fps throughout | `node vision/dev/drills.mjs --soak 90`, headless Chrome, fake headset, build of 03:18 (the first UI pass); a 60-minute repeat on the final look was running at 05:10 |
| Frame rate through a full run, final look | 60 fps in every step; 0 slow frames in 3,429 (worst 16.8 ms, no long animation frames) | `node vision/dev/profile.mjs`, 1920x1080 at 2x, mock headset input, Gemini panel shown, production build, headless Chrome on the Mac. Before the night's fixes: 25 slow frames (0.8%), worst 183 ms |
| Wound analysis per video frame | about 1 ms (was about 4 ms) | Same run; only a window round the tracked wound is read back from the GPU |

Not measured on real hardware yet: the HoloLens stream delay, wound tracking and hands on real headset
footage with the holographic body in view, and a real Gemini session (no key was on the build Mac overnight;
`node vision/dev/ask.mjs --dry` passes, the real run is the first thing to do once the key is in). The Gemini
panel in the overnight screenshots and B-roll is shown as it looks with a session up (`?panel=1`), not from a
live session.

## Licences and credits

| What | Licence |
|---|---|
| Space Grotesk, Inter, JetBrains Mono (`@fontsource-variable/*`) | SIL Open Font License 1.1 |
| MediaPipe Tasks Vision, Hand Landmarker and selfie multiclass segmenter models | Apache 2.0 |
| `@google/genai` | Apache 2.0 |
| three.js | MIT |
| `ws` | MIT |
| Motion (`motion`) | MIT |
| Vite, TypeScript, Playwright (development only) | MIT / Apache 2.0 |
| TextMesh Pro essential resources (HoloLens app) | Unity Companion License |
| Liberation Sans (inside TextMesh Pro) | SIL Open Font License 1.1 |
| Holographic body | Generated by the project's own code; no third-party model |
| Test photos for Arm mode's synthetic clip (not shipped, not in the repo) | Wikimedia Commons "Allergy test on arm.jpg" (CC0); Pixabay 1921036 (Pixabay Content License) |

Gemini is Google's model, used through its public API. No Google logo artwork is used.
