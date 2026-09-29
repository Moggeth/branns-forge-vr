# Forge Yard grounds kit — handoff

Rebuild: `blender.exe -b -P ../build_forge_grounds.py` (Blender 4.5.13, deterministic, ~2 s). Source is `../build_forge_grounds.py`; editable scene is `forge_grounds.blend`.

## Assets (7 GLBs, 11,028 unique triangles, 5 material families: stone/wood/leaf/soil/ridge)
All have embedded 256px PBR textures, COLOR_0 (multiply into albedo; Godot enables vertex-colour-as-albedo automatically for COLOR_0), UVs, outward winding. Origin = ground-level centre; local +Z is the "front" that faces the hub.

| id | size m (x,y,z) | tris | suggested collision |
|---|---|---|---|
| ridge_a / ridge_b | 22 x 8.3 / 12.5 x 14 | 1728 each | none (decor, beyond gameplay) |
| ridge_far | 26 x 10.8 x 12 | 1728 | none; hazier blue variant for the second layer |
| garden_bed_a | 4.5 x 1.36 x 1.78 | 1604 | box 4.0 x 0.5 x 1.4 |
| garden_planter_b | 2.7 x 2.6 x 2.8 (round planter + small tree) | 1148 | cylinder r1.4 h0.5; skip canopy |
| path_edge_stones | 3.1 x 0.3 x 1.0 | 1472 | none |
| cordwood_ore_rack | 2.7 x 1.77 x 1.21 (log store + ore bin) | 1620 | box 2.6 x 1.5 x 0.8 |

## Placement (`placement_forge_yard.json`, schema 1, 34 instances, Godot coords)
- 10 near ridges at R≈22.5–25 all round (front arc ±60° is only ~0.55–0.67 height scale so portals/sky stay open; back arc 0.85–1.15), alternating ridge_a/b with yaw and width jitter; 7 `ridge_far` at R=38 scaled ~1.35. Non-uniform scale is `[x, y, z]`.
- Gardens: `garden_bed_a` at (±12.4, 3.2) and (±5.8, -10.6); `garden_planter_b` at (±12.9, -3.5), (±14.2, 7.2) and (0, -11.6). All are outside x[-8.5,8.5] z[-8,0] and clear of portal columns (nearest is about 4 m).
- 6 `path_edge_stones` at x=±3.05, z=1.6/4.6/7.6 (rotation 90); the x[-2.5,2.5] path stays clear.
- `cordwood_ore_rack` at (-9.75, -4.2) and (9.75, -2.6), backs to the workshop's side walls.
- `rotation_y_deg` is `Basis(Vector3.UP, deg2rad(v))`. Total instanced triangles ≈ 53.6k, and it is instancing-friendly: 7 meshes, 34 MultiMesh-able draws.

## Renders
`render_ground.png` and `render_ground_side.png` (VR eye level, 1.7 m), `render_rts.png` (elevated). The workshop, path, ground and portals in them are crude render-only proxies, not exported assets; they only show fit.

## Notes / known weaknesses
- The ridges use a heightfield with vertex-colour grass/rock/haze. The source builder repairs Blender's colour-set order so Godot sees the authored tint in `COLOR_0`; the runtime manifest requests vertex-colour multiplication. Actual Godot ground and RTS views are in `previews/game_*.png`.
- Grass tufts are cone blades and slightly spiky; scale them down or swap them if you want a softer look.
- Codex imported and route-tested the seven GLBs in Godot; `docs/FORGE-YARD-ART-20260930.md` has the checks and stereo-performance limitation.
