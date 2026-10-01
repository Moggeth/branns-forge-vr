# Artist iteration 2 — handoff (Sonnet 5.5)

All files under `output/godot/` mirror `res://` paths; copy over the checkout. Nothing in the checkout was touched.

## Verified here / not verified
- Verified: `tree_kit.gd` and `ground_garden_art.gd` parse (`--check-only`); the palette shader, the Orchard shader and the tree shaders compile on the real Vulkan renderer with no errors; an isolated apple tree on a plane renders with warm-top/cool-underside canopy, no visible holes, and a dappled shadow (`output/preview/tree_dapple_shadow_isolated.png`).
- Numerically simulated the Pinewood colour chain on the real maps. Old chain gave mean sRGB about (1,0,0), i.e. black, which matches your capture. New chain gives about (100,67,22) before lighting.
- NOT verified: garden helper rendering (props not in the isolated project), and no in-game capture of Orchard or Pinewood. Native capture is yours.

## 1. Pinewood / shared palette (cause of black)
Root cause: `colour = (colour - 0.32) * contrast + 0.32` is applied per channel in LINEAR space. 0.32 linear is sRGB 0.60, so every dark loam texel (mean sRGB 63,46,20) was crushed to 0, after the tint 929b78 had already darkened it again.
- `ground_surface_palette.gdshader`: contrast now acts on luminance only, about a low pivot (0.10 linear), hue-preserving, never crushes a channel. Chroma lift 1.10 -> 1.06. All uniforms preserved.
- `assets/ground-surface-kit/materials/loam_albedo.png` (REVISED, drop-in same name; source untouched in the checkout, generator in `output/tools/make_loam_albedo.py`): re-graded to a warm leaf-mould -> soil -> sunlit duff ramp, mean (114,83,47), grain halved by blending with a tile-wrapped blur and re-stretching.
- `ground_surface_palette.gd`: Pinewood tint 929b78 -> e6dcc0, drift (0.72,0.92,0.80,0.34) -> (0.90,1.0,0.84,0.30). Loam tile 0.40 -> 0.24/m (repeat ~4.2 m, was 2.5 m); accent 0.34; contrast 1.08; loam normal strength 0.40.
- Side effect, intentional: mushroom_glade and gloamfen also use loam, so their tints/drifts were lifted too (c4d4c0 / b0c4bc) to keep them cool rather than suddenly brighter. Other families only pick up the shader's contrast fix (contrast values 1.22 -> 1.08/1.04).

## 2. Orchard ground (`assets/orchard_kit/orchard_ground_visual.gdshader`)
All uniform names, exposure/path/weather/normal code untouched. Changes are only in the grass colour stage:
- Speckle cut: albedo luma influence 0.62 -> 0.30, hue transfer 0.20 -> 0.10, fine noise 0.93-1.06 -> 0.975-1.03, clump 0.92-1.04 -> 0.965-1.03, near tufts 0.93+0.12 -> 0.965+0.07.
- Richer palette defaults (no GDScript sets these): cool teal-green (0.13,0.37,0.24), lush (0.40,0.66,0.20), warm gold (0.76,0.72,0.26), clover (0.26,0.55,0.34).
- New low-frequency painterly light, no new texture reads: field value drift 0.76-1.20; 25-60 m sunlit gold-green pools and cool blue-green shade pools (`glade`); pale wildflower-blush drifts (`bloom`, ~13 m scale). Big deliberate colour shapes at VR range, calm grain close up.

## 3. Flowers: NEW `ground_garden_art.gd`
`static func flowers(p, pos, count, spread, color := "fff0bd") -> void`. Delegation in world_zones.gd:
```gdscript
const GardenArt = preload("res://ground_garden_art.gd")
static func flowers(p: Node3D, pos: Vector3, count: int, spread: float, color: String = "fff0bd") -> void:
	GardenArt.flowers(p, pos, count, spread, color)
```
- Uses the ground-surface-kit GLBs `meadow_flowers` (bouquets, scale 1.7-2.8), `grass_tuft` (1.5-2.4), `seedhead_grass` (0.9-1.5). Garden-bed layout: 2-3 irregular drifts per call, sunflower-spiral packing inside each, grass skirting the drifts, seedheads at the rim.
- Cost: at most 3 MultiMeshInstance3D per call (old code: one MeshInstance3D per stalk, petal and centre), caps 14 / 18 / 8 instances, `cast_shadow` off, visibility end 40 m. Worst call (count 45) is about 14x772 + 18x476 + 8x1076 = about 28k triangles, within visibility range only; the busiest zones make 7-8 calls, so check frame time in Pinewood.
- Deterministic (seed from pos/count/spread), y = pos.y (no ground probing), no collision, no resource meta. Non-default `color` tints petals via a cached duplicate of the bouquet material (55% albedo tint, stems stay green); the default cream is untinted. Meshes are cached statics.

## 4. Trees (`tree_kit.gd`, real foreground path: `tree_material()` / `_SHADER_CODE`)
- Canopy surface variation (leaf vertices only, identified as green-dominant vertex colour; bark, fruit and glow fungus keep authored colour): sun-facing tops lean warm yellow-green, undersides cool blue-green, plus 0.5 m / 1.6 m clump noise in tree-local space (does not swim with wind). Applies to every tree LOD since they share the material. Wind vertex code, emission, roughness and LOD logic untouched.
- Dappled shadows: in `build_into`, when `shadows` is true and lod is "near", the visible Crown stops casting and gets a child MeshInstance3D twin (`CrownShadow`) with `SHADOWS_ONLY` and `shadow_material()`: the same shader, same mesh and same wind code (shadows still match the sway), but leaf fragments are discarded by ~0.35 m clump noise, so shadows read as filtered light through foliage. Trunks, fruit and bark are never punched. It is a child of Crown, so it follows the transform, visibility, chopping and freeing; `lod_switch` visibility range is copied onto it. Cost: no extra main-pass triangles; shadow-pass triangles are the same as before (the shadow caster moved from Crown to its twin). Isolated test showed no visible holes in the canopy. Tune `h < 0.34` in `_SHADOW_DAPPLE` (higher = more light through; 0.25 is subtle, 0.42 is lacy).
- NOT covered: `make_grove` multimesh trees keep `shadows` off by default, and the far LOD mesh still casts solid shadows beyond `lod_switch`. Choppable Trunk meshes cast normally. If a scene sets `shadows` on a grove it keeps a solid shadow.

## 5. Root clustering (orchard_tree_positions)
Suggested: 5-7 loose groves of 3-5 trees. Place trees inside a 6-9 m radius with a minimum 3.2 m centre spacing (roots reach about 1.2-1.6 m), leave 16-26 m open meadow between groves, and add about one in six trees as a solitary specimen on a knoll. Alternate seeds so no two neighbours share a variant. Same tree count as now: it only moves them, so the open meadow gains the garden clusters and the groves read as real canopies with overlapping dappled shadows.

## Altered files (all under output/godot/)
- `ground_surface_palette.gdshader`
- `ground_surface_palette.gd`
- `assets/ground-surface-kit/materials/loam_albedo.png` (revised map; reimport needed; its `.import` already exists in the checkout)
- `assets/orchard_kit/orchard_ground_visual.gdshader`
- `ground_garden_art.gd` (new)
- `tree_kit.gd`
- Extras: `output/tools/make_loam_albedo.py`, `output/preview/tree_dapple_shadow_isolated.png`
- `world_zones.gd` is NOT included; apply the 3-line delegation above.
