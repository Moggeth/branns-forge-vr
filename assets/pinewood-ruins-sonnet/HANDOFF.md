# Pinewood Ruins - art handoff (Sonnet, fast pass)

Rebuild: `blender.exe -b -P build_pinewood.py -- --out <directory>` (Blender 4.5.13, deterministic, ~6 s). Regenerates every GLB, `placement_pinewood_ruins.json`, `stats.json`, both PNGs and `pinewood.blend`, and prints `PINEWOOD_BUILD_OK`. The live game hides its prior flat floor's *visual* when this kit is installed, retaining that floor's collision; the authored ground patch covers the full 30 m square.
Blender-side placement uses Godot (x,y,z) -> Blender (x,-z,y); the manifest is in Godot coordinates, yaw about Y, uniform scale.

## Contents
9 GLBs, each origin at ground level and one batched mesh with embedded PBR textures (base colour + normal for all but flora), UVs and outward winding:
`arch` (broken hook-shaped gate with a tall left pillar and a tooth, right pillar stub, fallen keystone, roots, moss caps), `ruin_wall` (5.5 m stepped broken wall, placed mirrored either side of the arch), `rubble_pile`, `timber_roots` (fallen log, moss stump and roots), `conifer_pine|spruce|fir`, `ground_patch` (30x30 m, dirt path, dapple and leaf litter baked in texture, gentle relief zeroed near the route, the three trees and the fight spots), `undergrowth_clump` (ferns, grass, flowers and mushroom).

Stats: 3,756 unique triangles (limit 25k), 6 material families (stone, bark, needles, ground, flora, moss), 97 placements (about 26k instanced triangles, 96 draw-call instances at most; use MultiMesh for clumps and conifers).

## Placement and route
- Arch at (0,-6), passage about 4.5 m wide (pillar inner faces at x=+-2.25). Central route x in [-2.6, 2.6] from z=12 to -10 has no art, apart from flat path texture.
- Nothing art-side within 2 m of the trees (-6,4), (5,2), (-7,-4) or the skeleton and barrier spots (0,-8.7), (5,-8.5), (-5,-9). Conifers stay 3.2 m or more away.
- Unrendered manifest positions are trusted from script checks only; the visual review used the two PNGs.

## Suggested collision (Codex integrates)
- Arch: two boxes centred at x=+-3.0, z=-6, size 1.7 x 1.4 x 5.6 (left) and 3.1 (right). Do not collide the ring; the passage is open.
- `ruin_wall`: box 5.5 x 1.0 x 1.4 from its origin along local +X (mirrored copy is yaw 180). Low outer rubble is safe to ignore.
- `rubble_pile`: cylinder r 1.0, h 0.6 (scale with placement). `timber_roots`: skip or thin box 3.6 x 0.7 x 0.6 for the log only.
- Conifers: trunk cylinder r 0.3 (scaled). Undergrowth and ground: none. Ground relief is at most 0.22 m; keep gameplay floor at y=0.

## Known gaps
- No collision, lights or gameplay hooks were authored. Art is flat-shaded low poly, not smooth-lit.
- The path's stepping stones from the old scene were not rebuilt (path is texture only).
- Fallen-timber asset includes a stump, so every placement carries one.
- Blocks are jittered boxes; the fracture reads well at distance but is simple up close.
- Renders use EEVEE Standard view with a flat sky, not Godot's environment.
