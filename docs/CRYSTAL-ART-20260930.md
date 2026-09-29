# Crystal Hollow authored art — 2026-09-30

Sonnet 5.5 built a new family of faceted cave strata, mineral seams, boulders, chasm rims, stalactites and rooted cyan/violet crystal clusters. The runtime layers these around the existing vaulted cave, arch and Prism Vault. It replaces the old scattered spire/pool dressing while preserving the playable bridge, gap, four ore nodes, enemies, grapple anchor, seals and reward.

Compare the [previous ground view](../assets/crystal-hollow-sonnet/previews/before_ground.png) and [previous RTS view](../assets/crystal-hollow-sonnet/previews/before_rts.png) with the [actual-game ground view](../assets/crystal-hollow-sonnet/previews/game_ground.png) and [actual-game RTS view](../assets/crystal-hollow-sonnet/previews/game_rts.png). Sonnet's [ground](../assets/crystal-hollow-sonnet/previews/render_ground.png) and [RTS](../assets/crystal-hollow-sonnet/previews/render_rts.png) renders show its kit in isolation with stand-in game props; judge the playable integration from the Godot captures. This is a targeted material/dressing pass, retaining the old cave's strongest focal structures and dark mood.

`assets/crystal-hollow-sonnet/` holds an editable Blend, deterministic Blender builder, eight textured GLBs, source layout, renders, stats and handoff. `godot/assets/zone_art/crystal_hollow/` is the installed kit. The runtime manifest omits the new central landmark spire because it would overlap the interactive Prism Vault; its GLB remains in the source library. `prepare_runtime_manifest.py` places 67 other instances, moves wall strata slightly forward from the existing shell, and attaches **35** conservative collision proxies to substantial strata, clusters and boulders. The existing cave shell and arch retain their original collision, and the bridge/floor remain authoritative.

The kit has **6,944 unique triangles, 67 placed instances and 24 batched material holders** in the game. All eight GLBs independently rebuilt with byte-identical SHA-256 hashes; texture, UV, material and face-winding checks passed. Native checks passed twelve protected approach positions, four ore nodes and the Prism Vault seals/reward. Whole-world desktop captures measured **595 ground-eye / 637 RTS draw calls**, versus **561 / 604** before this pass. These samples do not establish VR stereo frame timing.

Rebuild and verify from the repository root:

```powershell
& .\tools\blender-4.5.13-windows-x64\blender.exe -b -P assets/crystal-hollow-sonnet/build_crystal.py -- --out work/crystal-rebuild
Copy-Item work/crystal-rebuild/*.glb assets/crystal-hollow-sonnet/source-glbs/
Copy-Item work/crystal-rebuild/*.glb godot/assets/zone_art/crystal_hollow/
Copy-Item work/crystal-rebuild/placement_crystal_hollow.json assets/crystal-hollow-sonnet/
Copy-Item work/crystal-rebuild/stats.json assets/crystal-hollow-sonnet/
python assets/crystal-hollow-sonnet/prepare_runtime_manifest.py
& .\scripts\Verify-ZoneArt.ps1 -Zones crystal_hollow -Render
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://hollow_challenge_checks.gd --quit-after 2400
```

The first Godot render showed much of the new lower strata hidden behind the old cave wall. Moving those art placements inward by about 1.1–1.25 m improved material visibility without blocking route samples. A headset pass is still needed for scale and close collision feel. Relaunch to see this update.
