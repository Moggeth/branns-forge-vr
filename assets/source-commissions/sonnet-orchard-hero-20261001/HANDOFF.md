# Hero orchard tree — handoff (finalized 2026-10-01, Sonnet 5.5, subscription only)

## Deliverable
`output/tree_kit.gd` is the drop-in replacement for `godot/tree_kit.gd`. `output/tree_kit.orig.gd` is the untouched original for diffing.
`output/test/tree_kit.gd` is byte-identical to the deliverable. The tool patch scripts are in `output/tools/`.
The finalize pass made **no source edits**. The file parsed and ran cleanly, so nothing needed fixing.
No new texture files were authored. Bark and leaf look is procedural/vertex-based in the existing MeshBuf architecture (`output/assets/` does not exist).

## Verification (native headless Godot 4.7.2, `tools/godot` console exe, disposable project `output/test`)
Script: `output/test/tris_check.gd`. Call: `build_into(node, species, seed, {height 4.8, dynamic_fruit, choppable, lod_switch 30})`.

| species | seed | near tris | far tris | build ms |
|---|---|---|---|---|
| apple | 7 | 4293 | 723 | 21 |
| apple | 11 | 4255 | 643 | 16 |
| apple | 23 | 5057 | 735 | 20 |
| apple | 41 | 4251 | 627 | 16 |
| apple | 58 | 4931 | 771 | 18 |
| pine | 7 / 23 | 617 | 212 / 252 | 3 |
| fen | 7 / 23 | 2551 | 703 / 713 | 9 |
| deadwood | 7 / 23 | 1394 / 1432 | 422 / 410 | 5 |

- Apple stays under both budgets (near < 8000, far < 1500). The worst case is 5057 near and 771 far.
- Parse and runtime were clean: no script errors for the four valid species.
- The valid species list is `["apple","pine","fen","deadwood"]`. An earlier ad-hoc check passed "oak", which the code correctly rejects with an assert. That was a test mistake, not a regression.
- Returned dictionary keys are preserved: `reach_points, chop_band, skeleton, crown, trunk, far, proxy, triangles`.
- Direct children of the tree node are `Crown, Trunk, Far, ChopProxy`.
- **Shadow fix confirmed:** `Crown.cast_shadow = 0` (OFF; the shadow-only twin handles crown shadows) and `Trunk.cast_shadow = 1` (ON). Trunk shadows are no longer switched off by the dapple path, and the earlier capture shows trunk and crown shadows on the ground.
- Earlier captures from the previous run are in `output/test/shots/` (`close/mid/under/base/row_7.png`). I looked at `mid_7.png` only. It shows layered clustered leaf masses with sky gaps, a flared root base and tapered branching, and no single lollipop crown.

## Honest limitations
- Only `mid_7.png` was visually reviewed in this pass, and only seed 7. The other shots were not re-inspected, and seeds 11/23/41/58 were never viewed.
- The timeout ended the previous run before any further visual critique iteration. Remaining weak points I can see:
  - The canopy is still fairly dense and dark-green.
  - Leaf-edge shapes are a bit jagged and confetti-like at distance.
  - Bark has no authored texture, so groove detail is geometric and vertex-colour only.
  - Fruit and apple colour readability at RTS distance was not checked.
- The test ran headless, so there are no GPU renders from this pass. Native GPU captures, felling, `split_mesh` UV/colour continuity, stump/notch, shootable-apple reach and wind calm-zone are **not** exercised here. Codex must run them in the real project.
- The 8000-triangle budget was checked at height 4.8 only. Other heights and `palette`/`cards` options were not tested.
- Nothing was installed into `godot/`.

## Suggested next steps for Codex
1. Copy `output/tree_kit.gd` into a scratch branch of `godot/`. Run the existing `tree_kit_forms_checks.gd` and the tree-cutting checks.
2. Take native captures (ground, RTS, felled) and compare with `input/before.png`.
3. If the canopy reads too dark or dense, tune the leaf-cluster count, size and palette in the apple skeleton and leaf builder. Do not change the public API.
