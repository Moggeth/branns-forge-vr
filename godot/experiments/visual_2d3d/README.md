# Orchard Brook Godot compiler

`world_builder.gd` turns a saved `world_spec` v1 JSON plan into an isolated Godot scene. It never loads `main.tscn`, player progress, the forge service, or XR. It uses the existing `res://assets/orchard/*.glb` library, with the same vertex-colour repair and MultiMesh batching as the playable orchard. The compiler makes 1 m terrain triangles, a recessed stream, path surface, colliding stone bridge, sparse seeded foliage and object footprints. `run_world.gd` validates the plan, raycasts the physical bridge and spawn ground, saves `world.tscn`, and renders the five fixed benchmark views.

From the repository root:

```powershell
& godot/experiments/visual_2d3d/Run-World.ps1 -Spec godot/experiments/visual_2d3d/sample_world_spec.json -Out godot/experiments/visual_2d3d/sample_output
& godot/experiments/visual_2d3d/Run-World.ps1 -Spec experiments/visual-2d3d-20260928/variants/D/world_spec.json -Out godot/experiments/visual_2d3d/d_smoke
```

Use `-Headless -CheckOnly` for fast schema and route validation. Use `-Headless` without `-CheckOnly` to compile the scene without PNG readback; its metrics say `unavailable_headless_display`. Normal windowed execution renders via the local Vulkan desktop renderer and exits automatically. Output paths are local, generated experiment artifacts. Open an output `world.tscn` from inside the Godot project to inspect it, or copy it under the project if the output was elsewhere. `metrics.json` holds validation, node/triangle counts and measured build/render times. A console run takes longer than the in-engine times because engine startup is included.

The bridge's long axis is local Z; `yaw_rad=0` runs north/south. Stream and path arrays use Godot X/Z metres with north at negative Z. Trees are deliberately placed from saved polygons and a seed; `tree_density` is a 0–1 control and each region is capped at 240 candidate placements for a compact comparison. Regions currently affect foliage placement, while their `surface` labels are preserved in the JSON but terrain material remains common across variants. Explicit object `position_xyz` is respected; `center_xyz` remains a compatible alias. `terrain.base_y` is preferred; earlier `base_height_m` remains an alias.

Hard checks cover required fields, 80 m bounds, spawn/goal path endpoints, stream/bridge widths, bridge centre and orientation, route contact with the bridge, sub-metre route grade sampling away from the bridge, stream encounters away from the crossing, object path obstruction, and physical raycasts on the bridge/spawn. These are useful gates, not a navmesh or a verified player traversal. Water is non-fordable by a recessed bank and route rule; there is no player drowning script in this isolated test. The physical deck is collidable. In-headset comfort, VR frame rate and stereo appearance remain unmeasured.

`path_straight`, `path_curve30` and `path_curve30_left` are walkable surface decals. They can lie on the required route and do not create the generic cylindrical object footprint. Trees, rocks, walls and other props retain route obstruction checks and physical footprints. This distinction allows Opus A's 16 authored path pieces while a rock placed at one of those positions still fails validation.

The first smoke render revealed that the procedural faces were culled and Orchard GLBs imported without their intended vertex colours. Face winding and `orchard_finish.gd` application fixed those failures. A first D check rejected a yaw convention mismatch; the deck is now along Godot's forward Z axis and D passes. The first batched overhead capture hid distant trees because the live orchard adapter sets visibility range to 90 m; the evaluation scene removes that range so all variants remain visible from the fixed 85 m camera. If these symptoms recur, inspect `overhead.png` before adjusting colours or GLB files. Diagnostic metrics and five PNGs are enough to compare changes without rerunning image generation or specialist asset construction.

The sample is a compiler fixture, not one of the five evaluated pipelines. `a_smoke/` and `d_smoke/` prove that the independent A and D world specs run. Neither scene has been tested in a headset.
