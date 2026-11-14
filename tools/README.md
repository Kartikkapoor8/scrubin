# tools/ — Windows laptop cheat sheet (VIPER on HoloLens 1)

Open PowerShell (or Command Prompt), `cd C:\dev\scrubin`, then type the commands below. `tools\run <name>` runs
`tools\<name>.ps1` without changing Windows' script policy. Type `tools\run` alone to list the scripts.
Credentials go in `tools\.env.local` (copy `.env.local.example`; Kartik fills in the Device Portal user/password).
It's gitignored and no script prints it.

| I want to… | Command |
|---|---|
| Check the machine (run first when anything breaks) | `tools\run doctor` |
| Turn the hotspot on / off / see who's on it | `tools\run hotspot on -FiveGHz` · `tools\run hotspot off` · `tools\run hotspot` |
| Find the HoloLens IP on the hotspot (and save it) | `tools\run hotspot find -Save` |
| Check the link to the headset (latency) | `tools\run connect-check` |
| **Pull + build + install + launch on the headset** | `tools\run ship` (close Unity first) |
| Build only / deploy only | `tools\run build` · `tools\run deploy` |
| Reinstall from scratch (only if an update is refused) | `tools\run deploy -Uninstall` |
| Fast loop without a build (if remoting works) | see `tools\REMOTING.md` (Unity → Holographic Emulation) |
| Show the wearer's view full-screen | `tools\run spectate` |
| Record a video (holograms + camera + mic, max ~5 min per take) | `tools\run record start` … `tools\run record stop` → `tools\captures\` |
| Check the live stream the Mac app reads | `tools\run stream-check` |
| Measure stream delay | open `tools\latency-clock.html` next to the stream (see REMOTING.md) |

**Timings on this laptop:** first full build ~4.5 min, incremental build 2:07, deploy = upload (22 MB) + a few seconds.
Builds always go to `C:\b\scrubin` and are never cleaned (incremental; the newest 3 packages are kept). Each build
bumps the package version, so deploys update in place.

**Wi-Fi trouble on demo day:** plug the HoloLens in by USB and set in `tools\.env.local`:
`HOLOLENS_IP=127.0.0.1:10080` and `HOLOLENS_SCHEME=http`. Deploy, record and spectate then go over the cable.

**Testing scripts without the headset:** `python tools\test\mock_device_portal.py`, then point the scripts at it
(instructions at the top of that file). deploy, record, stream-check, connect-check and doctor pass against it.

Unity menus (`ScrubIn ▸ …`): **Setup Project** (one-time), **Apply HoloLens Settings**, **Check HoloLens Settings**,
**Build HoloLens (x86)**.
