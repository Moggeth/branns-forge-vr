# Siegebird Belt Quiver — handoff

Visual asset only. Runtime interaction (drawing/returning bolts) stays with Codex. Nothing outside this folder was touched.

## Deliverables
| File | Purpose |
|---|---|
| `output/quiver.glb` | Game asset, 2.75 MB, all textures embedded |
| `output/quiver.blend` | Editable source scene, textures packed |
| `build_quiver.py` | Deterministic builder: geometry, procedural textures, export and re-import check |
| `render_quiver.py` | Review renders (Cycles CPU, ~20 s) |
| `output/quiver_front.png`, `output/quiver_back_top.png` | Review views |
| `output/verify.json` | Machine-readable re-import report |

Rebuild (Blender 4.5.13 from the project tools, ~3 s):
```
..\..\tools\blender-4.5.13-windows-x64\blender.exe -b --factory-startup --python-exit-code 2 --python build_quiver.py
..\..\tools\blender-4.5.13-windows-x64\blender.exe -b output\quiver.blend --python-exit-code 2 --python render_quiver.py
```
Two consecutive builds produced byte-identical GLBs (SHA-256 `0B263A21…FA52B702`).

## Mounting (Godot frame)
- **Origin = belt attachment point**, at the centre of the belt loop. A belt about 5 mm thick and 40 mm tall, running along ±X, passes through the loop at the origin.
- +Y is up and −Z is forward. The body hangs in front of the belt plane (−Z). The only geometry behind the origin is the thin leather strap flap and its snap, which reach **+Z 0.0165 m**. There is no back plate.
- Root node `SiegebirdQuiver` has these child meshes: **`QuiverBody`**, **`QuiverMouth`**, **`BeltLoop`**, **`BoltFletching`**.

## Dimensions (measured on the re-imported GLB)
| | Min | Max | Size |
|---|---|---|---|
| X (width) | −0.094 | +0.098 | **0.192 m**, including the collar wings; the leather body is ≈0.16 m |
| Y (height) | −0.282 | +0.151 | Body with finial: −0.282 to lip top **+0.078**, so **0.36 m**. The decorative bolt tails rise to +0.151 |
| Z (depth) | −0.130 | +0.0165 | **0.147 m** |

- Mouth opening: the inside of the brass lip is about 0.155 × 0.105 m (X × Z), with the lip top at Y ≈ +0.078.
- The opening is horizontal and unobstructed. The three decorative bolts sit in the rear third and splay outward, so the front two-thirds of the mouth is clear.

## Geometry and materials
| Mesh | Triangles | Materials |
|---|---|---|
| QuiverBody | 7,574 | Leather, LeatherInner, BlackSteel, Brass, Crystal |
| QuiverMouth | 3,686 | BlackSteel, Brass, Crystal |
| BeltLoop | 722 | Leather, Brass, Crystal, BlackSteel |
| BoltFletching | 300 | Shaft, Brass, Fletch |
| **Total** | **12,282** | **7 unique materials**, 15 mesh surfaces (draw calls) |

Materials: `SQ_Leather`, `SQ_LeatherInner`, `SQ_BlackSteel`, `SQ_Brass`, `SQ_Crystal` (teal, emissive 1.2), `SQ_Shaft`, `SQ_Fletch`. `SQ_Fletch` is double-sided. All the others use backface culling.

Textures (all procedural and generated from fixed seeds, with no external or paid image services):
- `SQ_Leather_BaseColor` 1024², sRGB: dark pebbled leather, a tooled panel of overlapping siegebird feather scales on the front, and saddle-stitched side seams.
- `SQ_Leather_Normal` 1024², OpenGL/glTF convention: the grain, tooling and stitching relief.
- `SQ_Fletch_BaseColor` 256×64: ivory vanes with a teal band and an ember stripe.

VRAM is about 1.8 MB with VRAM compression and mipmaps, or about 11 MB uncompressed. Metals and crystal use flat PBR values with no textures.

Design notes: blackened steel collar, bands and base cup; a rolled brass lip; brass rivets; swept brass siegebird wings on the collar sides with crystal pins; a winged brass crest with a teal crystal on the front; a brass finial with a crystal drop; and a leather belt loop with a brass snap and steel keeper. The quiver shows no bolt count, number or purchase badge.

## Verification
`build_quiver.py` exports the GLB, then resets Blender and **re-imports** it. It asserts that:
- all four named nodes exist,
- there are at least 5 materials and 2 textured materials,
- every re-imported texture is non-black.

The report is written to `output/verify.json`. The first build caught a real bug here: the textures were exported black because the colourspace was set after the pixels were written. That is fixed and the check now guards against it.

## Limitations
- Checked in Blender only. It has **not** been imported into the live Godot project (that was out of scope). It should be imported once to confirm scale, the normal-map look and the attach transform.
- 15 surfaces is more than necessary. If draw calls matter, the small Brass/Crystal/Steel parts could be merged into one atlased trim material.
- There is no dedicated roughness or metallic map. Leather roughness is a constant 0.62.
- The bolt tails are fixed, decorative geometry inside `BoltFletching`, not physical bolts. Hide that node if the runtime shows its own bolts in the quiver.
- The leather texture stretches about ±7% vertically because the body bulges. This is not noticeable in the renders.
- There is no collision shape and no LODs. The asset is small enough to use as-is.
