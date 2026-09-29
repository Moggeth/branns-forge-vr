# Emberwing handoff (revision 2, time-capped)

Files: `bow.glb`, `arrow.glb`, `wings.glb`, `source.blend`, `builder.py`, `render.py`, `render_*.png`.

## Rebuild
```
../../tools/blender-4.5.13-windows-x64/blender.exe --background --python-exit-code 2 --python builder.py -- --out ABS_DIR
../../tools/blender-4.5.13-windows-x64/blender.exe --background --python-exit-code 2 --python render.py -- --out ABS_DIR   # studio PNGs from the GLBs
```
Builder is deterministic. Geometry is authored directly in final glTF coordinates (+Y up, arrow -Z).
Textures (gold/ember/wing feather gradients) are generated in code and packed into each GLB.

## Budgets (measured from the exported GLB JSON)
| asset | tris | surfaces | materials |
|---|---|---|---|
| bow.glb | 13,538 (limit 22k) | 13 (limit 14) | 5 |
| arrow.glb | 1,250 (limit 1,800) | 5 | 4 |
| wings.glb | 2,400 (limit 2,800) | 3 | 2 |

## Revision 2 (visual, after game review)
- Limbs: the fern ladder is gone. Each limb is now ONE swept wing on its dominant side (upper +X, lower -X, rotationally symmetric), built from 7 primaries, 5 secondaries and 4 coverts of varied length/angle/width, all curling forward. The opposite side has only 3 short gold spurs. Primaries are gold frames with a deep ember interior on the player-facing face; the outermost carry azure tips. A azure-gold tip blade runs to each nock. Bow cores are still slim, string tips unchanged.
- Bust: a head, hooked brass beak, azure eyes, brow ridges, swept crest, glowing heart (brass cage) and mantle feathers. The bird leans FORWARD (-Z) on a neck: head centre (0,0.207,-0.148), beak tip z~-0.22. It has to be forward because the limb core passes through x=0 and would hide anything sitting on the limb line. All of it is at y>=0.09 or below y=-0.098. The arrow port and finger area are untouched. The head is ~0.2 m above the arrow line, so please check the sight picture in game.
- Materials: baked walnut grain (dark), stitched leather, brass with a base-colour patina and a packed metallicRoughness map (G = roughness 0.26-0.62, B = metal), a dark-to-fire ember texture (dark root, deep orange, hot gold, azure), and emissive strength cut to 0.85. Ember/wing base colours are darkened so diffuse light does not wash them out. The heart and azure gems sample special spots of the ember texture (u 0.78 and 0.975), so they cost no extra surface. No lights or particles.
- Wings: 9 primaries, 7 secondaries and 6 coverts per wing, swept back with outward-flicking tips and azure-gold tips, still 3 surfaces. Span held at 0.544 m, same pivots.
- Mesh bounds (bow): x -0.223..0.229, y +/-0.625, z -0.218..0.111. This is wider than v1 (x +/-0.187) because the wing is one-sided; shrink the 0.84 length factor in `limb_feathers` if it collides in game.

## Nodes / markers (glTF coordinates, verified in exported JSON)
- Bow: `Bow` > `Grip` (0,0,0), `ArrowRest` (0,0,0.10), `StringTop` (0,0.60,0.10), `StringBottom` (0,-0.60,0.10), `GripMesh`, `PhoenixCore`,
  `UpperLimb` / `LowerLimb` (empties pivoted at the origin; children `*Core`, `*Feathers_Gold`, `*Feathers_Ember`).
  Revision 2 mesh bounds: x -0.223..0.229, y ±0.625, z -0.218..0.111. Grip is 3.5 cm diameter and 16 cm long.
- Arrow: `Arrow` > `ArrowNock` (0,0,0), `ArrowTip` (0,0,-0.78), meshes `Shaft`, `Nock`, `Head`, `Fletching` (z -0.04..-0.165), `Bindings` (brass whipping and a tiny inlaid phoenix).
- Wings: `Wings` > `WingLeft` (-0.035,0,0), `WingRight` (0.035,0,0) (each with its own mesh, pivot-local), `EmberTrail`. Span is 0.544 m. Wing materials are emissive. There are no lights or particles.

## Arrow line
The arrow line is x=0, y=0, z<=0.10, so it passes through the grip. `GripMesh` therefore has a boolean-cut, brass-lined 2.1 cm arrow port along that line. Nothing else crosses it: the limbs start at y=0.075, the phoenix bust sits above and the tail plumes below.

## Known limits / next iteration
- Studio renders (strong key light) wash the ember to salmon; a dim render shows the intended dark-to-fire contrast. The integration owner subsequently validated all three GLBs and reviewed actual Godot captures; see `../../docs/EMBERWING-20260930.md`.
- The bird is small and cartoon-like at 3 cm scale. Next step: sculpted head silhouette, more curved primaries, and a runtime flame-alpha look for wing tips.
- Wings export opaque and emissive. Fade and scale are left to runtime.
