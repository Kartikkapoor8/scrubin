# tools/ — Windows laptop cheat sheet (VIPER on HoloLens 1)

Run from `C:\dev\scrubin` in PowerShell. Each script starts with `powershell -ExecutionPolicy Bypass -File`
(shortened to `ps` below). Credentials go in `tools\.env.local` (copy `.env.local.example`; Kartik fills in
the Device Portal user/password). It's gitignored and no script prints it.

| I want to… | Command |
|---|---|
| Check the machine (run first when anything breaks) | `ps tools\doctor.ps1` |
| Turn the hotspot on / off / see who's on it | `ps tools\hotspot.ps1 on -FiveGHz` · `off` · `status` |
| Find the HoloLens IP on the hotspot (and save it) | `ps tools\hotspot.ps1 find -Save` |
| Check the link to the headset (latency) | `ps tools\connect-check.ps1` |
| **Pull + build + install + launch on the headset** | `ps tools\ship.ps1` (close Unity first) |
| Build only / deploy only | `ps tools\build.ps1` · `ps tools\deploy.ps1` |
| Reinstall from scratch (only if an update is refused) | `ps tools\deploy.ps1 -Uninstall` |
| Fast loop without a build (if remoting works) | see `tools\REMOTING.md` (Unity → Holographic Emulation) |
| Show the wearer's view full-screen | `ps tools\spectate.ps1` |
| Record a video (holograms + camera + mic) | `ps tools\record.ps1 start` … `ps tools\record.ps1 stop` → `tools\captures\` |
| Check the live stream the Mac app reads | `ps tools\stream-check.ps1` |
| Measure stream delay | open `tools\latency-clock.html` next to the stream (see REMOTING.md) |

**Timings on this laptop:** first full build ~4.5 min, incremental build 2:07, deploy (mock-tested) ~5 s + upload.
Builds always go to `C:\b\scrubin` and are never cleaned (incremental). Each build bumps the package version,
so deploys update in place.

**Wi-Fi trouble on demo day:** plug the HoloLens in by USB and set in `tools\.env.local`:
`HOLOLENS_IP=127.0.0.1:10080` and `HOLOLENS_SCHEME=http`. Deploy, record and spectate then go over the cable.

**Testing scripts without the headset:** `python tools\test\mock_device_portal.py`, then point the scripts at it
(instructions at the top of that file). deploy, record, stream-check and doctor all pass against it.

Unity menus (`ScrubIn ▸ …`): **Setup Project** (one-time), **Apply HoloLens Settings**, **Check HoloLens Settings**,
**Build HoloLens (x86)**.
