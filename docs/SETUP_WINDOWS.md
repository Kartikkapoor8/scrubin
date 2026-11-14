# Setting up ScrubIn on the Windows machine

The repo is created on a machine without Unity, so it ships **without** `ProjectSettings/` and
`Packages/manifest.json`. They come from the working rig (`C:\dev\anon-glass`), whose XR, remoting and UWP
settings are already proven on the HoloLens.

## A. With the rig on this machine (recommended, about 5 minutes)

1. Clone: `git clone https://github.com/Kartikkapoor8/scrubin.git C:\dev\ScrubIn`
2. Copy the rig's settings (only `ProjectSettings\` and `Packages\manifest.json`; nothing else is taken):

   ```
   cd C:\dev\ScrubIn
   powershell -ExecutionPolicy Bypass -File tools\setup-from-rig.ps1
   ```

   It prints the rig's Unity version and warns if the rig's package manifest has local `file:` paths or MRTK
   in it. Tell Kartik's agent if it does.
3. Unity Hub ▸ **Add** ▸ pick `C:\dev\ScrubIn` ▸ open it with the **same 2019.4 version** the script printed.
4. In Unity: menu **ScrubIn ▸ Setup Project**. It creates and opens the demo scene (one GameObject with
   `ScrubInBootstrap`), registers it in Build Settings, adds the HoloGlow shader to Always Included Shaders,
   turns on the three UWP capabilities, imports the TextMeshPro essentials, and prints a settings check to the
   Console.
5. Commit what that produced so the team shares it:

   ```
   git add ProjectSettings Packages/manifest.json Assets
   git commit -m "Project settings from the rig, demo scene, TMP essentials"
   git push
   ```

   (`Assets/TextMesh Pro/` is Unity's TextMeshPro resource folder. It is listed in the README's third-party table.)

## B. Without the rig: the exact settings to set by hand

Open the folder with Unity 2019.4 (Hub ▸ Add; if Hub refuses the folder because it has no `ProjectSettings`
yet, start the editor with `Unity.exe -projectPath C:\dev\ScrubIn`). Then:

**File ▸ Build Settings**
- Platform: **Universal Windows Platform** ▸ *Switch Platform*
- Target Device: **HoloLens**
- Architecture: **x86**
- Build Type: **D3D Project**
- Target SDK Version: Latest installed · Minimum Platform Version: 10.0.10240.0
- Visual Studio Version: Latest installed
- Build configuration: Release (only matters for a device build)

**Edit ▸ Project Settings ▸ Player ▸ (UWP tab) ▸ XR Settings**
- **Virtual Reality Supported**: on
- Virtual Reality SDKs: **Windows Mixed Reality** (the only entry)
  - Depth Format: **16-bit depth**
  - Enable Depth Buffer Sharing: **on**
- Stereo Rendering Mode: **Single Pass Instanced**

**Player ▸ Other Settings**
- Scripting Backend: IL2CPP (the only UWP option in 2019.4)
- Api Compatibility Level: **.NET Standard 2.0**
- Color Space: Linear (Gamma also works; just keep it the same on every machine)
- Auto Graphics API: on (Direct3D11)

**Player ▸ Publishing Settings**
- Capabilities: **SpatialPerception**, **Microphone**, **InternetClient**
  (ScrubIn ▸ Setup Project sets these three for you)
- Supported Device Families: **Holographic**

**Project Settings ▸ Quality**
- For the level marked as the editor's default: Anti Aliasing **4x Multi Sampling** (thin glowing lines look much
  cleaner; the PC does the rendering during remoting). V Sync Count: Don't Sync.

**Window ▸ Package Manager**
- TextMeshPro installed (it is part of the default 2019.4 package set).
- No MRTK, no XR Plugin Management, no Input System package.

Then run **ScrubIn ▸ Setup Project** and commit `ProjectSettings/`, `Packages/manifest.json` and `Assets/`.

## Running on the HoloLens (Holographic Remoting)

1. HoloLens: open **Holographic Remoting Player** (the HoloLens 1st gen version from the Store). It shows an IP.
   PC and HoloLens must be on the same network; a phone hotspot is more reliable than venue Wi-Fi.
2. Unity: **Window ▸ XR ▸ Holographic Emulation**
   - Emulation Mode: **Remote to Device**
   - Remote Machine: the HoloLens IP
   - Enable Video: on · Enable Audio: on
   - **Connect**, and wait for the green **Connected**.
3. Press **Play**. Click the Game view once so the keyboard goes to it.
4. The operator legend (top-left of the Game view) should say **HEADSET (WindowsMR)**. If it says
   DESKTOP PREVIEW, the headset is not driving the camera: check the connection and the XR settings above.

No headset? Press Play anyway. The desktop preview shows the same holograms: right-drag orbits, scroll zooms,
and every operator key works.

## Recording

Mixed Reality Capture comes from the HoloLens **Device Portal** (browser ▸ `https://<HoloLens IP>` ▸ Mixed
Reality Capture ▸ Record). Record a 10-second test clip early to confirm it captures the remoted holograms on
your device and that the frame rate holds while recording. See `docs/DEMO_SCRIPT.md` for the shot list.
