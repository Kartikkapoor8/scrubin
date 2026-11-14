# VIPER demo-day checklist (Windows laptop + HoloLens 1 + Mac)

Setup: the HoloLens runs the minimal VIPER app (holographic forearm + alignment). The **Mac app** reads the HoloLens's
live Mixed Reality Capture stream and draws the overlays + Gemini. The laptop provides the hotspot and builds/installs the app.

## Night before / 1 hour before
- [ ] HoloLens charged to 100% (about 2.5 h of use; keep it on the charger until you walk up). Laptop + Mac charged, chargers packed.
- [ ] **Final build installed on the headset:** `tools\run ship` with the final code. Launch it once from the HoloLens Start menu (**VIPER**) to confirm.
- [ ] HoloLens sleep raised: Device Portal (https://<ip>) → **System → Preferences / Power** → sleep/screen timeout = max. On the headset: Settings → System → Power & sleep.
- [ ] Laptop power: Settings → System → Power → Power mode → **Best performance** (or `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c`).
- [ ] Notifications muted on laptop + Mac: Windows Settings → System → Notifications → **Do not disturb On**; Mac: Focus → Do Not Disturb. Close Discord, Slack, email.
- [ ] `tools\run hotspot on -FiveGHz` → the HoloLens **and the Mac** join it (both remember the network after the first time).
- [ ] `tools\run hotspot find -Save` → HoloLens IP saved. `tools\run doctor` shows 0 blocking failures.
- [ ] `tools\run stream-check` is green, and the Mac app shows the stream (delay as measured in `tools\REMOTING.md`).
- [ ] Demo video already recorded (`tools\run record start` / `stop`, from the installed build) and uploaded with the submission.
- [ ] USB cable for the HoloLens in the bag (Wi-Fi fallback: see `tools\README.md`).

## Start the demo in under 60 seconds
1. (0 s) Laptop awake and plugged in: `tools\run hotspot status` says **On** (if not: `tools\run hotspot on`).
2. (10 s) HoloLens on and fitted to the wearer. It rejoins the hotspot by itself (check: `tools\run hotspot status` lists it).
3. (20 s) Mac app running, showing the stream full-screen for the judges.
4. (30 s) On the headset: Start → **VIPER**. Place / align the forearm.
5. (45 s) Wearer starts; narrator talks over the Mac screen.
6. If anything hangs: on the headset, bloom → close VIPER → reopen (about 10 s). If the Mac stream stalls: restart the Mac app; the HoloLens app keeps running.
   Backup screen for judges if the Mac app fails: `tools\run spectate` on the laptop (raw MRC view, no overlays).
