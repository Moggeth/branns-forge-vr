# Tree-cutting art kit handoff
Regenerate (deterministic): `blender.exe --background --factory-startup --python-exit-code 1 --python build_kit.py -- --out ABS_OUT_DIR`
(Blender 4.5.13, ~30 s incl. renders). Files: GLBs, kit.blend, textures/*.png, render_kit_contact.png, render_closeup_wounds.png, render_closeup_log.png, stats.json.

## Measured stats (glTF space, metres, Y up)
| file | tris | materials | size XYZ | bounds | file |
|---|---|---|---|---|---|
| log_y.glb | 864 | 2 | [0.381, 0.902, 0.381] | [-0.182, -0.451, -0.193] → [0.199, 0.451, 0.188] | 724 KB |
| cut_wedge_1.glb | 96 | 2 | [0.086, 0.242, 0.5] | [-0.036, -0.086, -0.25] → [0.05, 0.156, 0.25] | 700 KB |
| cut_wedge_2.glb | 96 | 2 | [0.238, 0.484, 1.0] | [-0.138, -0.172, -0.5] → [0.1, 0.312, 0.5] | 700 KB |
| cut_wedge_3.glb | 120 | 2 | [0.436, 0.725, 1.35] | [-0.266, -0.257, -0.675] → [0.17, 0.468, 0.675] | 702 KB |
| cut_endcap.glb | 224 | 2 | [1.988, 0.083, 1.993] | [-0.99, -0.05, -0.99] → [0.999, 0.033, 1.002] | 706 KB |
| chip_a.glb | 18 | 2 | [0.032, 0.1, 0.011] | [-0.013, -0.05, -0.005] → [0.019, 0.05, 0.006] | 696 KB |
| chip_b.glb | 22 | 2 | [0.032, 0.1, 0.012] | [-0.013, -0.05, -0.006] → [0.02, 0.05, 0.006] | 696 KB |
| skull_basket.glb | 2016 | 1 | [0.58, 0.278, 0.4] | [-0.29, 0, -0.2] → [0.29, 0.278, 0.2] | 153 KB |

Shared materials (opaque, embedded PNG 512², constant roughness .72-.9, no vertex colour, no COLOR_0): `bark`, `endgrain` (warm rings + 3 cracks), `wicker`. Materials are double-sided (Blender default). Smooth-shaded bark/wicker, flat-shaded fresh-wood facets.

## Placement
- **log_y**: Y main axis, centre origin, 0.88 m body, 0.90 m with end chips (bbox Y 0.902), mean radius 0.18 (bbox X/Z 0.381 incl. wobble). Bark shell, bevelled ends, endgrain cap (UV mapped for r=0.2) with 4 small chips per end. Runtime scaling fine (uniform recommended).
- **cut_wedge_N**: trunk radius = 1 m with trunk AXIS AT (-1,0,0); cut centre = origin on the trunk surface; +X outward, +Y up, Z tangent. Scale uniformly by trunk_radius_actual, place at (cut point on surface), rotate so +X = outward normal, translate to the actual cut height. Uses: bark scar lip ringing a fresh-wood facet pocket that sits ON the trunk surface (a raised rolled lip, outer edge embedded 4 mm into r=1 surface; wound floor ~1 cm above the surface). It does not need the trunk to be carved: it shows cut depth via the lip height. Extent (Y x Z, at r=1): stage1 0.24 x 0.50 (lip +0.05), stage2 0.48 x 1.00 (lip +0.10, 2x width/height), stage3 0.73 x 1.35 (lip +0.17) with 6 short splinters hinged on the lower facet. Lip and facets follow r=1 curvature; for much thinner trees (z-extent 1.35 x radius) it wraps ~ 2 x asin(0.54*1.25) of circumference (~85 deg) - stage 3 is intentionally wide, reduce Z scale if trunks are < 0.15 m radius.
- Stage transitions: hit1 show wedge_1; hit2 swap to wedge_2 (or cross-fade 0.1 s with a scale pop 0.9→1); hit3 swap to wedge_3 then run the fall. Same origin/rotation for all three so they swap in place. Emit chips at the origin.
- **cut_endcap**: XZ plane, normal +Y, radius 1 at r-edge (bbox 1.99 due to jitter), top face at y=+0.03, bevel lip to y=0, bark skirt to y=-0.05. UV maps ring texture across the full disc. No roots. Scale XZ by cut radius; y scale by ~radius so lip stays proportional. Place at the cut plane, +Y along the log/stump axis; flip (scale Y=-1 or rotate 180 about X) for the underside of a felled crown.
- **chip_a / chip_b**: length 0.10 along Y, 18 and 22 tris, origin centre. Alternating bark/endgrain faces.
- **skull_basket**: base at y=0 centred, +Y up, 0.58 (X, incl. handles) x 0.278 (Y) x 0.40 (Z), open interior floor at y=0.02, wall inner top y~0.205. Two raised handles at the ±X ends. No colliders/contents: put 3 skulls on the floor (~y 0.02+radius). Rim pose is symmetric, weave = 3D checker relief + 6x6 cell texture (u tiles 8x around, v = y/0.21).

## Limitations / honest notes
- Roughness is a per-material constant (no ORM map) and no normal map; weave/bark relief is texture plus modest geometry. No vertex tint used.
- The wedges were verified only in Blender Eevee against an unclipped proxy cylinder; not in Godot Mobile. Check flat shading and the lip embed on an actual trunk.
- Preview skulls in renders are proxy spheres and are not exported. cut_wound.gdshader was not needed and is not provided.
- Basket tris 2016 (<=3000), materials 1 each except log/chips/wedges/endcap (bark+endgrain), all within limits. Wedge 3 has hard splinters by design.
