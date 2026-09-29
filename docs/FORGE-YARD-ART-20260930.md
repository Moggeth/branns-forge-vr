# Forge Yard exterior art — 2026-09-30

Sonnet 5.5 designed a seven-asset exterior kit for the home yard: layered grass-and-stone ridges, two planted garden types, flowered path-edge stones and a cordwood/ore rack. The established timber-and-tile forge building, Brann, workstations, interactive props and seven portal gates remain intact. The kit replaces the old ring of giant low-poly backdrop rocks, rather than enclosing the workshop with new collisions.

Compare the [previous ground view](../assets/forge-yard-sonnet/previews/before_ground.png) and [previous RTS view](../assets/forge-yard-sonnet/previews/before_rts.png) with the [actual-game ground view](../assets/forge-yard-sonnet/previews/game_ground.png), [RTS view](../assets/forge-yard-sonnet/previews/game_rts.png) and [portal approach](../assets/forge-yard-sonnet/previews/game_portals.png). Sonnet's own renders in the same source folder show its intended composition using temporary workshop/portal stand-ins; use the Godot views to judge the installed game.

`assets/forge-yard-sonnet/` holds the editable Blender file, deterministic builder, source layout, seven GLBs, stats and renders. `prepare_runtime_manifest.py` converts that layout to `godot/assets/zone_art/forge_yard/placement.json`; Godot loads the seven GLBs alongside it. There are **11,028 unique triangles**, **34 placements**, **24 batched holders** and **11 deliberate collision proxies** on the gardens and supply racks. The ridges and small path stones remain decorative, leaving ten player-sized route samples, the central approach and portal entrances clear. Imported PBR textures occupy five shared material families. The whole-world diagnostic capture sampled **1,014 ground-eye / 1,845 elevated draw calls** with this kit; these are not isolated kit costs or VR stereo frame times.

Run the source rebuild and checks from the repo root:

```powershell
& .\tools\blender-4.5.13-windows-x64\blender.exe -b -P assets/forge-yard-sonnet/build_forge_grounds.py
Copy-Item assets/forge-yard-sonnet/output/*.glb assets/forge-yard-sonnet/source-glbs/
Copy-Item assets/forge-yard-sonnet/output/*.glb godot/assets/zone_art/forge_yard/
python assets/forge-yard-sonnet/prepare_runtime_manifest.py
& .\scripts\Verify-ZoneArt.ps1 -Zones forge_yard -Render
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://forge_yard_art_review.gd --quit-after 2400 -- --world-builder-preview
```

The seven source GLBs rebuilt byte-identically in an isolated folder (**2.043 s**). Final structural validation, Godot import, ten route samples, 24 zone renders and a contact sheet passed together (**24.019 s**); the separate portal/side close views passed in **11.303 s**. The verified Sonnet 5.5 commission took **305.218 s**. The kit needs a headset pass for close scale and actual stereo timing.

The first actual-game capture revealed a pale, nearly white ridge despite the correct Blender render. Blender had exported a default white `COLOR_0` and Sonnet's authored colour in `COLOR_1`; Godot's base material did not use that second set. The source builder now promotes the authored accessor to `COLOR_0`, the manifest requests vertex-colour multiplication, and the validator rejects white-only `COLOR_0` for such kits. Subsequent captures show the intended grass/stone strata. A second focused check caught that nonuniform scale must be applied in asset-local axes *before* yaw; the zone-kit adapter now does that and keeps uniform older manifests unchanged. These are useful import checks for future Blender commissions: inspect the real engine result early, especially when Blender nodes combine textures and vertex colour.
