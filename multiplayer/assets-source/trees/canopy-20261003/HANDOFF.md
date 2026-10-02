# Tree canopy and harvest art: HANDOFF (Opus 5.5, 2026-10-03)

**Status:** asset replacement candidate, machine-checked, with Blender renders reviewed. It has **not** been validated in Godot, the browser or a headset; the root does that.
I edited nothing outside this folder. There are no runtime, simulation, wind, cutting, collision or log-physics changes.

## What to integrate (drop-in, same filenames)
`out/tree.glb tree_b.glb tree_young.glb tree_lod.glb tree_b_lod.glb tree_young_lod.glb log.glb endcap.glb` -> `multiplayer/public/assets/`
`out/tree_contract.json` -> `multiplayer/assets-source/trees/` (same schema plus `palette_presets`). Source: `build_trees.py` + `out/source.blend`.

- The 5 instanced parts are the same: Trunk, Roots, Branches, Leaves, Fruit (the LODs have no Fruit). The 3 materials keep their names: Bark, Leaves, Fruit.
- There are still 2 JPEG 512 maps per tree. There are no new materials, no alpha, no new shader and no extra draws.
- `tree-view.js` `windMaterial()` still clones the `Leaves` material, and the existing wind applies unchanged. I added no wind code.
- `log.glb` and `endcap.glb` geometry comes from the frozen code. Only their textures changed: the shared bark map, and a new end-grain map.

## What changed (`build_trees.py`; frozen skeleton plus a new canopy pass)
- **Frozen path:** `plan_tree()` runs unchanged, including its RNG stream, so Trunk, Roots, limb skeleton, leader, `FallTip` and `first_branch_start_y` are all identical. `restyle_canopy()` then uses its *own* RNG (seed×1009+17) and only replaces the clumps, fruit and twigs, and refits the crown.
- **Signature canopy (`shell_points`/`make_lobes`/`leaf_mass`):** each clump is a single closed shell built as a union of 5-7 lobe spheres. It is ray-cast from the clump centre along icosphere directions, so there is no hidden interior geometry and no overdraw.
  - Lobe creases are detected (best vs second-best hit) and baked as cavity AO into COLOR_0. One 320-tri shell therefore reads as several leaf clusters with depth.
  - Big sunlit lobes sit on top and on the outer side; the underside is softly flattened.
  - Custom normals are 82 % clump-radial and 18 % face, giving soft volumetric "stylised foliage" shading. They are exported as glTF NORMAL.
  - Triangle use per clump matches the frozen kit: 320 for major/cap/first-side clumps, 80 for small ones. The LOD uses 80-tri shells of the *same lobes*, so the far silhouette matches.
- **Branches:** branch collars where limbs leave the trunk (Branches mesh only), and 2 thin 4-sided twigs per limb feeding each tip clump.
- **Fruit:** 6×4 apple with a calyx dimple and blush. A quarter of the hanging apples were removed, and one apple is nestled into the sunlit outer face of each tip clump so the crop reads from RTS height. Per-part tris: tree went from Branches 1513 / Fruit 1364 / Leaves 5680 to **1793 / 1002 / 5680**. The fruit savings pay for the twigs and collars.
- **Textures (512, deterministic numpy):**
  - Bark: scaly apple-bark plates with irregular widths (still seamless), short offset flakes with lifted pale lips, furrows and lichen.
  - Leaf: smaller, crisper leaves with darker interstitial depth and fewer confetti accents.
  - End grain: sharp latewood annual rings, pith, sap/heart boundary, medullary rays, drying checks, faint saw marks and the bark rim.
- **Palette presets (metadata only):** `tree_contract.json.palette_presets` holds `orchard_summer` (identity), `late_summer_gold` and `highland_cool`. They are linear RGB multipliers per named material (Three `material.color`, Godot `albedo_color`). No new system is needed; the root can apply one to the cloned materials or ignore it.

## Contract proof (actual exported GLB bytes; rerun with the commands below)
- `compare_trunk.py out_legacy out` prints `ALL TRUNK/ROOTS ACCESSORS + HIERARCHY EXACT` for **all 6** tree GLBs.
  - It SHA-1 compares the indices, POSITION, NORMAL, TEXCOORD_0 and COLOR_0 of **Trunk and Roots**, plus the material slot.
  - It also checks the node-name set and the transforms/children of Tree, Trunk, Roots, Branches, Leaves, Fruit, Ground, CutGuide and FallTip.
  - `out_legacy/` is the frozen `reference/.../opus-refined/build_trees.py` rebuilt here. Its `tree.glb` is byte-identical (`cmp`) to the shipped `reference/multiplayer/public/assets/tree.glb`.
  - `compare_trunk.py reference/multiplayer/public/assets out` also passes. That dir has only tree/tree_b/tree_young/tree_lod; the other two LODs are skipped there.
- `node cut_fixture.mjs` runs the **frozen runtime** `tree-carve.js` (`buildNotch` for cuts 1/2, `buildFelled` for cut 3) and `shared/trees.js` (`notchFor`, `treeFall`, `trunkRadius`). It does this on old and new GLBs for tree, tree_b and tree_young, and prints `CUT FIXTURE PASS`.
  - Carved bark/wood/stump/top triangle hashes are identical old vs new. Open edges are 14 both before and after (the pre-existing buried open bottom).
  - The hinge is identical, e.g. tree (-0.1637, 1, -0.19435), and the fall angles at ticks 0/20/40/400 are identical.
  - The lowest Branches/Leaves/Fruit y are 2.38/3.30/3.57 (tree), 2.28/3.16/3.35 (tree_b) and 2.15/2.63/2.67 (young). All are clear of the 0.4-1.6 m cut range by more than 0.3 m.
  - The full report is in `out/cut_fixture.json`.
- `FallTip` and `first_branch_start_y` are unchanged. Top heights are exact for the high meshes (6.000 / 6.300 / 4.100), matching `TREE_PROFILES`.
- `Crown` (leaf-mass centroid) moved by 0.13 / 0.39 / 0.21 m. A grep of `client/` and `shared/` shows the runtime does not read it.
- `node validate_glbs.mjs out` (Khronos glTF-Validator, read-only shared module): **0 errors, 0 warnings** on all 8 GLBs.
- Axis: +Y up, -Z front, metres. Same root `Tree`, with no cameras or lights.

## Budgets (measured from the GLBs)
| asset | tris old → new | bytes old → new | meshes/mats/imgs | top y old → new | bbox X×Z old → new | canopy min y |
|---|---|---|---|---|---|---|
| tree | 9295 → 9213 | 465084 → 460456 | 5/3/2 | 6.000 → 6.000 | 5.73×4.71 → 6.21×4.72 | 3.30 |
| tree_lod | 2007 → 2007 | 168604 → 175336 | 4/2/2 | 5.967 → 5.999 | 5.89×4.87 → 6.35×4.70 | 3.31 |
| tree_b | 8128 → 8092 | 417360 → 418600 | 5/3/2 | 6.300 → 6.300 | 5.78×6.24 → 5.33×6.37 | 3.16 |
| tree_b_lod | 1772 → 1772 | 157348 → 164348 | 4/2/2 | 6.294 → 6.313 | 5.63×6.40 → 5.39×6.41 | 3.16 |
| tree_young | 7005 → 6933 | 372392 → 367344 | 5/3/2 | 4.100 → 4.100 | 2.89×3.25 → 2.79×3.41 | 2.63 |
| tree_young_lod | 1537 → 1537 | 144860 → 153000 | 4/2/2 | 4.090 → 4.103 | 2.94×3.38 → 2.77×3.49 | 2.62 |

- LOD ratio is 0.218 / 0.219 / 0.222.
- Draws per intact tree are unchanged: the 5 instanced parts with 3 materials (the LOD has 4 parts).
- `log.glb` grew 74796 → 93600 bytes and `endcap.glb` 43788 → 60828: the end-grain JPEG carries more ring detail. Triangles are unchanged (496 / 256).
- The tree_b crown is 0.45 m narrower in X and 0.13 m deeper in Z. The tree crown is 0.48 m wider in X.
  - The root should confirm that the tree-tree spacing/overlap is acceptable in the world layout. Collision is trunk-based and unaffected.

## Commands (run from this folder; one Blender process at a time, `--threads 2`, CPU Cycles)
```
B=C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe
"$B" --background --factory-startup --threads 2 --python-exit-code 2 --python build_trees.py -- --out <ABS>/out --samples 16 [--tree-only-renders | --no-render]
"$B" --background --factory-startup --threads 2 --python-exit-code 2 --python reference/multiplayer/assets-source/trees/opus-refined/build_trees.py -- --out <ABS>/out_legacy --samples 16   # before set
python compare_trunk.py out_legacy out          # + python compare_trunk.py reference/multiplayer/public/assets out
node cut_fixture.mjs out_legacy out             # writes out/cut_fixture.json + out/cut_meshes/
node validate_glbs.mjs out
"$B" --background --factory-startup --threads 2 --python-exit-code 2 --python render_cuts.py -- <ABS>/out 16
python make_sheets.py                           # contact_sheet.png, cut_sheet.png, before_after.png
```
Measured times are in `timing.csv`. The full build with 25 Cycles renders took 101-112 s, and only about 1.5 s of that is geometry, textures and export. The `--tree-only-renders` build took 32 s, cut closeups 21-24 s, and all three checks under 3 s. The session start → final assets was about 18 min (06:56 → 07:14 local).

## Deliverables
- `out/*.glb` (8), `out/tree_contract.json` (with `palette_presets`), `out/textures/{bark,leaf,endgrain}.png` and `out/source.blend` (editable, textures packed).
- Images:
  - `out/contact_sheet.png`: 3 trees × ground/eye-level, 3/4, RTS and front silhouette, plus the 3 LODs.
  - `out/before_after.png`: shipped vs new, same cameras.
  - `out/cut_sheet.png`: cut 1, cut 2, cut 3 mid-fall about the hinge, and the stump end grain.
  - `out/front|three_quarter|overhead.png` (hero, 800 px), `out/renders/*` and `out/cut_renders/*`.
- Scripts: `build_trees.py`, `compare_trunk.py`, `cut_fixture.mjs`, `render_cuts.py`, `make_sheets.py`, `validate_glbs.mjs` and `glbstat.py`. Logs are in `logs/`.

## Honest critique and limitations
- **Better than before (from the renders):**
  - Clumps are rounder and lobed, with visible leaf-cluster creases, so they read less as flat pads.
  - From eye level there is a clear limb → side-branch → clump hierarchy, with sky gaps.
  - Fruit is now visible from RTS height.
  - Bark reads as plated with lichen; the end grain has real rings, rays and checks.
- **Weaknesses:**
  - The silhouette still has some "umbrella pad" undersides, because widening the clumps for crown mass re-flattened them.
  - LOD shells (80 tris) look polygonal in silhouette close up. They are only intended beyond `lodDistance` (26 m).
  - tree_young still has a long bare trunk; that is fixed by the frozen trunk/fork contract.
  - Per-face triplanar leaf UVs have seams that are visible up close.
  - The bark flakes are subtle at game distance.
- **Not verified:**
  - Nothing has been rendered in Three/the browser, Godot or VR. Renders are Blender Cycles studio renders, not in-game.
  - Custom NORMALs on Leaves are assumed to survive GLTFLoader (standard glTF NORMAL; the validator is clean).
  - The visual effect of the existing wind on the new clumps is untested. Its displacement is ≤2.5 cm, so twigs may separate slightly at most.
  - `palette_presets` values are not applied or rendered anywhere. They are metadata for the root to try.
  - No gameplay play-test was run. Cut safety rests on the byte identity and the runtime-carving fixture above.
- **Root next steps:**
  1. Copy the GLBs into a disposable client checkout.
  2. Run the existing tree tests plus an in-browser ground/RTS capture.
  3. Check the LOD switch pop at 26 m and the intact-tree draw/program counts (`tree-view.js` stats).
