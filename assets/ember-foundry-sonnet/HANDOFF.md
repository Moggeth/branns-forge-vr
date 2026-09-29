# Ember Foundry kit (Sonnet, fast build)

Rebuild: `blender.exe -b -P output/build_foundry.py` (writes GLBs, foundry.blend, placement JSON, stats.json, previews). Original procedural work; textures are generated in-script and embedded in each GLB.

Assets (7 GLBs, 1512 unique tris total, 4 material families: basalt, iron, slag, ember; one mesh per asset with per-material primitives, no lights):
gate, rim (4.2 m basalt/iron wall module), rail (broken rail), slag (cooling slag mound with sparse ember flecks), chain (hanging, origin at top), conduit (low ember pipe), inlay (2 m floor tile, origin at centre, top at +0.025 m so place at Y=0.025).

Placements: `placement_ember_foundry.json` (66 placements, Godot X/Y-up/Z, yaw about Y). Assets face +Z at yaw 0 (iron trim on the arena-facing side).
- Gate at (0,-12.6), 5 m opening (x -2.5..2.5); its glowing back panel is a thin emissive plane at z=-11.85. Replaces primitive wall/pillars.
- Rim walls at z=-14.4 (gap behind gate), x=+-14.5, and z=14.4 with a wide gap x -3.5..9.7 (approach + portal at (7.5,9.5) unblocked).
- Inlay: x=0 approach lane z=0..12 (2 m wide), 11-tile ring r=4.6 around boss (0,-7), 4-tile C around iron ore (-7,-7) open toward the boss.
- Clear: 3 m+ approach from +Z; boss, skeleton (5,-5) and ore areas have no props within ~4 m (only flat inlay).

Collision intent (conservative, none baked): gate = two box colliders per pylon (2x2.2x6 at x=+-3.6, y 0..6) plus lintel box (5.4 wide, y 5.8..6.9) leaving the opening walkable; rim = one box 4.2x1.2x1.4 each; rail = no collision or thin box; slag = one cylinder r=1.2 h=0.8; conduit = box 3.6x0.7x0.3 (or none); chain = none; inlay = none (visual only).

Checks: texture nonblack fraction 1.0 for all four (stats.json); normals recalculated outward (bmesh.recalc_face_normals) and flat-shaded; each mesh has one UV layer (box projection, 0.5 tile/m). Not run: Godot import, in-headset review.

Previews: curated copies are in `previews/` (ground at a 1.7 m eye and elevated RTS). The builder regenerates root-level `preview_*.png` as ignored working files. `first_render.png` in the isolated commission was the initial single-module test.

Remaining/known: textures are low-res procedural (256 px, blocky pixels up close); gate glow is a flat panel; the before_foundry_* references and style_reference.jpg were not consulted; rails/slag may clip rim by a few cm. Tile texture repeat is per-piece box UV, not seamless across tiles.
