# Variant C — 2D-reference-guided orchard brook (Opus 5.5)

## Integration correction (Codex, 2026-09-28)

The portable script now reads the repository's shared benchmark and orchard GLBs, and the terrain spec states its Gaussian coefficient (1.0) and that negative hills already carve the stream (no second implicit carve). The 2.9 m brook exclusion is for planting; its 15 deliberately placed shoreline boulders are tagged as exempt by role, while route and bridge clearance remain hard checks. Two scaled cliff outcrop origins sit 0.6 m below terrain as intentional embed. The Blender asset was reimported, and the same world spec now compiles in the shared Godot scene builder. These are explicit representation corrections, not a replacement layout.

## Rebuild (≈5 s build+export+render, ≈0.6 s validation, measured 2026-09-28)
```
blender -b --factory-startup -P experiments/visual-2d3d-20260928/variants/C/build_scene.py -- --render
blender -b --factory-startup -P experiments/visual-2d3d-20260928/variants/C/validate.py
```
Blender 4.5.13, EEVEE, seed 20260928, fully deterministic. No model/API call. The builder
reads only `input/benchmark.json` and `input/orchard/*.glb`; all plan coordinates are written in
the builder (read by eye from the two images).

## Deliverables (output/)
`build_scene.py`, `validate.py`, `scene.blend`, `scene.glb` (6.5 MB), `world_spec.json` (v1 +
`c_*` namespaced extras), `validation.json` (all 21 checks OK), `renders/` (overhead,
approach, crossing, landmark, reverse + `unfamiliar_reverse_low`).

## Dimensions
- Terrain 80 × 80 m, 0.5 m grid, Gaussian hills `amp*exp(-(d/r)^2)` (formula in
  `terrain.c_falloff`); 15 landform hills + 35 negative hills (-0.63, r 3.5, 3 m spacing) carving a
  ≈1.3 m brook trench. Elevation range -1.3 … +4 m (edge shoulders).
- Brook: `width_m` 4.5, water plane y = -0.9; visible water ≈4.9 m.
- Bridge: centre (0.10, -0.35), 0.36 m from origin; length 10 m, clear walk width 3.4 m between
  parapets (outer 4.4 m); `yaw_rad` 2.5288 = atan2(dx,dz) of its long axis, equal to the path
  segment between its two ends (`crossing.c_ends_xz`, both in `path_xz`). Deck rises 0.55 m.
- Route: 16 vertices spawn (-30,29) → bridge → goal (24,-27); 3.6 m dirt lane; max grade off-bridge
  0.15 (limit 0.24); single path/stream intersection; no non-surface object within 1.2 m +
  footprint of the centreline; no mature canopy overhanging the lane.
- Beacon: 3-tier stone dais r 3.4 m, pedestal, emissive magenta orb at +2.4 m, four broken
  monoliths (2.6–5.4 m) and a broken ring of library walls (r 6.8 m) open to the SW arrival.

## Asset counts (262 library placements, all allowed IDs)
apple_tree_mature 45, apple_tree_mature_b 33, apple_tree_young 39, apple_tree_mature_autumn 7,
hedge_dense 45, shrub_flowering 11, rock_mossy 17, rock_mossy_small 18, rubble_split 6,
wall_straight 8, wall_end_broken 6, wall_corner_broken 2, mountain_cliff_chunk 2 (scale 0.1,
corner outcrops), path_straight 23 (`role:"surface"`, `interactive:false`, skipped on the bridge and dais).
Procedural (in `c_procedural`): terrain, water, bridge, beacon. Re-import: 668 mesh objects,
126 unique meshes, ≈957k triangles (full-LOD trees; Godot should use the `_lod1` variants for distance).

## Image → 3D decisions
- **Top-down map was authoritative.** Stream centreline, route S-curve, crossing position, two
  sandy clearings (NW, SE) plus small satellites, tree-cluster layout (NW, N, E, SE, SW/S) and
  lone trees were sampled at 1254 px → 80 m. Map spawn (-31.7,31.1) and ruin (29.2,-29.8)
  were snapped to the benchmark spawn/goal; the NE leg was compressed accordingly.
- Clearings became low sandy mounds (1.3–1.4 m) — gives the "mild elevation" and readable
  landmarks in first person without breaking grade.
- Map says "ravine" only by the brief; I added woodland shoulders at the edges and a real trench,
  so the stream sits below the banks rather than painted on flat ground.
- **Board panels 2–4** set the bridge style: timber deck between mossy square-block stone
  parapets with end posts and a low arch; the stone monoliths + glowing magenta orb on a stepped
  dais; mossy boulders lining both banks; low broken field walls beside the lane.
- Board contradictions resolved toward the map: the board's wooden fences and the approach views'
  lane-straight-to-ruin line of sight were dropped; the aerial panel's bridge perpendicular to
  the stream was replaced by the map's oblique crossing (bridge follows route direction, ≈75° to
  the stream, length increased to 10 m to cover it).
- Route-side undergrowth kept ≥3 m off the lane; walls/rubble placed as fallen field boundaries.

## View evidence (reviewed in-session, corrections applied)
1. First pass: sky rendered grey-dark; beacon monolith sat in the SW entry, hiding the orb in
   *landmark*; reverse camera looked through a wall; my unfamiliar camera sat inside a mound.
2. Found trench bug: arc-length resampling of the smoothed stream produced 0.6 m hill spacing,
   so the bridge end sat at -1.05 m (grade 0.66). Fixed resampler → grade 0.15.
3. Edge shoulder hills lifted the stream bed above water at x≈±30 (dry dark trench in overhead);
   moved hills. Cliff outcrops moved inward to keep the GLB inside ≈ ±43 m.
4. Final renders: overhead matches the map composition; approach shows lane, walls and distant
   beacon; crossing shows bridge and beacon on axis; landmark frames orb between monoliths;
   reverse reads the dais with lane leading back to the valley; unfamiliar NW-mound view shows
   the bridge side-on, the trench and the parapets.

## Remaining issues
- Path tiles read as stepping-stone slabs on the dirt lane rather than seamless dirt, and clip
  slightly on curves/slopes (flat 4 m tiles on a heightfield).
- Monoliths and dais are plain boxes/cylinders — silhouette is clear but less detailed than the
  board's carved pillars; no fence, grass blades, flowers-on-ground or water foam yet.
- Terrain edges are visible from low, outward angles (no skirt beyond 80 m); water ribbon stops
  at ±41 m where the trench shallows to -0.9.
- Trench is expressed as 35 negative hills; a Godot compiler must support negative amplitudes and
  the stated falloff formula, else the brook will not sit in a channel.
- Triangle budget ~957k (unverified in headset); Godot LOD selection unknown.
- Validation clearance uses approximate asset footprints, not collision meshes.
