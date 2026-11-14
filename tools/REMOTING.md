# Holographic Remoting: the fast loop (Editor renders on the laptop, streams to HoloLens 1)

> This laptop runs Windows 11 26H2. Windows Mixed Reality was removed in 24H2, so remoting may not work here.
> If step 7 fails, use `tools\ship.ps1` (build + deploy) instead.

1. **Headset:** open the **Holographic Remoting Player** app (from the Microsoft Store on the HoloLens). It shows an IP address. Note it.
2. **Laptop hotspot:** Settings → Network & internet → **Mobile hotspot** → Properties **Edit** → Band **5 GHz** (if offered) → Save → turn **Mobile hotspot On**.
3. **Headset Wi-Fi:** join the laptop's hotspot network (name/password shown on that Settings page).
4. **Check:** `tools\connect-check.ps1 -Ip <headset IP>` should show avg < 10 ms and 0% loss.
5. **Code:** `git -C C:\dev\scrubin pull --rebase`, then click into Unity and wait for the recompile spinner to stop.
6. **Unity:** Window → XR → **Holographic Emulation** → Emulation Mode **Remote to Device** → Remote Machine = headset IP → **Connect**.
7. Status should say **Connected**. Press **Play**. The scene appears in the headset.
8. **Firewall:** if Windows asks about Unity, tick **Private networks** → **Allow access**.
9. **Stuck?** Stop Play → Disconnect → restart the Player app on the headset → Connect again.
10. **Laggy?** Lower the Unity Game view resolution, or move closer to the laptop. Remoting needs a strong 5 GHz link.

---

# MRC live stream: for the Mac app (overlays + Gemini)

The HoloLens Device Portal serves what the wearer sees (holograms composited onto the photo/video camera) as a
live fragmented MP4 over HTTPS. The Mac reads it directly from the headset. The Windows laptop is not in the path;
it only provides the hotspot.

**Status:** `TBD` = not yet measured on the real headset. Filled in after the first on-device test.

## Network
- The laptop's **Windows Mobile Hotspot** (`192.168.137.0/24`, laptop = `192.168.137.1`). The HoloLens **and the Mac**
  both join it. Hotspot name/password: Settings → Network & internet → Mobile hotspot on the laptop.
- HoloLens IP on the hotspot: `TBD` (shown in Settings → Network on the headset, or by the Remoting Player).
- Client-to-client traffic (Mac → HoloLens) through the Windows hotspot: `TBD (verify)`.

## URL
```
https://<HOLOLENS_IP>/api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false
```
| Endpoint | Video |
|---|---|
| `/api/holographic/stream/live_high.mp4` (also `live.mp4`) | 1280x720, 30 fps, ~5 Mbit/s |
| `/api/holographic/stream/live_med.mp4` | 854x480, 30 fps, ~2.5 Mbit/s |
| `/api/holographic/stream/live_low.mp4` | 428x240, 15 fps, ~0.6 Mbit/s |

Query parameters (Microsoft Device Portal API reference). If you specify any, the ones you leave out default to `false`:
- `holo=true` composite the holograms
- `pv=true` include the photo/video camera (the real world)
- `mic=true|false` wearer's microphone
- `loopback=true|false` app audio
(`RenderFromCamera`, `vstab`, `vstabbuffer` are HoloLens 2 only. Ignore them.)

## Access
- **HTTPS with a self-signed certificate.** The client must skip verification for this IP only (ffmpeg doesn't
  verify by default; AVFoundation/URLSession needs a delegate that trusts this host).
- **HTTP Basic auth** with the Device Portal user/password. Kartik owns them; they are not in this repo.
  Pass them in the client's auth header or a local config, never in committed code.
- Quick test from the Mac (ffmpeg installed; it prompts nothing, so put the credentials in an env var):
  `ffplay -fflags nobuffer -flags low_delay "https://$DP_USER:$DP_PASS@<HOLOLENS_IP>/api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false"`
- Only one heavy consumer at a time: running the live stream and an MRC recording (`tools\record.ps1`) together
  costs headset frame rate. Plan on one.

## Measured
| What | Value |
|---|---|
| Plays from the Mac over the hotspot | `TBD` |
| Glass-to-Mac delay (live_high) | `TBD` |
| Glass-to-Mac delay (live_low) | `TBD` |
| Headset app frame rate while streaming | `TBD` |
| Holograms visible in the stream when the app runs via remoting (not deployed) | `TBD` |

How delay is measured: open `tools/latency-clock.html` (a big millisecond clock, no dependencies) on the Mac, with the
stream playing next to it. The wearer looks at the clock. Take a screenshot; delay = page clock minus the clock seen
inside the stream. Repeat 3 times and average.

Laptop helpers: `tools\hotspot.ps1 on -FiveGHz` (start hotspot), `tools\hotspot.ps1 find` (prints the HoloLens IP),
`tools\stream-check.ps1` (confirms the stream serves MP4 and measures throughput).
