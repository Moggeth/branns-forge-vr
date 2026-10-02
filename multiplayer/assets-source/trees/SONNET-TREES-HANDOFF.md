# Orchard tree kit — handoff (Sonnet 5.5, visual assets only)
Run: `blender.exe --background --factory-startup --python-exit-code 2 --python build_trees.py -- --out ABS_DIR [--no-render] [--samples N]` (about 7 s total, deterministic). Deliverables are in `out/` (copied alongside this file): `source.blend` (textures packed, assets spread along X), `front/three_quarter/overhead.png` (real Cycles renders of tree.glb, 800 px), `tree*.glb`, `log.glb`, `endcap.glb`, `tree_contract.json`, `textures/*.png`.

## Contract (verified by parsing each GLB)
Metres, +Y up, -Z front, origin = exact trunk axis at ground. Root node `Tree`; meshes `Trunk`, `Roots`, `Branches`, `Leaves`, `Fruit` (LOD has no Fruit); empties `Ground` (0,0,0), `CutGuide` (0,1,0), `Crown` (centre of leaf mass, about (0.03,4.55,0.24)), `FallTip` (about (0.19,5.95,-0.07)). No cameras or lights.

| asset | tris | meshes | materials | images | size | notes |
|---|---|---|---|---|---|---|
| tree | 9543 | 5 | 3 | 2 | 1.05 MB | 6.0 m, mature |
| tree_lod | 2447 (25.6%) | 4 | 2 | 2 | 0.38 MB | 8-sided trunk, no fruit/twigs/tufts |
| tree_b | 8500 | 5 | 3 | 2 | 0.94 MB | asymmetric, leaning, 6.3 m |
| tree_b_lod | 2172 (25.6%) | | | | | |
| tree_young | 7511 | 5 | 3 | 2 | 0.83 MB | 4.1 m sapling |
| tree_young_lod | 1897 (25.3%) | | | | | |
| log | 496 | 1 | 2 | 2 | 73 KB | 1.1 m x 0.32 m, long axis +Y, centred, `Grip` at origin |
| endcap | 256 | 1 | 1 | 1 | 44 KB | unit radius in XZ, 0.025 m thick, top +Y |

Materials: `Bark`, `Leaves`, `Fruit` (flat red via vertex colour), `EndGrain`. Three shared 512 px painted maps in total (bark, leaf, end-grain), embedded as JPEG q85.

## Trunk for cutting
`Trunk` runs from y=-0.1 (buried, no bottom cap) to the fork (3.1 m for `tree`). Rings are horizontal regular 12-gons at fixed angles (30 deg x j), so the lower trunk edges are vertical. The axis is exactly x=z=0 below 2 m and only leans above that. The mesh is a hollow shell with no interior geometry, and it is linear between rings, so interpolating the contract radii is exact. Contour deviation is at most 6.3% (budget 8%). The only flare is in the bottom 0.3 m. `Roots` is a separate mesh that stays as the stump. The first limb starts at y=2.51 (tree). Full per-ring data (`radius_mean/min/max`, `axis_x/z`) is in `tree_contract.json` -> `trees.*.trunk_samples`.

`tree` radius by height (mean): -0.1/0 0.420, 0.12 0.369, 0.3 0.2745, 0.6 0.266, 1.0 0.254, 1.4 0.243, 1.8 0.231, 2.0 0.225, 2.37 0.204, 2.73 0.183, 3.1 0.162.

## Vertex colours (important)
`COLOR_0` carries real shading, not white: darker underside/inner crown, lighter and warmer on top, moss and ground darkening on bark. It is a linear multiplier on albedo. Godot needs `vertex_color_use_as_albedo=true` (the importer normally sets this when COLOR_0 exists). Without it the crown loses its depth shading.

## Endcap / log usage
Endcap UV is a planar disc: the texture circle edge is the bark rim, so scaling XZ to the trunk radius puts bark at the cut edge. The log's two end caps and two sawn branch stubs use the same end-grain texture. Log ends have a splintered lip.

## Honest limitations
- The first render pass was improved once (stronger crown shading, calmer leaf texture, rounder hanging tufts, larger ground). Crown reads as layered irregular masses with warm accent leaves, but it is still somewhat blobby and dense: the limb structure is mostly hidden inside the canopy from a distance, and hanging twigs and fruit are sparse and small (fruit is largely occluded in the renders). Next pass should add wider gaps between masses, more visible limbs under the crown and more hanging twig volume.
- Leaf masses are flat-shaded displaced icospheres (3 detail levels); leaf detail comes from the box-mapped painted texture, not alpha cards.
- Not tested in Godot or VR. Trunk top has a small cap hidden by `Branches`. I did not render tree_b, tree_young, log or endcap images, so only their geometry stats were checked, not how they look.
- Render uses a flat grass disc and plain sky; no scene lights/cameras are exported (they live only in `source.blend` as Studio_*).
