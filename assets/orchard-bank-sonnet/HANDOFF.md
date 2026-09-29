# Orchard bank props handoff
Rebuild: `blender.exe -b -P build_bank.py` (Blender 4.5.13, deterministic, outputs to `output/`, writes `bank.blend`, prints `BANK_BUILD_OK` only after asserts pass).

Assets (origin at ground contact, +Y up, glTF orientation, 512px JPEG base colour + packed roughness, one mesh/one material each; sizes and triangle counts in `output/stats.json`):
- `bank_boulder` ~1.2 m, 1280 tris. Wet dark lower band, moss cap.
- `river_slab` ~1.5 m x 0.22 m tall, 1280 tris. Strata, lichen, moss.
- `fallen_branch` ~2.5 m along +X, root flare at x=0, 3 stubs. Lichen/moss on the top side.
- `fern_patch` ~0.8 m wide, 11 solid lens-section fronds (no alpha, no paper-thin sheets).

Collision/instancing: use convex hull for boulder and slab, a capsule along X (radius ~0.15, length ~2.4) for the branch, and none for the fern (or a tiny sphere). Ignore the stubs for collision. Rotate instances around Y and scale uniformly by 0.8-1.25 for variety. Textures are tileable in u and carry no baked lighting. Roughness is low on the wet band, so it reads well in rain; base colour is mid-value for dusk. Fern and moss patches are scene-independent; no lights are in the GLBs.
Note: the preview ground and sky are only for renders; they are not exported.
