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
