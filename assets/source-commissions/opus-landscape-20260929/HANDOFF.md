# Geological vocabulary — handoff (Claude Opus 5.5, `claude-opus-5-5`)

## Rebuild (≈4 s including 14 Eevee previews)
```
..\..\tools\blender-4.5.13-windows-x64\blender.exe -b --factory-startup --python build_geology.py
```
Add `-- --no-render` to skip previews. Everything is seeded (random.Random and noise offsets), so reruns give the same result. Outputs go to `out/`: `geology_vocabulary.blend`, `glb/*.glb`, `previews/*_{close,threequarter}.png`, `contact_sheet.png` and `manifest.json` (triangles, vertices, materials and Godot-space bounds).

## Families
| Asset | Tris | Mats | Role |
|---|---|---|---|
| geo_boulder_mossy_a | 320 | 1 | Round, heavily mossed woodland boulder |
| geo_boulder_split_b | 640 | 1 | Two-lobe, frost-split boulder with a tall silhouette and a readable cleft |
| geo_slab_streamside_c | 320 | 1 | Low slab or stepping-stone for brook edges. Reads well from overhead |
| geo_outcrop_bank_straight | 496 | 1 | 4 m modular stratified bank, face toward −Z |
| geo_outcrop_ridge_tall | 496 | 1 | 3 m by 3.2 m leaning ridge or cliff module |
| geo_earth_rupture_roots | 1576 | 2 | Heaved soil-plate ring, thrust shards and 7 torn roots |
| geo_spell_spire | 546 | 2 | Basalt-like hex column cluster with inset glowing rune seams |

## Art reasoning
- **Shape:** Rocks are noise-displaced icospheres cut by 4 random cleavage planes. This gives chiselled facets instead of blobs or primitive stacks. The shapes are flat-shaded and low-poly to match the stylised orchard and brook references.
- **Colour:** All colour is per-corner vertex colour on a single opaque `geo_rock` material:
  - Warm stone variation
  - Ground-contact darkening (fake AO)
  - Pale chip highlights on Voronoi cell edges
  - Moss on up-facing surfaces, broken by noise
  - Sine strata bands with pale bed tops on the outcrops
  - Torn-soil brown on the inner and under faces of the rupture
- **Wet/dry:** Vertex colour **alpha is a wetness mask**: 1 at the ground or waterline, fading out by about 1/3 of the height. The glTF export uses it as colour only. To get the wet response, add a small Godot shader (or StandardMaterial override) that darkens albedo by ~35% and lowers roughness from 0.85 to 0.3 by `COLOR.a * wet_level`. No transparency is used anywhere.
- **Outcrops:** Each stratum juts out at its base and recesses at its top, which gives real ledges. The X ends taper into the terrain, so modules overlap along a bank without visible seams. The back face is buried at +Z 0.6–0.8.

## Placement and collision
- The origin sits at ground contact (y=0). Every asset has a buried skirt down to −0.2…−0.6 m, so it tolerates slopes up to about 25° when aligned to the terrain normal. On steeper ground, sink it by `0.4 * tan(slope)` m.
- **Outcrops:** Yaw the −Z face toward the stream or downhill, and snap along the bank tangent at about 3.4 m (bank) or 2.6 m (ridge) spacing so the tapered ends overlap.
- **Boulders:** Random yaw and uniform scale 0.6–1.6 are safe. Non-uniform scale up to ±15% is fine.
- **Collision:** Use a convex hull per boulder (and 2 hulls for split_b). For outcrops, use a box of the manifest bounds or a trimesh as static geometry only. For the rupture, use a cylinder (r≈1.4, h≈0.8) and ignore the roots. For the spire, use a capsule or cylinder (r≈0.9).
- **Spell rise:** Animate the spire's node y from −3.8 to 0. The buried skirt hides the seam, and you can add dust VFX at the rim. The rupture can scale y from 0.1 to 1 with a quick overshoot.

## Performance
Every asset is ≤1.6k tris and 1–2 draw surfaces. The rock material is shared, so MultiMesh or instancing batches well on Mobile. The GLBs are small; see `bytes` in the manifest. Only the rune material is emissive, and it is opaque.

## Verified
- Blender 4.5.13 builds, exports and saves the .blend (`GEOLOGY_OK 7`).
- Godot 4.7.2 headless `--import` into a Mobile-renderer scratch project (`out/godot_check`) produced 7/7 imported scenes with no ERROR lines.
- I reviewed the contact sheet visually.
- Not verified: in-game lighting, the look of the wet shader, and whether Godot's default import turns on `vertex_color_use_as_albedo`. Check this; if rocks import white, enable it on `geo_rock`.

## Known limits
- The rupture roots are simple 6-sided tubes and can look spindly up close in VR. There are no LODs, since the tri counts are already low.
- The outcrop underside is closed but flat.
- There is only one spire variant. To get more, reseed it via `random.Random(91)`.
- The stone palette was tuned by eye against the references and should be checked under the game's actual sun.
- The timebox was about 15 minutes, so only two refinement passes were made.
