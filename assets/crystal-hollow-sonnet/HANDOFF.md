# Crystal Hollow authored kit — handoff

Rebuild: `blender.exe -b --python build_crystal.py -- --out <directory>` (Blender 4.5.13, deterministic, about 2 s on this PC). Emits GLBs, `placement_crystal_hollow.json`, `stats.json`, `render_ground.png`, `render_rts.png`, `crystal.blend` and `CRYSTAL_BUILD_OK`. `CRYSTAL_STAGE=first` = one-asset smoke test.

Codex's playable integration keeps the old vaulted cave shell, hanging crystals, arch and interactive Prism Vault; Sonnet's strata, rooted clusters, ore seams and chasm rims form a new lower layer. The old scattered spires/pools are omitted. `prepare_runtime_manifest.py` moves side/back strata slightly inward to make the texture visible, adds 35 conservative collision proxies, and does not place `landmark_spire` because its footprint overlaps the Prism Vault. The spire GLB remains reusable in the source library.

## Assets (8 GLBs, Godot axes, origin at floor/base centre, Y up)
| file | tris | notes |
|---|---|---|
| landmark_spire | 2834 | focal plinth + 6.4 m glowing cyan spire, violet/cyan companions, ore veins. Footprint r~2.6 |
| cluster_large / cluster_small | 580 / 230 | rooted crystal clusters on faceted rock |
| cliff_strata | 842 | 4.4 m wide, ~4 m tall stacked strata; **front faces +Z** (yaw 90 = faces +X) |
| ore_wall | 976 | strata block with glowing gold/cyan ore veins; front +Z |
| chasm_edge | 780 | 3 m rim dressing; face drops to -2.3 m; front (abyss side) +Z. Rim top is +0.1 m |
| boulders | 406 | talus pile with ore nugget and small crystals |
| stalactites | 296 | overhang slab + hanging spikes; origin at attach (ceiling) plane, placed at y=4.6 |

Totals: 6944 unique tris (budget 25k), 42.8k instanced tris over ~90 placements. 6 shared materials (rock, ore, cyan, cyan-glow, violet, violet-glow), 256 px embedded PNG textures, UVs, flat-shaded, outward winding. Glow = emissive material only (strength 1.4 ore, 2.2 crystals); no lights included.

## Placement
`placement_crystal_hollow.json` schema 1, Godot local coords, yaw about Y. Layout assumes floor top at y=0, and a full-width gap between z=-1 and z=-6 (matches the before screenshots). Rim pieces are at z=-1 (yaw 180) and z=-6 (yaw 0), starting at |x|=1.9 so the bridge lane is bare. Builder skips any piece whose footprint enters a keep-out (ore sites, golem, skeleton, anchor, corridor polyline, half-width 1.7): two far-rim pieces near x=3.4 and x=-6.4 were skipped for that reason. Entrance (z>12) is left open; side cliffs run z=13..-12, back row at z=-14.4, landmark at (0,-13.4).

## Collision suggestions (conservative; all optional, visuals must not block gameplay)
- cliff_strata / ore_wall: one box 4.2 x 4 x 1.6 behind the front face (front z minus 1.2 m).
- landmark_spire: cylinder r=2.2, h=2 for the plinth only; crystals no collision.
- cluster_large: cylinder r=1.0, h=0.6; cluster_small / boulders: none or r=0.7 cylinder (boulders r=1.1).
- chasm_edge: no collision. Floor stays authoritative.
- stalactites: none (overhead).

## Caveats
- Dummy floor, plank bridge, ore/enemy boxes in renders are stand-ins only; not exported.
- Existing arch, signs, cart etc. from the old scene were not modelled; check overlap with the landmark (arch centre-back) when integrating and drop/move pieces as needed.
- Side cliffs are ~4 m with overhangs at y=4.6; if the RTS camera clips them, hide the near-side row or scale y to 0.6.
- Back-row cliff pieces have small gaps between them; hide with the old cave backdrop or add boulders.
- Not tested in Godot; imports only checked via glTF JSON (images embedded, TEXCOORD_0 present).
