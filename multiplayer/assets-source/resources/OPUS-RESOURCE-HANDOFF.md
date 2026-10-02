# Resource / treasure prop kit — handoff (Opus 5.5, 2026-10-03)

This kit replaces the browser's generic icosahedron gem, stone and apple with handcrafted resource staples. All work stayed inside this isolated folder: no game code, root sources, git, network or API were touched.

## Deliverables (`out/`)
| file | role |
|---|---|
| `star_gem.glb`, `star_iron_nugget.glb`, `stone_chunk.glb`, `orchard_apple.glb` | core-loop resources (the first four requested) |
| `treasure_satchel.glb`, `reward_coffer.glb` | reusable treasure/reward props (added after the first four were done) |
| `resource_contract.json` | dimensions, bboxes, sockets, budgets, per-asset GLB stats, timings |
| `verify_report.json` | independent GLB checks (from `verify_glbs.py`) |
| `contact_sheet.png` | 800×800 actual Cycles render: top = ground-eye lineup, bottom = RTS high angle |
| `closeups_sheet.png`, `renders/` | 1200×800 three-quarter close-up per asset, plus individual frames |
| `textures/props_albedo_a.png`, `textures/props_atlas_b.png` | the two shared 512 maps (source PNGs; GLBs embed them as JPEG) |
| `source.blend` | editable scene with all six assets, textures packed |

## Rebuild (exact)
```
"C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe" --background --factory-startup --python-exit-code 2 --python build_resources.py -- --out "C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/work/opus-resource-treasures-20261003/out" --samples 32
python verify_glbs.py "C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/work/opus-resource-treasures-20261003/out"
```
Options: `--no-render` (GLBs, contract and blend only; takes about 1 s), `--only star_gem,orchard_apple`. `--out` must be absolute.
**Determinism:** two consecutive builds produced byte-identical GLBs (SHA-256 compared). Textures come from numpy with fixed seeds, and geometry from `random.Random(seed)` plus `mathutils.noise`.

## Conventions / contract
- Metres, +Y up, -Z front. The origin is at the bottom centre: every asset rests on y=0.
- Each GLB has a root node (`StarGem`, `StarIronNugget`, `StoneChunk`, `OrchardApple`, `TreasureSatchel`, `RewardCoffer`) with child mesh(es) and two empties:
  - **`Grip`** is the hand/attachment socket. It sits at the centre of mass, except the satchel (at the tied neck) and the coffer (on the lid crown).
  - **`ResourcePivot`** is the visual centre for spin, bob, pickup pop and floating reward display.
- Coffer: the lid is a separate `LidHinge` node at the back-top edge (0, 0.29, 0.19). A positive rotation about its local +X lifts the front of the lid; about 1.9 rad is fully open. `loot_anchor` in the contract marks the inside floor.
- **COLOR_0 multiplies base colour**: AO, edge wear, moss, lichen, blush and crystal teal→amber. It is not white (white fraction is 0–33%; only brass and cord highlights are near 1). In Godot set `vertex_color_use_as_albedo=true`; the glTF importer usually does this when COLOR_0 is present.
- The gem and star-iron glow uses an `emissiveTexture` (atlas B) plus `KHR_materials_emissive_strength` (gem 2.2, iron veins 3.0). Only `LeafStem` is double-sided; every other material is single-sided.

## Shared maps (2 × 512, quadrants)
- `props_albedo_a`: TL stone (warm grey, speckle, strata, soft cracks) · TR star-iron (blue-black hammered pits, silver flecks) · BL oak (grain, knots) · BR leather (pebble grain, scuffs)
- `props_atlas_b`: TL gem glow gradient (emissive) · TR star-iron veins (emissive, cyan) · BL apple skin (red over gold, broken streaks, lenticels; albedo) · BR linen weave (albedo)

## Asset stats (from `verify_report.json` and the contract)
| asset | tris | mats | GLB bytes | size (W×H×D m) | target |
|---|---|---|---|---|---|
| star_gem | 740 | StarGem, Stone | 133 412 | 0.231×0.257×0.198 | 0.25 tall |
| star_iron_nugget | 1460 | StarIron, StarGem | 139 588 | 0.216×0.129×0.165 | 0.22 |
| stone_chunk | 1280 | Stone | 83 124 | 0.252×0.140×0.196 | 0.25 |
| orchard_apple | 691 | AppleSkin, LeafStem | 62 728 | 0.159×0.158×0.153 | 0.16 |
| treasure_satchel | 1224 | Leather, Linen, Brass | 128 072 | 0.409×0.382×0.371 (coins add width) | 0.40 |
| reward_coffer | 1602 | Oak, Brass | 190 912 | 0.640×0.414×0.409 | 0.65 |

All six pass `verify_glbs.py`:
- Winding agrees with the stored normals on 100% of triangles.
- COLOR_0 is present on every primitive.
- Maps are embedded as bufferView JPEGs (about 37 KB each).
- No cameras or lights are exported, and no geometry nodes or modifiers are needed at runtime (the meshes are baked).
- Grip and ResourcePivot are present in every file.
- Each asset uses at most 3 materials.

The coffer is 1602 triangles, about 7% over the ~1500 budget. The verifier's hard limit is 1650.

## Measured timings
**Wall clock:** session start 01:08:48, first build exported all six GLBs at about 01:13, finished 01:17 (+10 local).
- First build: ~4.5 min, all six GLBs. This beat the plan of one export in 5 min and four in 15.
- Final full build with renders: 6.8 s wall.
  - Textures: albedo_a 0.06 s, atlas_b 0.04 s. Materials: 0.001 s.
  - Per-asset build+export: gem 0.09 s, iron 0.07 s, stone 0.05 s, apple 0.03 s, satchel 0.04 s, coffer 0.05 s.
  - Renders: 5.9 s for 8 Cycles CPU frames at 32 samples with denoising.
- Iterations: 3 render-review passes.
  1. Baseline.
  2. Apple and satchel rework, warmer brass, softer stone cracks.
  3. Lineup framing only.

## Review notes from the actual renders
- **Gem:** chamfered hexagonal prisms with brighter edge facets and an asymmetric termination, rising teal to amber from a weathered stone matrix. Its silhouette reads clearly from RTS height.
- **Star-iron:** plane-cut fracture facets, crevice AO and silver convex edges, cyan emissive veins and three embedded amber-tipped star-glass shards. It is the most distinctive item at distance.
- **Stone:** fractured, weathered chunk with a top-moss gradient, lichen flecks and contact AO.
- **Apple:**
  - Body: lathe shape with five-lobe shoulder, stem cavity and calyx with five sepals.
  - Detail: curved stem and folded leaf.
  - Colour: red over gold with broken streaks.
- **Satchel:** slumped leather sack with seven-fold gathered frill, an inner lip that hides the open top, and a two-wrap linen cord with knot and tails. Three gold coins spill at its foot.
- **Coffer:**
  - Body: individually chamfered oak planks with slight wonk, and a five-plank elliptical domed lid.
  - Brass: bands, corner brackets, feet, lock plate with keyhole, hasp, and ring handles.

## Honest limits
- I reviewed these only in Blender Cycles renders. I did not open them in Godot or a Khronos/browser viewer; that review is the root's job. Godot's emissive strength and JPEG sRGB handling should be confirmed in a Godot capture, following the COLOR_0 lesson in AGENTS.md.
- The gem is opaque and stylised, using emission rather than transmission, so it behaves the same in Godot and the browser.
- Box-projected UVs on the rocks leave soft texture seams where the projection axis changes. At gameplay distance they are hidden by vertex AO and moss, but the stone close-up shows faint arcs.
- Detail is fairly coarse:
  - The leather and oak textures are 256 px per quadrant, which is adequate at hand distance but not hero close-up.
  - Brass trim on the coffer is plain boxes (no bevel), to stay in budget.
- The satchel's spilled coins are part of its mesh, so its bounding box is offset towards −X/−Z. Its origin stays at the bottom centre of the sack. Remove the coins in `build_satchel` if the sack is needed alone.
- There are no LODs; at ≤1600 triangles none are expected to be needed. There are also no collision shapes, so the runtime should use a primitive sized from the contract bbox.
- In the ground-eye lineup the camera faces the assets' fronts (from −Z), so the order appears mirrored left to right. That is cosmetic.
- `reference_builder.py` was used only for patterns: the numpy value-noise/PNG writer, the MB face-orientation builder and the export flags. No tree assets were copied.
