# Living Orchard landscape — 2026-09-29

The 320 × 320 m Orchard has one deterministic heightfield and one shared set of derived fields. The old flat Orchard floor is removed. A carved stream, lowlands, hills, banks and steeper edges share their geometry with the Hero's collision and the World Builder's ground selection. Seven live spells now change the same running world: **Sunder**, **Raise Earth**, **Grow Forest**, **Earthen Wall**, **Tree Ring**, **Starfall** and **Crystal Fault**. See [actual tactical-camera captures and controls](TERRAFORMING-SPELLS.md).

## Play

Start the normal launcher and choose **World Builder** with the Hero in VR or on desktop. The strategic window has the same 3D world as the Hero at 65% render scale and 30 fps by default. The seven spell hotkeys are `6`, `7`, `8`, `0`, `Q`, `E` and `R`; controls and costs are in the gallery. Line spells accept a drag or two clicks. The target world state is computed immediately; actual mesh/collision height animates over about 1.1–1.35 s, trees emerge, and Starfall has a 1.25 s warning before impact. The crater and mineable meteor persist. Existing path, bridge, timber and patrol actions remain. F9 opens the World Builder during an ordinary local game. Seed and recipe overrides are `--landscape-seed=<int>` and `--landscape-recipe=gentle_orchard|haunted_woodland|highland|arcane_scar`. Use them for offline evaluation or a fresh save; saved terrain commands only replay against the matching seed and recipe.

The landscape command log is `user://landscape_v1.json` (Godot user data), and the World Builder's settlement ledger is `user://world_builder_v1.json`. Both are bounded, atomically replaced JSON saves. The versioned terrain document contains seed, recipe, ordered parameterised operators, stable operation IDs and a deterministic content hash; it does not contain a giant mesh. Version-one logs migrate on load. `undo_last()` replays from natural terrain. The settlement save pins each magically grown tree's X/Z position, species, scale and rotation, plus meteor locations, remaining veins, star-gems and star-iron. The tree's height is sampled from current ground on reload. Old grove records without placements still load by seed/region. The live checks use offline state; they do not modify a player's saves.

## System boundaries

`landscape_fields.gd` generates the seeded 161 × 161, 2 m lattice using separate broad, hill, ridge, detail and moisture sources with domain warping, authored site masks and recipe parameters. `landscape_hydrology.gd` adds a directed, carved winding main stream and priority-flood drainage/flow accumulation for tributaries. `landscape_operations.gd` validates and composes parameterised height operators with local bounds and replay. `landscape_ecology.gd` registers shared suitability fields and samples deterministic, clustered tree/rock/shrub candidates. All use Orchard-local X/Z metres, `Fields.sample()` and the same model rather than independent location noise.

`landscape_runtime.gd` owns the live model, 25 visual/collision chunks, operation stack, save, dirty-region transitions and conservative player-ground adjustment. A typical 100 m Sunder touches 3 chunks. `landscape_compiler.gd` declares which derived systems a height or vegetation edit invalidates. Hydrology refreshes in a background thread with revision checks, and affected water/ecology/collision/navigation update locally. Water occupies connected source-fed depressions, so a dry Starfall crater does not instantly become a pond. `landscape_reprojection.gd` moves existing Orchard objects to edited ground; `landscape_navigation.gd` routes both workers and Orchard ground enemies around steep ground/water using the crossing. `landscape_spell_dressing.gd` scatters bounded commissioned stones on ridges and luminous crystals on faults. `landscape_debug.gd` exports twelve registered 2D views. Geological meshes are decorative vocabulary; height, drainage, placement and gameplay meaning come from the world model. The seven GLBs and Blender source are in `godot/assets/landscape/` and `assets/source-commissions/opus-landscape-20260929/`; `landscape_asset_library.gd` integrates them as batches and explicitly enables imported vertex colours.

The geology commission used the cleaned Claude CLI child environment with verified personal subscription identity `fauxgrady@gmail.com`, `authMethod: claude.ai`, and session metadata `claude-opus-5-5`; no Anthropic API billing credential was used. The 186.23 s commission delivered editable Blender source and seven GLBs. Godot imported all seven, `landscape_asset_checks.gd` measured 4,394 triangles across the set, and the integrated scene/collider tests passed. The art direction and rebuild details are in the commission handoff alongside its source.

## Inspect, test and recover

From the repository root, use `tools/godot/Godot_v4.7.2-stable_win64_console.exe`:

```powershell
$engine = 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://landscape_debug_checks.gd
& $engine --headless --xr-mode off --audio-driver Dummy --path godot -- --landscape-check
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_checks.gd -- --world-builder-check
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://landscape_spell_checks.gd -- --world-builder-preview
& $engine --xr-mode off --audio-driver Dummy --path godot --script res://landscape_spell_gallery.gd --quit-after 700 -- --world-builder-preview
& $engine --xr-mode off --audio-driver Dummy --path godot --script res://landscape_stress_check.gd -- --world-builder-preview
```

The first command writes `output/landscape-debug/index.html`, 20 seed overview PNGs, a contact sheet, metrics JSON and twelve field images for seed 2000. It checks downhill river direction, bridge proximity, slope, walkable fraction and routes from camp to all six landmarks. The second checks same-world mesh/collider deformation, undo and grove replay. The fourth checks live spell effects, Hero damage, mining and settlement serialization. The fifth refreshes [the screenshot gallery](TERRAFORMING-SPELLS.md) without touching player saves. The sixth is a desktop, graphical two-view 100 m Sunder stress proxy with 24 skeletons; its output is `outputs/landscape-tactical-sunder.png`. Other output/log folders are ignored by Git. A normal launch logs `LANDSCAPE_READY`, `LANDSCAPE_OP` and `LANDSCAPE_SETTLED` with seed, recipe and operation timings; save/load warnings appear in the game log. If a saved experiment is undesirable, prefer using the undo path. To deliberately reset a particular local terrain history, first back up `user://landscape_v1.json`, then remove that file with the game stopped; the next run starts from the seed/recipe's natural map. The World Builder settlement save is separate.

When adding an operator, validate it in `landscape_operations.gd`, give it exact affected bounds and a deterministic replay, then make the World Builder call that same operator. Add a focused module check, a live collider/placement check if relevant, and a new field view if the change affects a registered layer. Do not author a separate visual-only spell. When changing the world lattice, update chunk, water, navigation and reprojection contracts together. Before making expensive texture or GPU features, measure the cost of the current CPU path.

## Measured evidence and limits

On the local RTX 3080 Ti desktop, terrain setup after the indexed-mesh optimization was about 204–208 ms; the final isolated live check reported 204.46 ms. A 100 m Sunder target calculation was 1.33 ms, command dispatch 1.46 ms, and its last combined dirty-chunk/dressing rebuild 8.56 ms. The graphical stress sample reported 24 skeletons, 25 chunks, a 30 fps/65% second view, 16.08 ms 95th-percentile wall frames during the edit and one 35.22 ms maximum frame. Its baseline fps counter was stale immediately after startup, so the measured frame times are more useful than its reported minimum FPS. The final 20-seed field run took 8.91 s, found all six landmark routes on every seed, 98% minimum walkable cells and 0.835 maximum grade. Its overview now shades relief and ecological density to expose variation that the first flat-green contact sheet hid. These are **desktop proxies**; headset stereo comfort and GPU timing still need a Vive Pro 2 playtest. A separate `world_builder_stress_check.gd` desktop run with 24 skeletons and the second view completed at median 120 fps.

After the spell/material/water integration, a repeated graphical Sunder stress run on the same GPU with 24 skeletons and the 30 fps/65% tactical view measured 1.62 ms for the target, 1.77 ms command dispatch, 8.45 ms dirty-chunk geometry, 61.37 ms watershed work on a worker thread, and 19.98 ms main-thread derived/water merge. During the edit, wall-frame p95 was 16.60 ms and maximum 26.80 ms; the latter is a remaining short water-surface rebuild spike. The final 20-seed check took 10.18 s internally with no failed landmark routes. Do not read the noisy immediate-startup FPS minimum as a steady-state rate.

Measured work-step record (seconds, local wall clock unless marked internal):

| Step | Outcome | Seconds |
|---|---|---:|
| Opus 5.5 geology commission | Seven Blender/GLB assets and previews delivered | 186.23 |
| Final nine headless module checks | All pass, including 20 seeds | 13.53 |
| Final 20-seed generation/gallery after overview refinement | All landmarks reachable; no field failures | 8.91 internal |
| Final improved debug-gallery process | Pass | 9.93 |
| Final same-world terrain/collider/grove check | Pass | 9.76 |
| Full World Builder scripted regression | Pass | 4.55 |
| Graphical 24-skeleton/dual-view Sunder stress | Pass | 10.75 |
| Incorrect bare `--world-builder-check` launch | No checker ran; discarded and documented correct command | 73.32 |
| Final live terrain/collider/undo check | Pass, including watershed revision settlement | 12.95 |
| Final spell, meteor mining and settlement JSON check | Pass | 4.85 |
| Final full World Builder regression | Pass | 4.83 |
| Final document schema/round-trip unit check | Pass | 0.19 |
| Final 20-seed generation | Pass | 11.23 process / 10.18 internal |
| Final 24-skeleton dual-view Sunder stress | Pass; 26.80 ms peak wall frame | 7.91 |
| Save-isolated spell-gallery capture | Pass; eight actual-scene JPGs | 9.39 |

This slice does not add caves/overhangs, multiplayer replication, diversion of the authored main river centreline, erosion simulation, settlement-grade flattening, GPU compute or clipmaps. Drainage and local pooling now refresh after height edits, but creating an entirely new river is still future work. Orchard ground enemies and lumberjacks use terrain-aware routing; other-zone agents retain their existing movement. Some earlier hand-placed features are reprojected rather than regenerated from ecology fields. These remain integration boundaries, not hidden claims of completeness.

## Learned fast paths

- A 100 m spell should update only dirty chunks. Rebuilding all 25 chunks during every deformation step was the real cause of a visible hitch; indexed `ArrayMesh` arrays plus cached grid normals reduced three-chunk mesh/collider work to about 2.7 ms in isolation. Reproject dressing less frequently than vertices.
- The first stress run rejected seed `290929`: operation validation had applied a coordinate-range rule to a seed. Seeds now have their own bounded integer validation. Keep schema validation specific to each field.
- Godot's GLB importer kept the Opus stones' vertex colours while disabling their use as albedo, producing chalk-white rocks. `landscape_asset_checks.gd` verifies all seven meshes and the adapter enables colours explicitly.
- A relative `--capture=outputs/...` path failed for Godot screenshots on Windows. Pass an absolute path to capture modes.
- A GDScript parse error can surface as an unrelated `.new()` failure higher up the scene. Read the first `SCRIPT ERROR` in the full log before debugging the caller.
- For the full World Builder regression, launch `--script res://world_builder_checks.gd -- --world-builder-check`. Passing only `--world-builder-check` starts the offline game without the checker; a large `--quit-after` then wastes time before exiting without a result. Verify the `WORLD_BUILDER_RESULT` line, not just exit code.
- The gallery must use `--world-builder-preview`, travel the Hero into Orchard and open the tactical viewport before capturing. The stress checker similarly waits a frame before asserting dual-view; asserting immediately produced a false missing-window failure.
- Priority-flood drainage can mark a newly carved dry crater as a basin. Gate visible water on an existing connected water source; otherwise every meteor impact appears to summon a pond.
- A fixed-height horizon apron covered the Orchard's carved river and Sunder floor with pale polygons. Hide only the Orchard apron in `horizon.gd` (the Forge Yard and Kitchen alias its profile and still need theirs). Fixed eye-height and tactical screenshots, rather than an isolated asset render, exposed the overlap.
