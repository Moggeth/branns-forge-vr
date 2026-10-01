# Ground and understory refinement — 2026-10-01

Sonnet 5.5 High authored the visual work through three serial, verified personal Claude.ai subscription commissions. Codex coordinated native render critiques, integrated the changes, and repaired terrain/shadow/path contracts. No API billing, save edits, resident-game restarts or new lights.

## Installed

- Shared ground palette: regional color drifts, irregular grass/soil transitions, corrected linear-color contrast and a revised warm loam map. Smaller leaf scale replaces the oversized first revision. Orchard has quieter albedo variation and derivative-filtered fine normal detail.
- `WorldZones.flowers` now delegates to `ground_garden_art.gd`: textured bouquets, grass cushions and seedheads in deterministic drifts, capped at three MultiMeshes / 40 instances per garden. These carry the existing terrain reprojection and path-clearing metadata; they have no collision.
- Retired the old Orchard ground-kit grass and woodland flower clumps. Root/rock/log proximity and bank/litter fields shape the replacement understory; sparse gaps remain. Tree positions now feed the artist's root clustering hook. Rock collision RNG streams remain unchanged.
- Added bounded understory around existing woodland rocks/logs. All placement retains traversal, slope and water exclusions, quality scaling, chunking and distance culling.
- Leaf-only canopy color variation and shadow-only leaf-filtered casters for near TreeKit crowns and authored Orchard crowns. Trunks remain opaque. Wind/viewer uniforms also reach the shadow material. Shared MultiMesh shadow twins are excluded from duplicate terrain reprojection.

The artistic changes are editable directly in the installed GDScript/shaders. Briefs, artist handoffs, verified model/account metadata, the original loam input and deterministic map rebuild script are preserved in `assets/source-commissions/sonnet-ground-refinement-20261001/`. Run `python assets/source-commissions/sonnet-ground-refinement-20261001/make_loam_albedo.py`; it writes `loam_rebuilt.png` beside the script, not over the installed texture. The rebuilt image matched the installed PNG byte-for-byte (SHA-256 `4d37b6a64648a8350854d92d598ffbe25d51e8ec4c8636b56819bcb97e36de74`).

## Verification and measured costs

Run the bundled Godot console with `--headless --xr-mode off --audio-driver Dummy --path godot --script res://<name>.gd` for: `ground_surface_checks`, `ground_kit_art_checks`, `orchard_dressing_fields_checks`, `orchard_exposure_checks`, `tree_kit_forms_checks`, `tree_cutting_checks`, `landscape_reprojection_checks`, and `ground_garden_checks`.

All pass. The garden check proves shared meshes, repeatable placement, bounded batches, root influence and clearing (39 of 39 fixture instances). The reprojection fixture includes a shadow twin and proves the shared instances are processed only once. The tree-cutting fake game needed its missing optional `impact_feedback` property restored; gameplay code was not changed to accommodate the fixture.

Native `environment_art_review.gd -- --world-builder-preview` captures 24 ground/RTS views across all 12 regions in an isolated game. Final output is in ignored `outputs/ground-refine-final/`; baseline and two intermediate reviews are preserved beside it. The first revision was rejected visually for crushed black Pinewood soil and unchanged legacy flowers. The second prompted a final texture-scale/detail revision. Final native capture: 16.693 s, 24 captures, no failures or shader errors. `ground_surface_gpu_check.gd` retained one draw call for each isolated floor.

Same-camera total viewport draw counts (all scene objects and review UI included):

| View | Before | After |
|---|---:|---:|
| Orchard ground | 1155 | 1151 |
| Orchard RTS | 1028 | 1013 |
| Pinewood ground | 360 | 358 |
| Pinewood RTS | 444 | 440 |

Other sampled regions range from unchanged to +7 draws (Kitchen) or small reductions. The standalone surface-kit gate reports 18 props, 12,335 source triangles, 2,247 instances and 243 holders across 12 zones, versus the previous 2,290/257. These counts exclude other foliage systems. Neither draw counts nor screenshot throughput establish headset GPU frame time; HMD comfort and busy combat still require playtesting.

Measured artist runs: 451.721 s, 258.456 s and 47.164 s. First integration gates 4.936 s; seven final regression runs 5.981 s (before repairing the stale tree fixture); tree fixture rerun 1.412 s; garden check 0.394 s; map rebuild 2.881 s. Exact tool timings are recorded in ignored `logs/work-timing.csv`.

## Remaining visual limits

This is a ground/composition/material refinement, not a replacement of every tree or authored region asset. Older flowers baked into regional art can remain, and far-tree LOD shadows retain simpler silhouettes. Broad Orchard clearings still use the existing terrain shape and palette. No global fog/exposure increase was used to conceal the scene.

Relaunch through the normal launcher to load. Existing game and VR sessions were left running.
