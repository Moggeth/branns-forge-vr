# Authored zone art validation

Run this check on each `placement.json` before importing a new environment kit into Godot:

```powershell
python scripts/validate_zone_art.py godot/assets/zone_art/starfall_ridge/placement.json
```

The script checks the placement schema, local asset references, collision metadata, GLB container structure, embedded image data, triangle counts, and sampled winding against exported normals. It deliberately rejects an all-black base-colour image or a surface whose face orientation opposes its normals. Starfall Ridge once rendered with black materials because its Blender script changed image colour space *after* uploading pixels; another ground surface disappeared because its winding was inverted during axis conversion. These checks catch both failures before a game build. Pillow is required whenever a GLB has base-colour images.

The command emits one JSON object. `ok: true` means these structural checks passed, not that the zone looks good or plays well. Review actual Godot ground-level and elevated captures, test collision and traversal, and check native frame statistics separately. `triangles_unique` counts each GLB once; `triangles_instanced` estimates all placements before culling and LOD.

When validation fails, fix the source builder and rebuild the kit rather than editing the installed GLB by hand. Keep its builder, editable source, placement manifest, preview renders, collision intent, and handoff together in the source asset folder. The winding check was verified against eight correct triangles and the same eight with deliberately reversed normals; all four installed authored zone kits still pass.
