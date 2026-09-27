# Forge Yard architecture kit — handoff (commission 1 of 2)

Author: Opus 5.5 (environment art). Built 2026-09-27 using the Blender 4.5.13 install in `tools/`. No network, no APIs, no live checkout writes.

## Reproduce
```powershell
$b = "../../tools/blender-4.5.13-windows-x64/blender.exe"   # from the commission folder
& $b --background --factory-startup --python-exit-code 2 --python build_forge_yard.py -- --out "$PWD/output"    # ~3.4 s
& $b --background --factory-startup --python-exit-code 2 --python render_preview.py  -- --out "$PWD/output"    # ~4 s, re-imports the GLBs
```
The build is deterministic (seed 1492, procedural numpy textures). The builder also accepts `-- --out ABS_DIR`, which matches the Asset Lab contract. Copies of both scripts are in `output/source/`.

## Files
| File | Purpose |
|---|---|
| `forge_shelter.glb` | Open building shell with frame, roof, rear wall, gables and chimney. It has no ground plane. 20,224 tris, 13 named meshes, 2.3 MB |
| `forge_detail_kit.glb` | All 13 decorative modules, pre-placed at their layout positions. 6,352 tris, 1.2 MB |
| `kit_modules/*.glb` | Each module as a separate file with its origin at the `position` given in layout.json |
| `forge_yard_source.blend` | Editable combined source with the `forge_shelter` and `forge_detail_kit` collections |
| `layout.json` | Placements, per-group bounds, tris and materials, smoke socket and recommended box colliders |
| `inspection.json` | Measurements taken from the exported GLBs (see below) |
| `previews/*.png` | front, three_quarter, side, rear_exterior, eye_approach_z8, eye_inside_looking_hearth, eye_rear_gate |

**Total: 26,576 triangles and 9 materials**, all opaque. Every GLB embeds its PNG textures (`external_uris = 0`, checked from the GLB JSON).

Gray and teal boxes in the previews are review-only proxies for runtime entities: Brann, the anvil, the hearth and hood, the tables and boards, the gate leaf and the floor slab. They are not in any GLB.

## Coordinates and dimensions
Coordinates follow Godot conventions: metres, +Y up, front +Z, ground y = 0. Place both GLBs at the forge_yard zone origin with no rotation.
- Measured scene bounds (shell + kit): x −11.0..11.0, y 0..8.55, z −8.0..2.96.
- **Shell alone:** posts at x ±8.3/±4.6 and z −0.45/−7.35, plus side mid-posts at (±8.3, −3.9). Tie-beam soffit is at y 4.38 and main ridge tiles at about 6.9. The chimney rises to 8.0 plus its pots.
- **Roof:** tiles run x −8.75..8.75 and z −7.75..−0.05. The front cross-gable eave reaches z +0.2. Both exceed the contract's 17 × 7.2 footprint by about 0.25 m. That overhang is a normal eave, and it sits entirely above y 4.3.
- **Gate:** clear aperture measured by raycast is 3.03–3.10 m wide from y 0.5 to 2.9. The spring line is at y 2.95, with a segmental stone arch and a plaster tympanum above. FoundryGate (0, 1.4, −7.6) fits inside the 0.5 m wall reveal (wall centre z −7.58).
- **Head clearance:** the lowest overhead structure in the walkable interior is 3.15 m (knee braces). Tie beams are at 4.38. The only lower hit in the upward raycast grid is the wall-mounted tool-rack shelf at y 0.97, 0.4 m off the rear wall.
- **Sightlines** were raycast from the approach eye (0, 1.6, 8) against the exported meshes. Brann's head and chest, both boards, both tables and the gate centre are **all unobstructed**.
- **Chimney** is centred (−3.1, *, −4.9). It starts at y 3.25, sitting on the runtime hearth's iron hood box. Move `ForgeSmoke` to the socket at **(−3.1, 7.99, −4.9)**.

## Mesh groups
Shell (tris): Posts 1320 · Plates_Ties 396 · Braces_Joinery 1376 · Trusses 1320 · Rafters_Purlins 1672 · Roof_Tiles 4600 (7 jittered courses per slope, gently sagging ridge, sarking boards) · Ridge_Finials 960 · FrontGable 1900 (cross-gable, scalloped barge boards, iron finial) · RearWall_Stone 3444 (coursed plinth, quoined jambs, 9-stone arch) · RearWall_Frame 984 (plaster panels, half-timbering, saltire panels) · GableEnds 720 · Chimney 608 · Ironwork 924 (post straps and bolts, king-post stirrups, wall hooks, gate pintles, chimney bands).

Kit (tris, anchor):
- ForgeCrest 852 at (0, 5.05, 0.1): brass-rimmed roundel with an anvil, crossed hammers and an ember gem. It hangs in the front gable and has no text.
- Banner_West/East 204 each at (±6.45, 4.0, −0.21): swallowtail crimson cloth on a brass rod. Bottom at 2.85.
- Lantern_W8_3/W4_6/E4_6/E8_3 300 each on the front posts at y 3.1. Bottom at 2.55. Each one's `light_socket` is listed in layout.json.
- ToolRack_West/East 836 each at (±6.4, 0, −7.34): peg rail with tongs, hammers and files, plus a shelf with pots and a coal scuttle. They sit behind the interaction tables.
- EntryArch 716 at (0, 0, 2.7): stone-footed posts at x ±1.3, a small tiled lintel and a hanging ember hoop. Posts are 2.36 m apart face-to-face, with 2.88 m clear under the hoop.
- ExpansionFrame_West/East 752 each at (±9.6, 0, −3.9): a pine lean-to skeleton, a plank stack and a lashed tarp bundle. It signals "the workshop grows here".

## Materials (9, all opaque)
| Material | Texture | Roughness / metal |
|---|---|---|
| Timber_Oak | 512² grain | 0.82 / 0 |
| Timber_Pine | 512² grain | 0.75 / 0 |
| Stone_Warm | 512² voronoi blocks | 0.90 / 0 |
| Roof_Terracotta | 512² staggered tiles, subtle moss | 0.78 / 0 |
| Plaster_Lime | 512² mottle | 0.92 / 0 |
| Iron_Wrought | 512² mottle | 0.55 / 0.6 |
| Cloth_Banner | 512² weave | 0.95 / 0 |
| Brass_Trim | none | 0.35 / 0.85 |
| Lantern_Glow | none; emissive amber, strength 3 | 0.5 / 0 |

UVs are box-projected per part, with grain along each part's long axis and texel density set by world scale.

## Integration: what replaces what in `world_zones.gd::forge()`
**`forge_shelter.glb` replaces:**
- the 4 corner posts
- the two 17.4 m wall-plate boxes
- the rafter `line()` loop
- the two roof slabs and the tile `line()` loop
- the three rear stone wall boxes (both flanks and the lintel)
- the four rear pilasters at x ±8/±4
- the two chimney boxes

**Keep:**
- the floor slab
- the `FoundryGate` node, its body and label (the label now reads against the plaster tympanum)
- `ForgeSmoke` (move it to the socket above)
- `glow_light`
- garden walls, trees, flowers, path, crates, waystones and signs

**Lanterns:** the kit lanterns replace the visual role of `lantern(±7.5, 3.4, −0.4)`. Keep or retarget those lights onto the four `light_socket`s. Turn shadows off on at least three of them for VR cost.

**Can be added without blocking gameplay:**
- ForgeCrest, Banners and Lanterns: all above 2.55 m, with no collision needed.
- ToolRacks: flat against the rear wall, behind the tables.
- ExpansionFrames: outside the side bays, clear of the trees at (±11, −9) and (±12, 3).
- EntryArch: straddles the path. The approach raycasts to Brann and both boards still pass. Its posts at x ±1.3 need their two collision boxes.

**Tier upgrades:** the shell leaves the front and both sides open and only the rear is walled. Expansion can attach at the side plates/mid-posts, or you can swap the ExpansionFrame modules for real wings.

**Collision:** use the boxes in layout.json only. That means 10 posts, 2 rear-wall flanks and the over-gate panel, plus the listed kit boxes. The roof, trusses and all decoration need no colliders.

## Known limits
- Tile courses intersect under the cross-gable, and the chimney passes through the rafters, purlins and tiles without cut-outs. Neither is visible at play distances.
- The stone arch reads slightly proud of the jambs at the springers.
- Verification so far is the Blender re-import with raycasts and renders only. Godot import and headset review are still to do; run `python scripts/asset_lab.py inspect <spec> output/forge_shelter.glb` as the next gate.
