# Forge Valley: handoff

## Files
- `forge_valley.glb`: the full 360° hub landscape. No external files; vertex colours are embedded and drive the PBR base colour.
- `meadow_edge.glb`: a static border grass and wildflower clump, about 1.3 × 0.6 × 0.6 m, rooted at y = 0.
- `build_valley.py`: the deterministic source (seeded). Rebuild with:
  `blender.exe -b --factory-startup --python build_valley.py` (add `-- --no-render` to skip the previews).
- `preview_oblique.png`, `preview_gates_+Z.png` (camera at 0, 1.7, 2 looking +Z), `preview_high_south.png`. The tan slab, brown box and gold slabs in the previews are stand-ins for the yard, smithy and portals. They are not in the GLB.

## Placement
Import at the identity transform. Units are metres, Godot Y-up, and +Z faces the portal garden. The landscape centre is (10, 0, 0) and the mesh extends to a radius of 206 m.

## Scale and layout (distances are from the playable rectangle x −15..35, z −15..15)
- **Staging ground under gameplay:** flat at y = −0.32 for every vertex within x −16..36, z −16..16. The script checks this and reports a maximum of −0.32. Nothing sits coplanar with your y = 0 floor.
- **0–3 m:** meadow stays below ground level and hides under the yard edge.
- **3–40 m:** wildflower meadow rising gently to about 3 m, with sentinel pines and a few boulders.
- **38–100 m:** two layers of rolling ridges with saddles. Their heights and profiles vary with angle, and they are lowered in three sightline gaps. The biggest gap is directly behind the portals (+Z), so there's no wall there.
- **120–190 m:** ridged rocky mountains, around 30–110 m tall, with light snow on the highest peaks. A cool blue-grey haze is baked into the vertex colours from about 85 m outward.
- **West side:** a small stream about 15 m off the yard edge, crossing at x ≈ −31, with a gravel bed and stones along its banks.

## Rules checked by the script on every build
- No tree or rock vertex above y = 0 falls inside the rectangle plus 3 m (x −18..38, z −18..18). Both counts are 0.
- Wildflowers and grass also stay outside the rectangle plus 3 m.
- Total is about 41k triangles in 5 batched meshes, one material each: `M_Terrain`, `M_Foliage` (pines, broadleaf trees and trunks), `M_Rock`, `M_Wildflower` (double-sided), `M_Stream` (double-sided, roughness 0.12).
- There is no collision geometry. Add your own floor collider for the yard.

## Godot notes
- Remove the old ridge rings and horizon. Use a sky or background colour around (0.42, 0.58, 0.82), and fog is optional. If you use fog, keep it light, because the haze is already baked into the colours.
- For late-morning lighting, use a warm sun (1.0, 0.93, 0.80) about 40° above the horizon.
- The stream is a flat ribbon. If you want it to shimmer, swap in an animated water material on `M_Stream`.
- `meadow_edge.glb` is static. If you want it to sway, add a vertex shader that offsets each vertex by a sine of its local y.

## Tuning
All of the shape lives in `height()` inside `build_valley.py`:
- `hillA` and `gauss_ang(...)` set the ridge heights and the sightline gaps.
- `m0` and `mA` set the distance and height of the mountains.
- `HAZE` sets the colour of the baked air.

The number of copses is set in `build_trees` (`len(centres) < 34`).
