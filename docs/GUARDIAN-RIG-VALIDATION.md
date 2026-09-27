# Guardian rig validation

From the project root, run:

```powershell
pwsh -NoProfile -File scripts/check-guardian-rigs.ps1
```

The default run checks every `*_rig.glb` currently present in `work/opus-skeleton-rig-20260926/output`. To check one published variant, add `-Variant mossward`, `-Variant prismwatch`, or `-Variant cinderkeep`. The script ignores variants whose GLB has not been published yet. `-OutputDirectory` can point at another folder of `*_rig.glb` files. An empty match is an error, so a mistyped variant cannot report a false pass.

The runner copies matched GLBs into a disposable project under the Windows temp directory. It imports them using bundled Godot 4.7.2 with `--headless --xr-mode off --audio-driver Dummy`, then runs a GDScript check in that project. It does not open or import assets into the playable `godot/` project, restart the game, contact the service, or use SteamVR. It removes the disposable project afterward. Logs remain in `logs/guardian-rigs-YYYYMMDD-HHMMSS.log`, and elapsed time is recorded in `logs/work-timing.csv`.

Each rig must import as a scene with exactly one `Skeleton3D`, the seven expected anatomical bones, at least seven separate skinned meshes, nonempty geometry and materials, and an overall mesh height between 1.0 and 2.5 metres. Godot can append `_2` to bone names when a mesh has the same name, so the check accepts that suffix. The rig must have nonzero `idle`, `walk`, and `attack` clips. Godot applies each animation at 25%, 50%, and 75% of its duration: the sampled skeleton poses must change within every clip, and walk and attack must differ from idle. The JSON result also reports triangle count, material-bearing surface slots, clip lengths, height, and numeric pose differences. These counts are diagnostic rather than variant-specific gates; new art can change them.

A nonzero exit code or a `failures` entry means the rig needs correction before runtime integration. Read the JSON `GUARDIAN_RIG_RESULT` line and the Godot import errors in the log. Headless checks establish import structure and sampled animation behavior; they do not establish appearance, shield placement, collision behavior, or headset comfort. Review those in a visual preview after structural validation.

## Measured check and recovery evidence, 2026-09-26

Mossward passed: seven bones, seven skinned meshes, 17,092 triangles, 27 material-bearing surface slots, 1.676 m height, and clip lengths of 2.0 s idle, 1.0 s walk, and 1.2 s attack. Sampled pose deltas were 0.2778 idle, 0.4717 walk, and 0.6468 attack within their clips; walk versus idle was 0.4695 and attack versus idle was 1.3961. The successful run took 2.525 s overall (1.788 s import, 0.176 s check). A four-byte malformed GLB failed as expected with `GLB failed to import`, exit code 1, in 2.733 s.

The final three-rig run passed in 2.359 s: Mossward 17,092 triangles/1.676 m, Prismwatch 14,454/1.64 m, and Cinderkeep 18,454/1.56 m. All three have seven skinned meshes, seven bones, and distinct sampled idle/walk/attack poses. The playable project then imported all three GLBs in 3.030 s; `guardian_authored_animation_checks.gd` passed with `assets=3`, and `--guardian-check` passed shield stealing, authored/legacy visibility, physical shatter, and restore. These checks do not replace an in-headset look at material appearance or motion comfort. A headless `--capture-guardian` attempt stalled waiting for a rendered frame; stop only the owned capture process if it stalls. The verified fast path is a graphical Godot call (no `--headless`) with both `--capture-zone=<zone>` and `--capture-guardian=<variant>`, plus an absolute `--capture=<PNG>` destination. Omitting the matching zone produced an empty landscape despite a successful capture. The final in-game captures are `outputs/guardian-mossward-rig.png`, `outputs/guardian-prismwatch-rig.png`, and `outputs/guardian-cinderkeep-rig.png`; each graphical capture took about eight seconds and returned `CAPTURE 0`.

Two setup errors were caught during harness development. An unquoted name in the temporary `project.godot` made Godot reject the project; the `--editor --import` invocation then stayed alive until interrupted after more than 60 s. Quote string values in generated Godot project files and use the exact `--xr-mode off` invocation above. An initial GDScript used the nonexistent `AABB.transformed()` method and failed to parse in 2.685 s; Godot 4.7.2 uses `Transform3D * AABB`. The corrected check passed in the next 2.525 s run. The logs preserve engine diagnostics for future failures.
