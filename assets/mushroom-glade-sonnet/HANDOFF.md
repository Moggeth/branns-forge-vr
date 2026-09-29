# Mushroom Glade kit — handoff

Rebuild: `blender.exe --background --python build_glade.py` (pinned Blender 4.5.13, about 1 minute; writes everything here).

## Files
- `glb/*.glb`: 14 self-contained GLBs with embedded 512² PNG textures. Y-up, +Z toward the portals, origin on the ground. One mesh node per material.
- `placement_mushroom_glade.json`: schema 1. `assets` maps ID to local GLB. `placements` hold `asset`, `position` [x,y,z], `yaw_degrees` (about Y) and a uniform scalar `scale`. Positions are Godot world coordinates and the floor is y=0.
- `collision_proxies.json`: suggested proxies. `glade.blend`: editable scene with every placement instanced from shared mesh data. `textures/`: source PNGs. `stats.json`, `preview_glade_ground.png`, `preview_glade_rts.png`. `preview_mushroom_test.png` is the first-asset smoke test.

## Budget
- 10,437 unique triangles (limit 25k). The largest assets are `mushroom_cluster` at 3,968 and `ruin_waterfall` at 1,298.
- 6 materials shared by all assets: MushroomCap, StemGill, MossStone, RootBark, Water, Spore. No texture is black; the mean RGB values are in `stats.json`.
- 70 placements. Use MultiMesh per asset or material if draw calls matter.
- No lights. Water and Spore use emissive strength from the glTF material, so a Godot environment glow will bloom them. Nothing casts light.

## Layout
- The pond is centered at (1,-3), with an irregular bank. It dips away from the wisp at (-4,-4).
- Stepping stones run along x≈0.4 from z=-0.3 to -5.9, across the pond.
- The waterfall is at (4.5,-13) on the cliff backdrop at z<=-14.3. Its stream runs into the pond's NE edge.
- The mossy ruin is a broken arch at left (x -9 to -5, z -13.6) with wall stubs, and a wall and pillar at right (x 8 to 12).
- Violet mushrooms come in tall, squat, lean and cluster variants, with 36 real gill fins and a ring on the stem. Roots and boulders sit at the edges.
- Spore clouds and glow sprouts are decor with no collision.
- Nothing sits in the x=0 route (|x|<1.4, z -14.3 to 15), the +Z portal zone (|x|<10, z 7 to 15), or within 1.3 m of the pickups or 1.6 m of the wisp. `build_glade.py` asserts this in `check_keepouts()` and reports no violations.

## Collision proxy suggestions (conservative)
- Mushrooms: a stem-only cylinder, radius 0.19 (tall), 0.24 (squat), 0.17 (lean), each times scale. The cluster's main stem is 0.18, plus two small stems. Leave the caps non-solid: they overhang the play area but don't block it.
- Boulders: cylinder r 1.3 (a) or 1.4 (b) times scale. Rock cluster: r 0.75 times scale.
- Cliff: one box spanning x ±15.5, z -17.6 to -14.3. Ruin: the world-space boxes and cylinders in `collision_proxies.json`.
- No collision for water, bank, stepping stones, roots, spores or sprouts. All of these are under 0.3 m high (roots up to 0.6 m at scale 1.5) and walkable.

## Notes and limits
- The preview ground is a flat placeholder plane. The game owns the floor, resources, enemy and portals.
- Rocks and ruin use flat shading, as in the style reference. Mushrooms use smooth shading with a slight normal seam at the lathe join.
- The waterfall is a static textured sheet. A Godot UV-scroll shader on the Water material would animate it, and the stream's V axis runs along the flow.
- I checked the previews by eye but did not load the GLBs in Godot.
