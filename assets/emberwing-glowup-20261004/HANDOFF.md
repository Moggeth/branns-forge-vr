# Emberwing glow-up (2026-10-04): bow refinement + variant arrows

Installed: `multiplayer/public/assets/bow.glb` and `arrow.glb` (byte-identical to `out/`). `wings.glb` is untouched.
The source folder `assets/emberwing-sonnet/` is untouched. `bow_builder.py` is a modified copy of its `builder.py`;
`arrow_builder.py` is new and replaces the arrow half of `flight_builder.py`.

## Rebuild (deterministic: repeated builds were byte-identical)
```
cd assets/emberwing-glowup-20261004
python3.11 bow_builder.py   -- --out $PWD/out      # bow.glb + source.blend
python3.11 arrow_builder.py -- --out $PWD/out      # arrow.glb + arrow-source.blend
python3 inspect_glb.py out/bow.glb out/arrow.glb   # node tree, tris per mesh, materials, size
python3 corridor_check.py out/bow.glb              # arrow-pass corridor vertices
python3.11 render_review.py -- --glb out/bow.glb --out DIR --prefix after --set bow      # Cycles CPU review renders
python3.11 render_review.py -- --glb out/arrow.glb --out DIR --prefix arrow --set arrow
python3.11 make_sheets.py -- --src DIR --out /mnt/project-files/emberwing
```
These use bpy 4.5 as a Python module. `blender -b --python X.py -- --out DIR` also works.

## Bow: measured
| | before | after | limit |
|---|---:|---:|---:|
| triangles | 15,732 | 20,636 | 22,000 |
| primitives | 13 | 13 | 14 |
| materials | 5 | 5 (Leather, Brass, Wood, Ember, EmberEye) | 8 |
| images | 8 | 8 | 8 |
| bytes | 1,459,448 | 1,616,088 | 2,000,000 |
| upper limb max lateral X | 0.228 | 0.145 (-36%) | |
| lower limb max lateral X | 0.252 | 0.162 (-36%) | |
| limb forward extent (min Z) | -0.130 | -0.105 (feather protrusion past the spine 43 mm to 18 mm) | |
| PhoenixCore lateral X | ±0.094 | ±0.070 | |

Node contract is unchanged: names, hierarchy and positions match the earlier asset. Grip (0,0,0), ArrowRest (0,.115,.10), ArrowGuide (0,.115,-.012),
UpperLimb pivot (0,.18,-.045) > UpperLimbMesh + StringTop (world 0,.6,.1), LowerLimb pivot (0,-.10,-.022) > LowerLimbMesh +
StringBottom (world 0,-.6,.1), GripMesh, RiserMesh and PhoenixCore. Corridor check is identical to before: only the 16 guide-shelf vertices sit
below the shaft (9.05 mm nearest). Material `Ember` is the same emissive-textured material, so runtime pulsing covers the new veins too.

### What changed
- **Feather masses pulled in.** Angles are x0.74 (shoulder), x0.66 (mid) and x0.80 (tip). Shoulder lengths are x0.79 and mid lengths x0.90. Widths are x0.80. Feathers now follow a
  z-damped spine tangent, and the forward curl is halved, so the fans no longer project toward the target. The shoulder mass is compact, and an
  underside feather moved out of the shoulder/mid gap, so the three masses read as separate layers. A new taper `prof_taper` gives a full pinion vane
  with a late, soft point.
- **Ember vein channels.** The broad red inlay is now a narrow glowing rachis channel at 15% of the vane width. Large feathers also have 2-3 pairs of thin ember veins
  that lie on the cupped vane. All use material `Ember`.
- **Engraved gold inlay** on the archer-facing face of both limbs: two interlacing gold filaments inside straight border lines, with 13
  ember studs where they cross. They are one-sided ribbons 0.3 mm proud of the walnut.
- **Wrapped string nocks.** An 11-turn braided sinew whipping below each tip fitting, with gold-wire end rings. Sinew is a new `Cord` region
  (v .955-.995) in the existing `Brass` metal atlas, so no material or primitive was added.
- **Phoenix head.** The beak is slimmer with a longer hook and a raised gold culmen ridge. Ember nostril slits and flame-shaped ember "tear" markings sweep
  back from the sapphire eyes. A gold torc with three ember beads sits at the base of the neck. The mantle feathers fold in toward the neck.

## Arrow: measured
| mesh | tris | materials |
|---|---:|---|
| Shaft (shared) | 684 | AshShaft, Brass, ArrowEmber |
| Head_0 leaf blade | 356 | Brass, Steel, ArrowEmber |
| Head_1 phoenix beak | 378 | Brass, Steel, ArrowEmber |
| Head_2 flame-tongue bodkin | 396 | Brass, Steel, ArrowEmber |
| Fletch_0 swept flame (crimson to orange) | 584 | Fletch, Brass |
| Fletch_1 notched + barred (amber) | 656 | Fletch, Brass |
| Fletch_2 long tapered (gold) | 584 | Fletch, Brass |
| Fletch_3 curled tip (crimson, sapphire tip) | 584 | Fletch, Brass |

Worst visible combination (Shaft + Head_2 + Fletch_1) = **1,736** tris, against a limit of 1,800. The whole file is 4,222 tris and **289,396 bytes**, against a limit of 400 KB.
There are 5 materials: Brass, Fletch, Steel, AshShaft and the new **ArrowEmber**, a solid emissive (1,.36,.05). There are 3 images (shaft 1024x32, fletch atlas 256², steel 128²).
Fletch also emits its own base texture at 0.16, so the colours still read in dark forests.

### Arrow node contract
Root `Arrow` > `ArrowNock` (0,0,0), `ArrowTip` (0,0,-0.78), `Shaft`, `Head_0..2`, `Fletch_0..3`. Every mesh is a direct child of the root
with no translation, rotation or scale. Every head's point is the vertex (0,0,-0.78), exactly ArrowTip. All fletchings sit in z [-0.201, -0.026].
The shaft ends at z -0.722, inside every ferrule. Details on the shared shaft: a phoenix-prong brass nock with an ember ring, a 3.5-turn spiral gold whipping
(z -0.205..-0.226), four ember-filled rune glyphs in a charred band (z ~-0.25) and crimson/gold crest rings (z ~-0.29).

### Runtime must do
**The GLB contains all 3 heads and 4 fletchings, and all are visible by default.** The game must, per arrow instance, set
`.visible = false` on every `Head_*`/`Fletch_*` except one of each, for example `head = id % 3` and `fletch = floor(id / 3) % 4` for 12 combinations.
Do this on the cloned visual (prepareProjectile clones the template), including the nocked arrow in `updateWeaponPresentation`.
Material `ArrowEmber` can be pulsed the same way as the bow's `Ember`. Old mesh names `Head`, `Fletching`, `Nock` and `Bindings` no longer exist.
No test referenced them.

## Verification
- `node tests/glb.mjs`, `tests/asset-pose.mjs`, `tests/asset-dependencies.mjs` pass. Tests that touch bow/arrow also pass: combat-view, phoenix-flight, ranged-fx,
  skull-surface-regression, terrain-storage-budget, combat-performance, hero-equipment, hold-overlays.
- Review sheets (Cycles CPU, AgX): `/mnt/project-files/emberwing/bow-before-after.png`, `bow-details.png`, `arrow-variants.png`, `arrow-closeups.png`.
- Not verified: in-game, mobile or headset look, and three.js emission strength or bloom. The "first person" render uses a guessed camera, not the game's.

## Known limitations
- The first-person sheet uses an approximate eye position. Judge coverage in the game.
- In the archer-side view, the limb feather masses still overlap at their roots. The gaps are clearest in three-quarter view.
- Fletch_3's sapphire area is fairly large, chosen so it reads in flight. Shrink it with `d = hypot(...)` in `fletch_tex()`.
- Barb edges on Head_1 use the bright steel-edge texture band and can look pale under a grey studio sky.
