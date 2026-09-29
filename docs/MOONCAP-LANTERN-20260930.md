# Mooncap Lantern visual refinement

Mooncap Lantern now loads a Sonnet 5.5-authored mushroom lantern in place of the procedural stick and cage. Its veined, scalloped cap shades a ring of tapered blue gills; aged brass, textured wood and a wrapped grip keep the object legible close to the player's hand. The existing carried light and six-second slowing-spore garden remain gameplay-owned. The model uses one `LightAnchor` to place one short-range, shadowless runtime light. A procedural fallback remains if the GLB is unavailable.

Review the [first Godot frame](../assets/mooncap-lantern-sonnet/previews/game_first_pass.png) and [refined Godot frame](../assets/mooncap-lantern-sonnet/previews/game_refined.png). The [three-quarter render](../assets/mooncap-lantern-sonnet/preview_threequarter.png) and [close-up](../assets/mooncap-lantern-sonnet/preview_closeup.png) are artist references; the Godot frame shows the actual held model under Forge Yard lighting. The model has 4,812 triangles, six material families, 14 mesh nodes, a 0.394 m width and a 0.860 m height. The one real light remains bounded and shadowless; the cap and gills use opaque emissive materials to avoid transparent sorting in VR.

The editable Blend, deterministic Blender builder, self-contained GLB, stats, renders and Sonnet handoff live in [`assets/mooncap-lantern-sonnet/`](../assets/mooncap-lantern-sonnet/HANDOFF.md). The installed asset and Godot-imported textures live in `godot/weapons/`. Rebuild from the repository root with:

```powershell
& './tools/blender-4.5.13-windows-x64/blender.exe' --background --factory-startup --python-exit-code 2 --python 'assets/mooncap-lantern-sonnet/build_mooncap_lantern.py'
Copy-Item -LiteralPath 'assets/mooncap-lantern-sonnet/mooncap_lantern.glb' -Destination 'godot/weapons/mooncap_lantern.glb'
& './tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --editor --xr-mode off --audio-driver Dummy --path godot --quit
& './tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://mooncap_art_checks.gd
```

The independent Blender rebuild took **1.892 s** and produced a byte-identical GLB. Godot editor import took about **4.15 s**. The focused authored-art and spore-action check passed in about **7.98 s**; the actual-game desktop capture took about **10.98 s**. Two verified Sonnet 5.5 commissions took **87.228 s** and **120.798 s**. The first model imported and worked but looked too plain in the actual game: a smooth lilac cap, bright rectangular gills and a dark club-like handle. The second commission used that Godot capture as the critique and improved all three. The lesson is to ask for a usable first artifact quickly, then refine from the actual held game frame; Blender renders alone conceal lighting, hand-scale and material problems.

The full native/service integration run passed in **63.842 s**, including workshop delivery, Siegebird and the live collection path. All seven service unit tests passed in **0.263 s** wall time.

This was visually inspected in desktop first-person mode, not through the headset. A running game requires a normal relaunch to load the new GLB. The cap is still stylized rather than photoreal; the gill brightness and hand feel should be checked in VR before any further tuning.
