# Portal kit handoff (Sonnet 5.5, 2026-09-30)

The commission was completed in an isolated folder, then reviewed and
integrated by Codex. This curated folder keeps the editable Blender source,
builder, renders and statistics. The playable art and three shaders are under
`godot/portal_kit/`; `godot/world_zones.gd` attaches the authored kit to all
22 travel gates. `godot/adventure_runtime.gd` invokes its transition effects.
The old solid portal centre is replaced by a nonblocking interaction area.

From the repository root, rebuild with the bundled Blender and copy the
generated GLBs into the game before running a Godot editor import:

```powershell
& 'tools/blender-4.5.13-windows-x64/blender.exe' --background --python 'assets/portal-kit-sonnet/build_portal_kit.py' -- --no-render
Copy-Item 'assets/portal-kit-sonnet/portals/*.glb' 'godot/portal_kit/portals/'
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --editor --xr-mode off --audio-driver Dummy --path godot --import --quit
```

The original commission instructions below refer to its isolated `output/`
layout; use the paths above for the integrated project.

## Deliverables
| Path | What |
|---|---|
| `build_portal_kit.py` | Deterministic Blender 4.5.13 builder (fixed seeds per variant) |
| `portal_kit.blend` | Editable scene, all 7 variants side by side |
| `portals/portal_<variant>.glb` | Self-contained GLBs, one per variant |
| `../../godot/portal_kit/` | Installed `portal_surface.gdshader`, `portal_motes.gdshader`, `portal_mote_draw.gdshader`, `portal_kit.gd` (`class_name PortalKit`) |
| `renders/render_01..04` | Blender: families, seven adjacent hub gates, overhead RTS view, dusk glow close-up |
| `renders/render_05_godot_shader_hub.png` | Real Godot 4.7.2 Forward+ screenshot with the live shader and LOD script |
| `renders/game_hub.png`, `renders/game_overhead.png`, `renders/game_close.png` | Captures from the actual Forge Yard at ground, RTS and near-gate viewpoints |
| `stats.json` | Per-variant triangles, bounds, materials, node lists |

## Rebuild
```
blender -b -P output/build_portal_kit.py -- --no-render          # GLBs, .blend, stats.json
blender -b -P output/build_portal_kit.py -- --no-render --quick  # same, faster
blender -b -P output/build_portal_kit.py                         # also the four renders
```
Run from the folder that contains `output/`. A harmless `RNA_float_set: NodeSocket.default_value not found` line prints at Blender exit; it is uninvestigated and does not affect output.

## Variants and zone mapping
Four distinct silhouette families, three palette/motif re-skins.

| GLB variant | Family / silhouette | Motif | Game zones (see `PortalKit.ZONES`) |
|---|---|---|---|
| orchard | Round arch, mossy stone, roots, vines, leaf canopy, apples, keystone gem | canopy+apples | pinewood_ruins, orchard_highlands |
| mushroom | orchard family | mushroom caps on arch | mushroom_glade, gloamfen |
| quarry | Rectangular lintel, stepped sandstone, gold vein, crossed picks, scaffold | pick+nuggets | sandstone_quarry, forge_yard |
| sky | quarry family, pale stone | cloud wings | sky_garden, cloudbreak_keep |
| kitchen | quarry family, warm stone | copper pots | enchanted_kitchen |
| crystal | Lancet arch, dark slate pillars, crystal crown, floating shards | apex + shards | crystal_hollow, starfall_ridge |
| foundry | Heavy dark square, iron bands, rotating gear, braziers, chains | gear | ember_foundry |

Stone and glow colours are recoloured at runtime from the game's theme table (`PK_Stone_*`, `PK_Glow_*` materials), so one GLB serves several zones.

## Dimensions and budget
Godot axes: X width, Y height, Z depth. Blender `dims_xyz` in `stats.json` lists (width, depth, height).

| Variant | W m | H m | D m | Near tris | Far tris |
|---|---|---|---|---|---|
| orchard | 2.73 | 3.15 | 1.17 | 3175 | 191 |
| quarry | 2.67 | 3.02 | 1.04 | 2578 | 54 |
| crystal | 2.70 | 3.22 | 1.39 | 2121 | 175 |
| foundry | 2.57 | 3.03 | 1.11 | 2414 | 122 |
| mushroom | 2.73 | 3.02 | 1.17 | 3299 | 191 |
| sky | 2.70 | 3.09 | 1.12 | 2698 | 54 |
| kitchen | see `stats.json` | | | | |

All are far below the 15k triangle budget. 3–7 materials each, all procedural. Aperture is about 1.4 m wide by 2.2 m high with a 0.14 m threshold step, centre at Z 1.22 (crystal 1.28). Slight overshoots of the 2.5 x 3.0 x 1.0 m envelope: width about 2.6-2.7 m, sky/orchard/crystal a little over 3.0 m high, crystal 1.39 m deep because of ground shards. Trim `Motif_GroundClusters` and `Motif_FloatShard_*` if the strict envelope matters.

## Node layout (after Godot import)
`portal_<variant>` > `Portal_<Variant>` >
- `Near`: `Base`, `Pillar_L`, `Pillar_R`, `Arch` or `Lintel`, `Arch_Crystals` (crystal), `Motif_*`, `Surface_Near`
- `Far`: `Far_Body`, `Surface_Far` (single ring fan)
- `FX_SurfaceCenter`, `FX_MoteEmitter`, `FX_Light`, `FX_ExitBurst`, `FX_Threshold` (empties)

Motif pieces per family: orchard `Motif_KeystoneGem/Roots/Vines/Canopy/Apples` (mushroom swaps in `Motif_MushroomCaps`); quarry `Motif_GoldVein/Pick/Scaffold/GoldNuggets` (+`Motif_CloudWings` sky, `Motif_CopperPots` kitchen); crystal `Motif_Apex/GroundClusters/FloatShard_1..3` (origins at own centres); foundry `Motif_Gear` (origin at gear centre, spins about Z), `Motif_Braziers`, `Motif_Chains`. Delete or hide a node to adapt a zone.

## Godot integration
1. Copy `godot/portal_kit/` and `portals/` (into `portal_kit/portals/`) to `res://portal_kit/`.
2. `var g := PortalKit.create("crystal_hollow"); parent.add_child(g); g.global_transform = old_gate.global_transform`. The front faces local +Z, toward the player.
3. Keep the game's own trigger proxy. Call `g.play_entrance()` when the player commits and `g.play_exit()` on the destination gate. `g.set_dormant(true)` dims a locked gate.
4. The GLB `PK_Surface_*` material is a placeholder; `PortalKit` overrides it with the `portal_surface.gdshader` ShaderMaterial. Blend, no depth write, no depth or screen texture, so nothing opaque clips the aperture.
5. LOD tiers, checked every 0.25 s: under 16 m full mesh, 18 motes and one shadowless OmniLight3D (range 3.4); 16-42 m mesh only; 42-120 m the `Far` proxy; over 120 m hidden. Exports: `near_distance`, `far_distance`, `cull_distance`, `mote_amount`, `light_energy`, `auto_approach`.
6. Entrance swell: surface bulges 0.16 m toward the player and brightens (also follows camera distance when `auto_approach`). Exit release: a bright ring sweeps centre to rim while 16 motes burst out.

## Verification done
- All 7 GLBs import into Godot 4.7.2 (Forward+, Vulkan) with correct facing and vertex-colour materials; a disposable check project rendered the seven-gate hub with the shaders and `PortalKit` running and no script errors (`renders/render_05_godot_shader_hub.png`).
- In the integrated game, all 22 gates retain nonblocking ray-targetable trigger areas and pass standing capsule sweeps. The authored entrance/exit calls passed the focused variant checks. Full integration passed in 55.201 s.
- The three real-game desktop captures ran at the game's 120 FPS cap with 160, 441 and 61 draw calls respectively. This does not establish headset stereo performance.
- Not verified: a captured frame of the entrance swell or exit burst; VR stereo rendering; particle `visibility_aabb` under real camera motion.
- The Blender renders use compositor glare to approximate emissive bloom; Godot's look depends on the game's WorldEnvironment glow.

## Known limits
- Surface alpha was raised to 0.62 base for RTS legibility. Tune `opacity` in the ShaderMaterial if gates look too solid against dark zones.
- `verify/` is a disposable Godot check project and is not part of the handoff; safe to delete.
