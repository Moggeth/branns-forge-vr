# Opus 5.5 orchard tree art refinement: HANDOFF (complete, 2026-10-03)

This pass refines the art only. The Sonnet kit's runtime contract is unchanged, and the coordinator integrates after its own tests.
The Sonnet handoff and renders are preserved in `before/` (`HANDOFF_sonnet.md`, `front|three_quarter|overhead.png`).
The top-level `front/three_quarter/overhead.png` in this folder are the original Sonnet inputs. The new renders are in `out/`.

## Commands (run from this folder, serialized single Blender process)
```
B=C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe
"$B" --background --factory-startup --python-exit-code 2 --python build_trees.py -- --out <ABS>/out --samples 24 [--tree-only-renders | --no-render]
python compare_trunk.py ../sonnet-browser-trees-20261003 out     # byte-compares every Trunk accessor, node names, Tree/Trunk/Ground/CutGuide transforms, material names
python make_sheets.py                                             # out/before_after.png + out/contact_sheet.png from the real Cycles renders
```
A full build with 15 Cycles renders (24 spp, CPU) took **13 s**. Building with `--tree-only-renders` took 5-8 s. Timing is measured in `timing.csv`. The whole session from start to this handoff took 369 s, and before/after was ready at 319 s.

## Deliverables (`out/`)
`tree*.glb` (6), `log.glb`, `endcap.glb`, `source.blend` (packed textures, editable), `textures/{bark,leaf,endgrain}.png`, `tree_contract.json`,
`front/three_quarter/overhead.png` (hero tree, 800 px, same cameras/light as Sonnet), `renders/` (15 per-variant renders, 480 px),
`before_after.png`, `contact_sheet.png` (all 3 trees front + 3/4 + RTS, and all 3 LODs 3/4 + RTS), `pass2/` (intermediate hero renders).

## Contract verification (actual GLB parsing)
- **Trunk: EXACT in all 6 GLBs.** `compare_trunk.py` printed `ALL TRUNK ACCESSORS + NODES EXACT`. It covers indices, POSITION, NORMAL, TEXCOORD_0 and COLOR_0 (SHA-1 byte equality), the material slot `Bark`, the node-name list, and the Tree/Trunk/Ground/CutGuide transforms. The Trunk code path, `make_rad`, `axis` and the trunk-defining params (seed, rb, r2, fork, top, lean, wig) were not touched. `first_branch_start_y` is also unchanged (2.514 / 2.418 / 2.255), because limb heights are drawn before any changed RNG call.
- **Log/EndCap: geometry and material slots EXACT,** and the end-grain image is byte-identical. The log's shared `bark` map is the new bark texture, as permitted.
- The node names, mesh set (Trunk, Roots, Branches, Leaves, Fruit; the LOD has no Fruit) and materials (Bark, Fruit, Leaves) are unchanged. There are still no cameras or lights.
- Heights are fitted exactly. The crown is stretched only above the fork (`crown_fit_scale`, never applied to Trunk/Roots): tree 6.000, tree_b 6.300, tree_young 4.100. The LODs come out at 5.967 / 6.294 / 4.090.
- Schema additions: only `canopy_bounds` (Leaves bbox) per asset. `Crown` and `FallTip` keep their meaning: Crown is the leaf-mass centroid, and FallTip is (leader x, H, leader z).

| asset | tris | LOD ratio | bytes | meshes / mats / imgs |
|---|---|---|---|---|
| tree | 9295 | | 465 084 | 5 / 3 / 2 |
| tree_lod | 2007 | 21.6 % | 168 604 | 4 / 2 / 2 |
| tree_b | 8128 | | 417 360 | 5 / 3 / 2 |
| tree_b_lod | 1772 | 21.8 % | 157 348 | 4 / 2 / 2 |
| tree_young | 7005 | | 372 392 | 5 / 3 / 2 |
| tree_young_lod | 1537 | 21.9 % | 144 860 | 4 / 2 / 2 |
| log / endcap | 496 / 256 | | 74 796 / 43 788 | unchanged geometry |

All budgets are met: draws ≤ 6, high ≤ 10k, LOD ≤ 35 %, 3 shared 512 maps, asset ≤ 1.4 MB. The GLBs are about 55 % smaller than Sonnet's, because the calmer textures compress better as JPEG.

## What changed (build_trees.py)
- **Bark texture:** I removed the six elliptical knot "eyes" and the big moss blotches. The new bark has warm vertical plates (5 per tile, 10 around the trunk) with dark furrows, painted shoulder highlights, offset horizontal plate breaks and sparse lichen flecks. It still tiles seamlessly on the unchanged trunk UVs, and moss and darkening at the base still come from the frozen COLOR_0.
- **Leaf texture:** fewer, larger leaves in soft value groups. The orange/yellow accents that read as confetti or fake fruit are gone. Leaf rims are stronger, and the UV scale changed from 0.42 to 0.55.
- **Canopy:** the old design was one large blob per limb, plus inner minors and hanging leaf "tufts". The new design is an open-centre scaffold:
  - limbs climb out at 30-55° with a 12 % longer reach;
  - one lobed clump sits *on top of* each limb tip, plus a lower, more horizontal side-branch clump and a smaller upper one;
  - there is a reduced crown cap and few inner clumps.
  - Clump undersides are flattened like clouds and their tops are lumpy. Clumps are smooth-shaded, with value carried by vertex colour: dark cool undersides, warm lit tops, and per-clump hue drift between yellow-green and blue-green.
- **Fruit:** a 7×5 low-poly apple with a dimple and a warm blush, hung on a visible stem just below the clump underside. There are 2-3 per limb.
- **LOD:** keeps the tip and side clumps (subdivision 2, R×1.10) and has simplified 4-sided side branches, so its silhouette matches the high mesh.

## Honest critique (from the actual renders)
- **Better:**
  - The limb architecture now reads clearly from the front and 3/4 views.
  - There are real sky windows between the clump layers, especially on tree_b. From overhead the gaps show limbs.
  - The bark is warm and directional, with no repeating blotches.
  - Fruit is visible from eye level.
- **Remaining weaknesses:**
  - The silhouette reads as layered "umbrella pads", more like a stylized acacia or bonsai than a classic rounded apple tree.
  - The upper crown of the hero tree still merges into one mass in the 3/4 view.
  - tree_young's small clumps look pom-pom-like.
  - From RTS height the fruit is hidden, as expected, since it hangs below the clumps.
  - Up close the bark plates are fairly regular and stripe-like.
  - Leaf clumps are smooth displaced icospheres with no alpha cards, so edges are hard.
- **Not verified:**
  - The trees have not been rendered in Godot, VR or the browser, and the vertex-colour/albedo behaviour is assumed to follow the Sonnet contract.
  - No gameplay cutting test was run here; only the byte-identity of the Trunk geometry was checked.
- **Next step if more time:**
  - Add a short "hanging twig" layer below the side clumps.
  - Give the hero crown cap a wider gap from the tip clumps.
  - Try a rounder apple-tree variant parameter (higher el0, smaller pad flattening) for comparison.
