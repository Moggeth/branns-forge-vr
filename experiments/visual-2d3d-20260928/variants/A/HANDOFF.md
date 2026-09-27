# Variant A: Opus direct 3D baseline from the written brief (Orchard Brook)

No 2D planning or reference imagery was made or looked at. The inputs were `input/benchmark.json`, `input/CONTRACT.md`, the written task and the 23 orchard GLBs, which were only measured for their bounds and triangle counts.

## Rebuild
```
cd <repo root>
<blender 4.5.13> -b --factory-startup -P experiments/visual-2d3d-20260928/variants/A/build_scene.py
<blender 4.5.13> -b --factory-startup -P experiments/visual-2d3d-20260928/variants/A/build_scene.py -- --no-render
<blender 4.5.13> -b --factory-startup -P experiments/visual-2d3d-20260928/variants/A/validate_glb.py
```
The builder is seeded with `SEED = 20260928`. I ran it twice and got an identical `world_spec.json` both times, apart from the `provenance` timings.

**Measured times** (Blender 4.5.13, this machine):
- Build and export: 1.4 s.
- Six Eevee renders: 5.6 s.
- Total: 6.9 s.
- My authoring time, from reading the brief to the final validated output, was about 25 minutes over three render-review passes. That figure is estimated, not measured.

## Coordinates and dimensions
- Layout is authored in Godot coordinates: X east, Y up, Z south, so north is −Z. The scene covers 80 × 80 m, from −40 to 40 on both axes.
- Blender coordinates are (x, −z, y). The GLB is exported with Y up, so it is back in Godot coordinates.
- Terrain is a vertex-coloured grid at 0.5 m spacing (161 × 161). Colours mark grass, a mossier woodland floor, dirt route, muddy banks and stone plaza.
- Height is `terrain.base_y` (0) plus 8 Gaussian `hills`, each `amplitude_m * exp(-(d/radius_m)^2)`.
- On top of that sits a ravine carve that isn't a hill, so it is recorded in `a_procedural.ravine`:
  - a 1.0 m trough with radius 12 m along the stream;
  - a 1.9 m channel with smoothstep sides from 1.2 m to 4.5 m.
- The water surface is 1.35 m below the uncarved ground, which gives about 4.75 m of visible water. The brief allows 3–5 m.
- Heights run from about −2.9 m in the stream bed to +5.5 m on the northwest and southeast ravine shoulders.

## Route and crossing evidence (`a_procedural.checks`)
| Check | Value |
|---|---|
| Path | spawn (−30,29) → … → bridge (−4.24,4.24)→(4.24,−4.24) → … → goal (24,−27), 14 vertices, 78.7 m |
| Route ↔ stream intersections | **1**, and it is the bridge segment |
| Bridge | centred at (0,0), yaw 2.356 rad, 13.6 m long, 4.4 m outer width, **3.4 m walkable** between parapets, 0.7 m arch rise |
| Bridge ends to stream centreline | 6.0 m each, beyond the channel carve (4.5 m), so both ends sit on level bank |
| Max route grade off the bridge | **0.127** (limit 0.24), sampled every 0.5 m |
| Closest object edge to route centreline | 1.78 m, so the 2.4 m corridor (±1.2 m) is clear |
| Trees | trunks at least 4.2 m from the route, so canopies stay out of the corridor at player height |

The bridge is separate geometry (`Bridge_Deck`, `Bridge_Abutments`) with a real underside and ribs over open water, so this is not a ford.

## Composition
- **Spawn:** open meadow on a 0.9 m knoll with a waystone. The beacon is visible straight ahead down the path (see `approach.png`).
- **Route:** gentle S-curves through woodland on both flanks. Shrubs, hedges and small rocks line alternating sides, and a fallen field-wall fragment sits on each bank.
- **Crossing:** the dark stone arched bridge sits square across the stream. Boulders line both banks.
- **Goal:** the ruined orchard is a 5.2 m grid of rows with about 30% gaps, some filled with rubble. It surrounds a broken walled square (15 m) that is open on the southwest, the side the route arrives from.
- **Beacon (focal silhouette):** an 8-sided tapered tower about 8.6 m tall at (26.6,−29.8), on a stepped plinth. It has a broken crown, an emissive brazier with a point light and a red banner, and a paved ring at the goal. It stands above the tree line against the sky.
- **Ravine walls:** two scaled `mountain_cliff_chunk`s in the northwest and southeast corners, where the stream enters and leaves.

## Exact asset references
All library assets come from `input/orchard/<asset_id>.glb`, the same set as `godot/assets/orchard`. Every entry in `world_spec.objects` has `asset_id`, `position_xyz` (with ground-sampled y), `yaw_rad` (about +Y), a uniform `scale` and `interactive: false`.

| asset_id | count | tris each |
|---|---|---|
| apple_tree_mature | 34 | 6739 |
| apple_tree_mature_b | 29 | 6883 |
| apple_tree_young | 30 | 3303 |
| apple_tree_mature_autumn | 10 | 6739 |
| rock_mossy | 30 | 320 |
| rock_mossy_small | 12 | 320 |
| path_straight (scale 1.35 → 2.4 m wide) | 16 | 578 |
| shrub_flowering | 8 | 2400 |
| hedge_dense | 5 | 2300 |
| rubble_split | 6 | 408 |
| wall_straight / wall_end_broken / wall_corner_broken | 5 / 5 / 2 | 2770 / 1832 / 2570 |
| mountain_cliff_chunk (scale 0.26 / 0.22) | 2 | 832 |

That makes **194 instances** of 14 assets. The procedural objects are Terrain, Stream_Water, Bridge_Deck, Bridge_Abutments, Beacon_Tower, Beacon_Brazier, Beacon_Flame, Beacon_Banner, Plaza_Stones, a beacon point light and a sun.

**Triangles:** about 733k in total, of which about 680k are trees and about 51k are terrain. The trees are the budget problem; see the compromises section.

`validation.json`: I reimported the GLB (6.3 MB) and got 203 mesh objects sharing 23 unique meshes, 733,241 triangles, and all 194 spec instances present. `ok: true`.

## Renders (`output/renders/`)
- `overhead.png` (1024², north up)
- `approach.png` (player height from spawn)
- `crossing.png` (player height on the bridge)
- `landmark.png` (oblique/player view of the beacon)
- `reverse.png` (benchmark reverse)
- `unfamiliar_northwest.png` (**extra reverse angle** not in the benchmark: from (−22,7.5,−16) looking along the ravine to the bridge)

All use Eevee Next with the benchmark camera definitions and vertical FOV.

## Compromises / notes for the Godot compiler
- **Path tiles:** `path_straight` tiles are flat and have only yaw, so on slopes they sit partly buried or slightly proud. The terrain's vertex-colour dirt strip carries the route visually. The curve pieces weren't needed because the path is placed as a polyline.
- **Tree cost:** the mature trees are about 6.8k triangles each. For VR, the Godot side should use the `_lod1` variants beyond about 25 m, or MultiMesh instances.
- **Shadows:** Eevee printed "shadow buffer full" warnings. They are harmless in the renders, and a sign of how many shadow casters the scene has.
- **Beacon in the reverse view:** the benchmark `reverse` camera stands about 4.4 m from the beacon, so the plinth fills the right of that frame. I kept that rather than moving the landmark to suit one camera.
- **Water ends:** the water ribbon is clipped to the 80 m bounds, so it may stop up to 1 m short of the edge.
- **What the compiler needs from `a_procedural`:** the ravine carve, bridge end points and beacon parameters. Hills alone don't reproduce the stream channel.
- **No colliders:** the builder doesn't make collision or navigation data. The Godot importer should add a trimesh collider for the terrain and bridge deck.
