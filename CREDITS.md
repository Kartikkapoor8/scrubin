# Credits

## HoloLens app (VIPER, Unity)

- **Human body shell (the translucent body):** the **MakeHuman base mesh** (`makehuman/data/3dobjs/base.obj`
  from https://github.com/makehumancommunity/makehuman), released under **CC0 1.0** (public domain dedication)
  in September 2020 by Data Collection AB, Joel Palmius and Jonas Hauquier. Attribution is not required; we give
  it anyway. Converted by `tools/body/make_shell.py` (body group only, arms re-posed to the sides, legs brought
  together, life size 1.75 m, surgical window cut) into `Assets/ScrubIn/Resources/HumanShell.bytes`.
- **Skeleton, muscles, organs inside the shell:** generated procedurally at runtime by
  `Assets/ScrubIn/Body/BodyBuilder.cs`; no third-party model. Stylised, not anatomically exact.
  Simulated training only, not medical guidance.
- **TextMesh Pro essential resources** (`Assets/TextMesh Pro/`): Unity Companion License.
- **Liberation Sans font** (inside the TextMesh Pro resources): SIL Open Font License 1.1.
- **Shaders, meshes, lines:** written for this project (`Assets/ScrubIn/Visuals/`).

See `README.md` for the rest of the project's third-party table.
