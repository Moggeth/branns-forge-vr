# Emberwing structural revision 3 - mechanical blockout (bow only)

Files: `bow.glb`, `source.blend`, `structure-report.json`, `clay-contact-sheet.png`. Source is `../builder.py`, with helper scripts `../report.py` (GLB JSON inspector) and `../render_clay.py` (neutral Workbench sheet from the exported GLB). `../builder_previous.py` is the old source, kept for diffing.

Rebuild (deterministic; two consecutive builds gave an identical bow.glb SHA-256):
```
blender.exe --background --python-exit-code 2 --python builder.py -- --out ABS_DIR
blender.exe --background --python report.py -- --out ABS_DIR
blender.exe --background --python render_clay.py -- --out ABS_DIR
```
The builder now writes only `bow.glb` and `source.blend`. Pass `--all` to also rebuild arrow/wings; the arrow/wings code is untouched and no arrow/wings file is produced or changed here.

## Measured (from the exported GLB, `structure-report.json`)
| item | value | limit |
|---|---|---|
| triangles | 13,864 | 22,000 |
| surfaces (primitives) | 14 | 14 |
| materials | 5 (Wood, Leather, Brass, FeatherGold, FeatherEmber) | 8 |
| embedded textures | 6 | 8 |
| size | 541,800 bytes | 3 MB |
| dimensions | 0.495 x 1.251 x 0.304 m | 0.60 x 1.35 x 0.40 |

Materials and textures are the previous ones, kept as a temporary preview. All primitives have a positive signed volume (outward winding); backs are modelled (feathers are two-sided, tubes/lofts are capped).

## Nodes and markers (world positions from my own GLB parser)
- Bow > Grip (0,0,0), ArrowRest (0,0.115,0.10), ArrowGuide (0,0.115,-0.012), GripMesh, RiserMesh, PhoenixCore, UpperLimb, LowerLimb.
- UpperLimb pivot (0,0.18,-0.045); its children are UpperLimbMesh and **StringTop (0,0.60,0.10)**.
- LowerLimb pivot (0,-0.10,-0.022); its children are LowerLimbMesh and **StringBottom (0,-0.60,0.10)**.
- Marker world positions are exact. Limb children are pivot-local, so rotating the limb empties about X carries the mesh and string point with them. There is no string in the GLB.
- Extra mesh node: `RiserMesh` (rails, arrow guide shelf, lower heel).

## What changed
- **Grip**: solid, no bore. 145 mm long. Oval cross-section 30-33 mm wide (x) and 34-37 mm deep (z), with a palm swell, a light finger-rest ripple, and a flared thumb/index web at the top. Brass end collars are thin bands, but they flare to about 41 mm deep at the very ends. Leather.
- **Arrow window**: the arrow line is now y=0.115. The riser splits into two curved side rails at x=±0.027, inner edge at ±0.0175. Above the window the phoenix chest closes the top with its underside at y=0.134. Line of sight through the window is open.
- **ArrowGuide**: a small brass shelf plus two low lips, bridging the rails. Shelf top is at y=0.1068, which is 4.5 mm under the shaft bottom (shaft r 3.7 mm). Lips top at y=0.1086.
- **Corridor check**: within 14 mm of the arrow axis for z -0.68..+0.10, only 16 vertices intrude, all shelf/lip brass at y 0.1068-0.1086. The nearest is 9.05 mm from the axis, and all of them sit below the shaft. Nothing else, including the phoenix, is inside the corridor.
- **Limbs**: wide, flat, tapered wood (root about 23 x 42 mm in section, tip about 9 x 17 mm) with a brass root sleeve, two mid bands and a grooved bronze nock fitting. The groove centre is exactly the StringTop/Bottom marker, so the string seats in the groove. An azure gem sits on each tip. The root sleeves extend about 16 mm past the pivot and overlap the riser (chest above, heel below).
- **Feathers**: three masses per limb (shoulder 4, mid 3, tip 2 primaries) with thick cambered bodies (7.5 mm at the root down to 1.6 mm at the tip), ember inlays on the player-facing face, 5 upper coverts, 3 underside back-layer feathers and 2 leading-edge spurs. Dominant sides are unchanged: upper +X, lower -X.
- **Phoenix**: a chest/bridge loft, a swept neck, a skull, cheek pads, sunk azure eyes under gold brow ridges that flow into the hooked beak (upper and lower mandible), a three-pair crest sweeping up and back into the limb, and thick cambered mantle feathers over the limb root. Head centre is (0,0.224,-0.114) and the beak tip is at about y=0.19, z=-0.18. Everything is at y>=0.134, so it is clear of the flight line, and the hand is at y<0.075. The old coral spheres, dangling neck and tail fan are gone.

## Known limits / not done
- **Draw rotation not tested**: I did not test +/-0.09 rad in an engine or in Blender. The overlap is by construction: roughly 16 mm of sleeve past the pivot, which shifts by less than 3 mm at that angle.
- **Hand fit unchecked**: I did not import or fit the supplied hands. The grip is sized to the brief only.
- **Feather look**: feather masses read as layered ladders in the straight-on front view. The volume and camber show from the side and three-quarter views. A later pass could vary the per-feather sweep.
- **Clay sheet framing**: the sheet's close-ups are loosely framed. Only the archer-view window tile is a clean check.
- **Surface count**: 14/14 is at the cap. Any new material or separate mesh needs merging elsewhere.
- **Textures unchanged**: the feather UVs are still per-feather gradients, and the riser wood UVs are only lightly authored. The material pass is left for later, as requested.
