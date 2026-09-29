# Living Orchard landscape — 2026-09-29

The 320 × 320 m Orchard now has one deterministic heightfield and one shared set of derived fields. The old flat Orchard floor is removed. A real carved stream, lowlands, hills, banks and steeper edges share their geometry with the Hero's collision and the World Builder's ground selection. The World Builder can **sunder** a drawn line, **raise earth** at a point, and **grow forest** along a drawn line while the Hero is in the same running world. These are the first three spells in a deliberately bounded vertical slice, not the complete world-editing vocabulary in the design brief.

## Play

Start the normal launcher and choose **World Builder** with the Hero in VR or on desktop. The strategic window has the same 3D world as the Hero at 65% render scale and 30 fps by default. Select **6 Sunder**, **7 Raise Earth**, or **8 Grow Forest**. Sunder and Forest accept a mouse drag across valid Orchard terrain or two clicks; Raise Earth accepts one click. Aether costs are 5, 4 and 3 respectively. The spell's target is computed immediately, then the actual mesh/collision height moves over about 1.1–1.35 s; the generated trees emerge over time. Existing path, bridge, timber, and patrol actions remain. F9 opens the World Builder during an ordinary local game. Seed and recipe overrides are `--landscape-seed=<int>` and `--landscape-recipe=gentle_orchard|haunted_woodland|highland|arcane_scar`. Use them for offline evaluation or a fresh save; saved terrain commands only replay against the matching seed and recipe.

The landscape command log is `user://landscape_v1.json` (Godot user data), and the World Builder's existing settlement ledger is `user://world_builder_v1.json`. Both are bounded, atomically replaced JSON saves. The terrain log contains the seed, recipe and ordered parameterised operators; it does not contain a giant mesh. `undo_last()` replays from natural terrain. The settlement save now pins each magically grown tree's X/Z position, species, scale and rotation, so later terrain edits or a reload cannot silently regenerate a different grove. The tree's height is sampled from current ground on reload. Old grove records without placements still load by seed/region. The live checks use offline state; they do not modify a player's saves.

## System boundaries

`landscape_fields.gd` generates the seeded 161 × 161, 2 m lattice using separate broad, hill, ridge, detail and moisture sources with domain warping, authored site masks and recipe parameters. `landscape_hydrology.gd` adds a directed, carved winding main stream and priority-flood drainage/flow accumulation for tributaries. `landscape_operations.gd` validates and composes parameterised height operators with local bounds and replay. `landscape_ecology.gd` registers shared suitability fields and samples deterministic, clustered tree/rock/shrub candidates. All use Orchard-local X/Z metres, `Fields.sample()` and the same model rather than independent location noise.

`landscape_runtime.gd` owns the live model, 25 visual/collision chunks, operation stack, save, dirty-region transitions and conservative player-ground adjustment. A typical 100 m Sunder touches 3 chunks. `landscape_reprojection.gd` moves existing Orchard objects to the edited surface in the affected region, `landscape_water.gd` builds short water ribbons at the carved channel, and `landscape_navigation.gd` routes lumberjacks around slopes/water using the existing bridge. `landscape_spell_dressing.gd` scatters bounded commissioned stones/rupture forms on new scars and mounds. `landscape_debug.gd` exports twelve registered 2D views. Geological meshes are decorative vocabulary; height, drainage, placement and gameplay meaning come from the world model. The seven GLBs and Blender source are in `godot/assets/landscape/` and `assets/source-commissions/opus-landscape-20260929/`; `landscape_asset_library.gd` integrates them as batches and explicitly enables imported vertex colours.

The geology commission used the cleaned Claude CLI child environment with verified personal subscription identity `fauxgrady@gmail.com`, `authMethod: claude.ai`, and session metadata `claude-opus-5-5`; no Anthropic API billing credential was used. The 186.23 s commission delivered editable Blender source and seven GLBs. Godot imported all seven, `landscape_asset_checks.gd` measured 4,394 triangles across the set, and the integrated scene/collider tests passed. The art direction and rebuild details are in the commission handoff alongside its source.

## Inspect, test and recover

From the repository root, use `tools/godot/Godot_v4.7.2-stable_win64_console.exe`:

```powershell
$engine = 'tools/godot/Godot_v4.7.2-stable_win64_console.exe'
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://landscape_debug_checks.gd
& $engine --headless --xr-mode off --audio-driver Dummy --path godot -- --landscape-check
& $engine --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_checks.gd -- --world-builder-check
& $engine --xr-mode off --audio-driver Dummy --path godot --script res://landscape_stress_check.gd -- --world-builder-preview
```

The first command writes `output/landscape-debug/index.html`, 20 seed overview PNGs, a contact sheet, metrics JSON and twelve field images for seed 2000. It checks downhill river direction, bridge proximity, slope, walkable fraction and routes from camp to all six landmarks. The second checks same-world mesh/collider deformation, undo and grove replay. The fourth is a desktop, graphical two-view 100 m Sunder stress proxy with 24 skeletons; its output is `outputs/landscape-tactical-sunder.png`. These output/log folders are ignored by Git. A normal launch logs `LANDSCAPE_READY`, `LANDSCAPE_OP` and `LANDSCAPE_SETTLED` with seed, recipe and operation timings; save/load warnings appear in the game log. If a saved experiment is undesirable, prefer using the undo path. To deliberately reset a particular local terrain history, first back up `user://landscape_v1.json`, then remove that file with the game stopped; the next run starts from the seed/recipe's natural map. The World Builder settlement save is separate.

When adding an operator, validate it in `landscape_operations.gd`, give it exact affected bounds and a deterministic replay, then make the World Builder call that same operator. Add a focused module check, a live collider/placement check if relevant, and a new field view if the change affects a registered layer. Do not author a separate visual-only spell. When changing the world lattice, update chunk, water, navigation and reprojection contracts together. Before making expensive texture or GPU features, measure the cost of the current CPU path.

## Measured evidence and limits

On the local RTX 3080 Ti desktop, terrain setup after the indexed-mesh optimization was about 204–208 ms; the final isolated live check reported 204.46 ms. A 100 m Sunder target calculation was 1.33 ms, command dispatch 1.46 ms, and its last combined dirty-chunk/dressing rebuild 8.56 ms. The graphical stress sample reported 24 skeletons, 25 chunks, a 30 fps/65% second view, 16.08 ms 95th-percentile wall frames during the edit and one 35.22 ms maximum frame. Its baseline fps counter was stale immediately after startup, so the measured frame times are more useful than its reported minimum FPS. The final 20-seed field run took 8.91 s, found all six landmark routes on every seed, 98% minimum walkable cells and 0.835 maximum grade. Its overview now shades relief and ecological density to expose variation that the first flat-green contact sheet hid. These are **desktop proxies**; headset stereo comfort and GPU timing still need a Vive Pro 2 playtest. A separate `world_builder_stress_check.gd` desktop run with 24 skeletons and the second view completed at median 120 fps.

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

The first slice deliberately does not add caves/overhangs, multiplayer replication, dynamic watershed rerouting after spells, river diversion, erosion simulation, settlement-grade flattening, GPU compute or clipmaps. The water ribbon is rebuilt locally, but the authored river centreline and drainage graph are not yet re-solved when a new ridge blocks them. Lumberjacks use the topology-aware route adapter; other enemy AI remains on its existing movement system. Some earlier hand-placed features are reprojected rather than regenerated from the new ecology fields. These are the next integration boundaries, not hidden claims of completeness.

## Learned fast paths

- A 100 m spell should update only dirty chunks. Rebuilding all 25 chunks during every deformation step was the real cause of a visible hitch; indexed `ArrayMesh` arrays plus cached grid normals reduced three-chunk mesh/collider work to about 2.7 ms in isolation. Reproject dressing less frequently than vertices.
- The first stress run rejected seed `290929`: operation validation had applied a coordinate-range rule to a seed. Seeds now have their own bounded integer validation. Keep schema validation specific to each field.
- Godot's GLB importer kept the Opus stones' vertex colours while disabling their use as albedo, producing chalk-white rocks. `landscape_asset_checks.gd` verifies all seven meshes and the adapter enables colours explicitly.
- A relative `--capture=outputs/...` path failed for Godot screenshots on Windows. Pass an absolute path to capture modes.
- A GDScript parse error can surface as an unrelated `.new()` failure higher up the scene. Read the first `SCRIPT ERROR` in the full log before debugging the caller.
- For the full World Builder regression, launch `--script res://world_builder_checks.gd -- --world-builder-check`. Passing only `--world-builder-check` starts the offline game without the checker; a large `--quit-after` then wastes time before exiting without a result. Verify the `WORLD_BUILDER_RESULT` line, not just exit code.
