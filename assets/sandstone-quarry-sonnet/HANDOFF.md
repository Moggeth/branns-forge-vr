# Sandstone Quarry kit (30 x 30 m) - handoff

Files (all in `output/`): `build_quarry.py` (Blender 4.5.13 builder, `blender -b -P build_quarry.py`; `QUARRY_ONLY=<asset>` exports one), `quarry.blend` (all assets laid out in a row),
8 self-contained GLBs, `placement_sandstone_quarry.json`, `stats.json`, `verification.json` (from `verify_quarry.py`), `render_preview.py`,
`first_lit.png` (first export), `preview_ground.png` (1.7 m eye from +Z), `preview_overhead.png` (RTS view).

## Assets (origin at base centre, Y up, front faces Godot +Z)
spoil_boulder, strata_wall (6 m x 3.4 m layered chisel-scored strata, iron plugs/wedges, timber shoring on the front), cliff_mass (stepped ~5.5 m mesa for corners/rim),
cut_slab_stack, scaffold_crane (timber scaffold, mast, jib, rope, iron hook, hanging slab), quarry_gateway (entrance arch, 3.2 m clear opening, lantern glow meshes),
mine_portal (timber-framed stone mine mouth, dark back plate, rails, 3.0 m opening - sits behind the crystal), lantern_post (route marker).

## Stats
5,428 unique triangles (limit 25k); 56 placements. 6 material families: Sandstone, CutStone, Timber, Iron, Rope, Lantern (emissive mesh, no lights).
Each GLB embeds 512px PNG textures (~0.7-2 MB per GLB, uncompressed PNG; consider VRAM compression on import). Checked by re-importing every GLB: all embedded textures 100% non-black; 0 meshes with inward-facing normals (signed volume); all meshes have UVs.

## Placement / gameplay clearance
Yaw follows Godot Y rotation (+90 turns local +Z front toward +X). Entrance gateway at (7, 14.6) faces inward; route corridor x 5.5..8.5 (3 m) is kept free from z=15.5 to -9,
then the gate approach (x 3.8..8.5, z -11..-8). Build script checks every solid footprint (rects, not circles) for >=1.2 m from ore, stone, golem, barrier (5,-10) and crystal (5,-13) and drops violators
(one lantern post dropped, listed in stats.json). Walls/cliffs ring the perimeter; the back wall opens at (5,-14.6) with the mine portal.
Preview floor in renders is a preview plane only; the game floor is Codex's.

## Collision proxy intent
Use simple boxes, not mesh colliders: strata_wall 6 x 3.4 x 1.6; cliff_mass one 4 x 5.5 x 4 box; cut_slab_stack 1.8 x 1.0 x 1.0; scaffold_crane four post boxes only (legs ~0.25 sq, deck walkable/overhead - jib is above 5 m);
spoil_boulder one sphere ~1.3 m; quarry_gateway two pier boxes 1.4 x 3.6 x 1.1 at x=+-2.3 (opening stays open); mine_portal two block boxes 1.6 x 4.6 x 1.6 at x=+-2 plus back plate; lantern_post small 0.3 box (or none).

## Not done / remaining
- Only the cursory review of the ground/overhead previews; the before_quarry_*.png captures were not critiqued.
- No LODs, no baked AO, wall and cliff silhouettes are boxy (bevel 1 segment); a second strata_wall variant and rubble decals would reduce repetition.
- No rock-face normal maps; flat-shaded look is intentional.
- Not imported into Godot; only Blender previews and GLB re-import were checked. Lantern emission only visible with glow/HDR post.
