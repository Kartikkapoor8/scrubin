# ScrubIn demo-day checklist

## Night before / 1 hour before
- [ ] HoloLens charged to 100% (about 2.5 h of use; keep it on the charger until you walk up). Laptop charged, charger in the bag.
- [ ] **Fallback build installed on the headset:** `tools\ship.ps1` with the final code. Launch it once from the HoloLens Start menu to confirm.
- [ ] HoloLens sleep raised: Device Portal (https://<ip>) → **System → Preferences / Power** → sleep/screen timeout = max. On the headset: Settings → System → Power & sleep.
- [ ] Laptop power plan → High performance (admin prompt):
      `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c`
      (if it's missing on this laptop: Settings → System → Power → Power mode → **Best performance**)
- [ ] Notifications muted: Settings → System → Notifications → **Do not disturb On**. Close Discord, Slack, and email.
- [ ] Mobile hotspot ON and the HoloLens already joined (it remembers the network).
- [ ] `tools\doctor.ps1` shows 0 blocking failures; `tools\connect-check.ps1` is green.
- [ ] `tools\spectate.ps1` opened once, cert warning accepted, credentials entered (by Kartik).
- [ ] Demo video already recorded and saved in `tools\captures\` (also upload it to the submission).

## Start the demo in under 60 seconds
1. (0 s) Laptop awake and plugged in. Hotspot on (Settings → Mobile hotspot), Do not disturb on.
2. (10 s) HoloLens on and fitted to the wearer. Confirm it's on the hotspot (Settings → Network).
3. (20 s) `tools\spectate.ps1` → full-screen view for the judges (a few seconds of delay).
4. (30 s) **Primary:** on the headset, Start → **ScrubIn** (the installed build). Air-tap to start.
   **Optional remoting** (only if it was verified working that day): Unity → Holographic Emulation → Connect → Play.
5. (45 s) Wearer begins the suture flow; narrator talks over the spectate screen.
6. If anything hangs: on the headset, bloom → close app → reopen ScrubIn (about 10 s). Don't troubleshoot remoting live.
