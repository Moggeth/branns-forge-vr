# Construction presentation handoff

**File:** `construction_presentation.gd` (extends RefCounted, no class_name).
**API:** `preload(...).render(record: Dictionary, parent: Node3D) -> void` (static). Reads `a`, `b` (Array of 3, cast with `float()`), `width`, `kind`. Adds one child `TimberVisual` (MeshInstance3D). No bodies, colliders, metadata, nav or resources beyond materials.

## Assets
Loaded if `ResourceLoader.exists`, otherwise flat colour: `stockpile_tex_wood_plank/dark/endgrain/bark.png` (worldbuilder), `forge_materials/timber.png` (dark fallback). UVs are metre-scaled (1.4 × 0.7 m per tile for grain faces, 0.5 m for end-grain); texture content and tiling look are untested.

## Geometry (matches logic_context colliders)
- Bridge / boardwalk / ramp: built in a frame pitched `-atan2(dy, length)` about X, deck top at local y=0, span `length+0.10` (same as the collider). Boards only sink 0–12 mm below the surface and are never proud. Brass pegs and teal inlays stand at most 16 mm proud.
- Rails are 0.15×0.16 at X=±(width/2−0.10), y=0.48, full length. Posts every ~3 m, each with a brass cap, teal gem, rope lashing and sagging rope.
- Piles: vertical, at ±(width/2−0.3), every ~4.5 m (bridge) or 6 m, sunk 1.7 m (bridge) or 1.0 m plus up to 0.3 m jitter below the deck underside. Bridge piles get X braces. Piles use the interpolated deck height, so uneven banks are grounded by depth only. Ground height is not sampled.
- Stairs: treads use the same count and top formula with 0.18 thickness and `length/count+0.02` depth. Dark risers sit below each tread. Side stringers and newel posts sit outside the walkable width.
- Deterministic: RNG seeded from the rounded endpoint coordinates.

## Budget
- 6 draw calls per structure (plank, dark, endgrain, brass, rope, glow), 1 node. The glow material is per structure (one extra material each, ≤32) so it can settle.
- Triangles, estimated: a 36 m boardwalk is about 9–11k; a 10 m bridge about 3k; stairs about 2–4k. About 32 structures of mixed size should stay under 150k triangles. These are estimates, not measured.
- No lights, particles or shaders. The commissioning glow is a Tween on emission (teal→dim gold, 4 s), created only if the parent is in the tree. Otherwise it starts settled.

## Assumptions and gaps
- **Untested:** I have not run Godot, so there has been no parse check, no screenshot and no winding or normal check. Face winding is emitted clockwise-front for Godot, but verify it. Test with `--headless --check-only`.
- **Collider span:** in the pitched frame the collider span is `length+0.10`, which is shorter horizontally than `length` on steep grades. I matched the collider, so visual ends fall short of the endpoints by the same amount. That is a logic-side question.
- No rails on stairs (none in the collider). Stair stringers poke at most about 0.09 m above tread edges but only outside the walkable width.
- Tint and roughness variation comes from vertex colours. Only the two-material roughness split is shared. Brass is metallic 0.6 and may need tuning under the game's lighting.
- The old `W.box` visuals must be removed by root, or the new geometry will z-fight.
