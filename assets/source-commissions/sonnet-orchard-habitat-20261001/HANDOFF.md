# Orchard habitat pass — HANDOFF (Sonnet 5.5, 2026-10-01)

Delivered: `orchard_dressing.gd`, `orchard_ground_visual.gdshader`. No helper files, no new meshes, no collision.
**Not run in Godot.** Nothing here was parsed, rendered or measured; the owner should parse both files and capture
the path and riverbank views before accepting. Drop-in over `godot/orchard_dressing.gd` and the ground shader.

## Dressing (`orchard_dressing.gd`)
Main loop, `COUNTS`, rock collision, `_rim_pass`, the `WOODLAND_DRESSING` print and its `instances` total are untouched.
The new work runs after them via `populate_habitat(root, trail, model, scale)` (called at the end of `populate`) and prints
its own `ORCHARD_HABITAT density= tree_base= path_edge= bank=` line. Each pass has its own seed (`_habitat_seed`,
streams 1-6 off `HABITAT_SEED`), so old placements and rock collisions cannot move.

All art goes through `_asset()` + `_emit()` (existing textured families, `source.finish`, chunked MultiMeshes,
`dressing_positions`/`dressing_hidden`, y=0 local). Names start with `Woodland_` (`base_`/`edge_`/`bank_` tags), so
`clear_path()` removes them. `_emit` gained an optional trailing `cull_scale` (default 1.0, so old calls are identical).
Habitat groups use 0.7 and cast no shadows.

1. **Tree bases** (`_tree_base_pass`): reads `orchard_tree_positions` (PackedVector3Array or Array, max 400 trees).
   At most 8 props per tree (5-8 × density, min 2; low 0.47 gives about 3-4). Mix: leaf-litter clusters, tufts, a small
   mossy twig lying tangent to the trunk, an occasional `fern_lady`. Litter sits in 1-2 angular lobes (70 % on the lee
   side of the default wind), not a ring. Nothing is placed within 1.15 m of the trunk. Fruit is not used.
2. **Path shoulders** (`_path_edge_pass`): walks `orchard_trail`. Props go 3.3-5.2 m off the line, outside the existing
   3.1 m `_allowed` exclusion, in noise-driven runs and gaps: small stones (some with a pebble companion), litter,
   tufts, rare ferns and twigs. Hard cap 190 × density (0.47-1.15).
3. **Banks** (`_bank_pass`): with a `landscape_model`, candidates are grid cells where
   `river_distance - river_width*0.5` (the water edge, per `landscape_hydrology.run`) is 0.3-3.6 m. The jittered point is
   re-checked with `_water_margin`: water field ≤ 0.02, margin ≥ 0.45 m from the edge. Families have offset profiles:
   stones/slabs/branches at the waterline, ferns/tufts further back, litter on the dry rim. Two run/gap noises
   concentrate props into stretches. Slabs and branches align to the bank tangent (perpendicular to the `river_distance`
   gradient). Budget `BANK_BUDGET` = 340 at density 1.0, 391 at the 1.15 cap (< 400).
   The bank mask `b` is deliberately not used for rejection, since it may not follow the real rivers.
   Bridge/crossing exclusions are the existing (25,-48) radius and the trail rules.
   `brook_bank(root, center_z)`: with a model it only calls `_bank_pass` if `populate_habitat` has not already set meta
   `orchard_bank_dressed`; with no model it runs the legacy sine unchanged. If `brook_bank` is not called on the real
   path (I found no caller in `godot/*.gd`), banks still appear via `populate`.

Shared safety (`_habitat_ok`): `_allowed("orchard_highlands")`, camp (15,-27) 10.5 m and crossing (25,-48) 6 m
radii, mask path `r` limit, `field_chance(... "grass") > 0` (water and steep rejection, deterministic, no extra RNG).
Loops are bounded: tree cap 400, `guard < 600` per trail segment plus the budget, candidate cells ≤ 161², per-family `target` cap.

Strict typing: Variant reads are annotated (`var tree_at: Vector3 = entry`, `var kind: String = id`, explicit `float` on
match-assigned values). `cells` is `Array[Vector3]`. Please confirm no warning-as-error in the project settings.

## Shader (`orchard_ground_visual.gdshader`)
Every existing uniform is kept (names, defaults, bindings). Three additive colour uniforms: `path_warm`, `path_dust`,
`bank_silt`. Exposure, rain, snow and puddle logic is untouched. Extra cost is two `noise2` calls and no texture reads or loops.
- **Path**: `path_eff = path*path_keep` (lift logic still wins). The `p_core` tread is warm sun-dried earth with dusty
  stretches (`meander`) and compressed grain (`clamp(luma(st)*2.0, .8, 1.2)`), replacing the dark leaf-print. The shoulder
  (`p_shoulder`, peaks mid-transition) gets ragged soil/grass breakup (1 new noise), pale pebbles (reuses `fleck`) and
  dry-leaf scatter (reuses `clump`). The turf-edge dark rim fades inside the core. Faint polished stretches in the core.
- **Banks**: three soft zones: a dew-green moss/clover fringe (`bank_far`), silty mud (`bank_wet`/`bank_silt`), then a
  rounded-pebble gravel lip with a wet-silt rim at the very edge (1 new noise, ragged waterline). Pebbles are filled cell
  interiors from the existing `cells()` call. Dampness now ramps with `smoothstep(.2,.9,m.b)`; it deepens and warms, with
  less darkening (0.24 → 0.2), roughness 0.66 → 0.72 and specular 0.45 → 0.40, so wet earth is satin rather than glossy mud.

## Tuning knobs
`PATH_EDGE_BUDGET`, `BANK_BUDGET`, `HABITAT_CULL`, `TREE_BASE_MAX`; shader `path_warm` / `path_dust` / `bank_silt`.
If the path now reads too light against the previous capture, lower `path_warm` first.

## Verify
Parse both files, then:
- `ORCHARD_HABITAT` counts at low/default/high (bank under 400).
- No habitat props in water, on the bridge or on the tread.
- `clear_path` hides `Woodland_base_/edge_/bank_*`.
- Fresh path and riverbank captures.
