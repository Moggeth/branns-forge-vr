# Handoff — impact / targeting art (claude-sonnet-5-5)

Base dir: `work/sonnet-impact-art-finish-20261001/`

## Delivered files
- `output/surface_impact_art.gd` — byte-identical copy of `input/surface_impact_art.gd` (unchanged).
- `output/world_builder_targeting_art.gd` — input module plus the three changes below.
- `check/` — disposable isolated check project (fake game, `static_check.gd`); not a deliverable.

## Changes to world_builder_targeting_art.gd
1. `DEFAULTS.path` 2.0 -> 4.0 (fallback only; live width still comes from `footprint.width`).
2. Path soft outer paint corridor: read from `footprint.paint_width` (fallback `PATH_PAINT_DEFAULT = 9.0` only if the key is missing). Two side bands from the true path edge (`width/2`) out to `paint_width/2`, alpha 0.16 -> 0 on the mix surface. Corridor is skipped if `paint_width <= width`. The pre-first-point anchor also shows a very faint paint-width gauge ring.
3. `tree_positions` (Orchard-local Vector3s, forest/ring, read from `state` or `state.footprint`, non-finite entries dropped, hard cap 30):
   - forest: sprout glyphs at the exact positions; size/alpha still ramp by projection along the drawn line; chevrons kept. Falls back to the old invented placement if absent.
   - ring: circular band, gateway, posts and stars unchanged; the 24 invented sprouts are replaced by the exact positions, each facing outward from the ring centre. Falls back to the old 24 if absent.
   - Cache key now includes a hash of `tree_positions`, so a changed tree set rebuilds.
   - Glyph heights use the same `_pt()` -> `landscape.height_at()` sampling as every other vertex.
   - Other state/API unchanged.

## Visual rationale
Path: the crisp gold edge lines mark the actual 4 m walkable path; the faint corridor communicates the wider 9 m ground-paint that will change, without competing with the edge. Trees: showing the ecology's real candidate positions means the ghost matches the cast; the ring stays a clean circle of gold/violet bands.

## Budgets (measured in headless check, fake terrain)
- Meshes: 2 surfaces max (target <= 2), <= 4000 triangles (target). Measured: path 720, forest 580, ring 1616 tris.
- Height samples per rebuild: ~400-1500 (cached per position within a rebuild). Rebuild 1-3 ms, throttled to 33 ms while the cursor drags.
- Glyph cap 30 trees x 3 kites = 90 tris.

## Truly verified
- Native Godot 4.7.2 headless run in an isolated project: both modules parse and load; `world_builder_targeting_art.gd` built meshes with no errors or warnings for path (with and without `paint_width`, and start stage), forest and ring (with and without `tree_positions`).
- Impact module: only preloaded and instantiated (parse/compile); it is unchanged and its behaviour was not re-tested.
- NOT verified: any rendered image, real terrain, real `world_builder_targeting.gd`/Ecology integration, GPU shaders, VR. Root should integrate and capture.
