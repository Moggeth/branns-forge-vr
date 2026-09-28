# Woodland environment kit: handoff

This kit is 9 opaque low-poly assets in 5 families, built for the enchanted Orchard (Godot 4.7.2 Mobile). It was authored procedurally by a deterministic Blender 4.5.13 builder and integrated into `godot/assets/atmosphere/woodland/`. The playable game scatters these GLBs from `orchard_dressing.gd` according to the same terrain mask used by `orchard_ground.gd`. `docs/ATMOSPHERE.md` describes the whole rendering system.

| id | family | tris | size W×H×D (m) | notes |
|---|---|---|---|---|
| fern_sword | fern | 1180 | 1.24×0.55×1.33 | 9 arching fronds, folded pinnae, 2 coiled fiddleheads |
| fern_lady | fern | 1288 | 0.78×0.57×0.62 | upright vase, lacy lobed (bipinnate-look) pinnae |
| fern_bracken | fern | 696 | 1.31×0.52×1.09 | 3 bare stalks with horizontal deltoid blades (tiered umbrella) |
| grass_tuft | grass_flower | 234 | 0.44×0.45×0.50 | 18 creased, tapering blades, dark root → light tip |
| flower_clump | grass_flower | 545 | 0.32×0.31×0.31 | strap leaves, cream daisies and nodding lilac bells |
| branch_fallen_mossy | wood | 477 | 1.79×0.37×0.77 | bent tapered log, forked twigs, jagged break, moss cushions, shelf fungi |
| rock_mossy_boulder | rock | 140 | 1.19×0.64×0.99 | rounded faceted boulder, moss cap and cushions, wet base and damp streak |
| rock_mossy_slab | rock | 152 | 1.52×0.43×1.03 | three stacked strata (echoes the stepped mountains), moss on ledges |
| litter_leaf_cluster | litter | 620 | 0.78×0.04×0.74 | 52 curled, folded leaves (ochre, rust, olive), twigs, pebbles, acorn caps |

`manifest.json` holds the exact Godot-axis bounds, triangle and material counts, seeds, byte sizes and sha256 values.

## Conventions
- **Units:** metres. **Up:** Godot +Y. **Origin:** the centre of the ground contact, with min Y = 0 exactly. Rock, branch and litter footprints are centred on the origin; plants are centred on their root crown. For rocks on uneven terrain, sink each instance 3–5 cm.
- **Forward:** the authored front is Blender −Y, which is glTF/Godot +Z (`Vector3.MODEL_FRONT`). Plants and litter are radial, so a random Y rotation is safe. The branch's long axis runs along X. The boulder's damp streak faces Godot −Z.
- **One mesh, one surface, one material per GLB,** so each asset drops straight into `MultiMesh.mesh` at one draw call per MultiMeshInstance.

## Art choices
- **Palette atlas, not per-part materials.** A 256² albedo map and an ORM map hold 16 swatches. Each swatch is a dark→light horizontal ramp, and the UVs choose both the swatch and a position along the ramp. That gives gradients (dark crown → light frond tip, lighter up-facing facets) at zero extra draw cost. Both images are embedded in every GLB (about 4.5 KB) and use a NEAREST sampler (Godot imports this as `texture_filter = NEAREST_WITH_MIPMAPS`).
- **Roughness is per swatch** (ORM G channel): dry rock 0.92, moss 0.80, bark 0.90, petals 0.55, and wet rock 0.30 falling to about 0.18 at its dark end. Rocks put the wet swatch on the lower 18% and the downward faces, plus a noise-driven damp streak on one side, so near-eye speculars show a wet waterline.
- **Two shared materials:** `kit_palette_1s` (backface-culled, used by rocks and branch) and `kit_palette_2s` (double-sided, used by foliage and litter). Everything is opaque. There are no alpha-cutout cards and no billboards, so there is no overdraw or alpha sorting in VR.
- **Style match:** flat-shaded facets, muted sage and olive greens and warm browns sampled from `current-ground.png` and `current-camp.png`. Moss was desaturated after the first review pass so it doesn't out-shout the trees.
- **Distance:** the far column of the contact sheet (40 px renders) shows each silhouette still reads as star rosette, vase, umbrella, tuft, speckle, log, dome, stepped slab and scatter.

## Performance budget (as built)
- Foliage: 234–1288 tris. Rocks: 140–152. Branch: 477. Litter: 620. The whole kit is 5332 tris; each GLB is 20–138 KB.
- Suggested MultiMesh use: dense fern and grass drifts near paths; rocks and branches sparse. Use Godot's import LOD generation (on by default) or `visibility_range_end` of about 40–60 m on foliage MultiMeshes. The litter cluster is 4 cm tall, so it can be culled at about 25 m.
- Draw calls: 1 per MultiMeshInstance. If each GLB's material is extracted to one shared `.tres`, the whole kit batches on 2 materials.

## Rebuild and install (from the repository root)
```
python scripts/rebuild_woodland_kit.py
```
The script runs Blender, updates `source/`, `textures/`, `glb/` and `manifest.json`, copies nine GLBs to the game, imports them with Godot, and requires `ATMOSPHERE_ASSET_RESULT []`. `--no-import` only rebuilds and copies. For another art review, run `render_sheet.py` in Blender from this directory and label the result with `label_sheet.py`. The existing contact sheet is an approved snapshot, not automatically refreshed by the fast rebuild command. `godot_verify/` is the specialist's isolated disposable validation project; the authoritative playable import is under `godot/`.

## Files
- `build_kit.py`: the deterministic builder. Seeds are fixed per asset; two rebuilds produced byte-identical GLBs.
- `source/woodland_kit.blend`: the editable scene, one collection per family, with the palette packed.
- `glb/*.glb`: 9 self-contained assets.
- `textures/kit_palette_{albedo,orm}.png`: loose copies of the embedded atlas.
- `manifest.json`
- `render_sheet.py`, `label_sheet.py`
- `renders/contact_sheet.png`: close / 3/4 / far for every asset, re-rendered from the imported GLBs.
- `renders/kit_lineup.png`: the Blender EEVEE hero shot.
- The original isolated Godot import render, import report, and verification project remain in ignored `work/opus-atmosphere-20260929/`. The playable game has its own import check at `godot/atmosphere_asset_check.gd`.

## Verification done
1. Each GLB was re-imported standalone into a clean Blender scene: 1 mesh, triangle count equal to the manifest, min Z = 0, both images packed. All passed (`renders/import_check.json`), then rendered in EEVEE.
2. In Godot 4.7.2 Mobile, each GLB imports as 1 surface with albedo and roughness textures, transparency disabled, and cull disabled or back as intended. AABBs start at y = 0. Each built a 9-instance MultiMesh and rendered with shadows.
3. The build is deterministic: sha256 matched across two builds.

## Known issues / next steps
- Rocks are deliberately very low-poly (140–152 tris). For hero rocks next to the forge, raise `ico(1.0, 2)` to subdiv 3 in `build_boulder` (about 4× the tris).
- Moss cushions are separate flattened shells that overlap the rock slightly. This is fine for opaque rendering, but they are not watertight with the rock.
- Godot extracts the embedded atlas once per GLB (`<asset>_kit_palette_*.png`), leaving 9 tiny identical 256² copies. The game uses one runtime shader material per foliage family, but extracted imported textures remain duplicated. Consolidating them is a future import-size optimisation, not necessary for frame rate.
- Double-sided foliage relies on Godot's back-face normal flip. The undersides of fronds get the same colour as the tops; there is no separate underside tint.
- Bracken reads a little sparse at eye level by design (it has an open-canopy silhouette). Scatter it in groups of 3–5.
- No wind data is authored. For a vertex-shader sway, UV.x (the ramp position) roughly tracks the base→tip gradient on foliage and could serve as a height mask.
- No collision shapes; this is a visual-only kit.
- The contact-sheet camera framing is automatic, so some close tiles crop wide fronds.
