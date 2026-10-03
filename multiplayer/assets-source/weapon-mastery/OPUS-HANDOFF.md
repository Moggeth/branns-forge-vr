# Opus weapon mastery commission — HANDOFF (2026-10-03, ~11 min of the 20 min cap)

Everything is in `output/`. I did not edit any root or reference files. I did no git work, published nothing and called no other model or API. I used three from `node_modules` read-only, plus local Blender 2.93 for review renders only.

## Files
| File | What |
|---|---|
| `assets/axe.glb`, `assets/pick.glb` | Refined weapons, drop-in replacements for `reference/assets/{axe,pick}.glb` |
| `build-weapons.cjs` | Deterministic builder: `node output/build-weapons.cjs [refDir] [outDir]`. It appends embellishment meshes to the reference GLBs at the glTF/binary level. Rebuilding the final version gave byte-identical output (md5 axe bd4a3dc0…, pick 2edc74a4…). It also writes `assets/build-report.json` with per-part triangles and bounds |
| `weapon-special-motion.js` | `specialPose(tool, progress, rest) -> {position: Vector3, quaternion: Quaternion}`, `SPECIAL_MOTION.axe = {duration: .8, release: .45, cooldown: .9}`, `crossedRelease(prev, next)` |
| `crystal-wall.js` | `createCrystalWall({THREE, scene, height, now?})` returns `{sync, update, dispose, stats, targets, root}` |
| `mining-fracture.js` | `attachFracture(THREE, root, depositId, {chunks?})` returns `{setDamage(hits, maxHits), update(dt), dispose(), stats(), removedCells()}` |
| `test.mjs` | Headless checks: `node output/test.mjs` (25 checks, **ALL PASS** on the final build) |
| `review-scene.mjs`, `render_review.py`, `render_compare.py` | Review render tooling (Blender 2.93, `-b --factory-startup`) |
| `renders/*.png` | Actual renders I produced and inspected (details below) |

## Weapons
- **Identity and contracts kept.** Every original mesh, material, texture image, socket and empty node is byte-identical: `Grip_Center`, `CuttingEdge_Mid/Top/Bottom`, `Head_Center`, `Poll_Face`, `Grip`, `PickTipRight/Left`, `HitCentre` and `ChargeGlow`. `test.mjs` asserts this. The builder only adds nodes, as children of the existing root (`OrchardsEdge` / `StonewhisperPick`).
- **New parts reuse the existing materials.** No new materials or textures were added and nothing is mutated.
- **Y bounds unchanged.** The builder throws if Y bounds change, so `prepareAsset()` height normalisation and scale are unchanged (axe −0.065..0.813, pick −0.045..0.718).
- **Axe: 34,720 tris (+4,020; budget 35k, so it is tight).** Additions:
  - Two gold wire bindings that follow the haft's measured elliptical cross-section.
  - Four stepped darkmetal collars.
  - Gold studs on both blade cheeks, seated on the measured blade half-thickness.
  - Gold poll cap with four studs.
  - Stepped gold pommel finial.
- **Pick: 5,396 tris (+2,676).** Additions:
  - Faceted resonance-crystal crown cluster.
  - Three crystal fins per arm.
  - Four inset crystal studs.
  - Gold bands fitted to the measured arm sections (two per arm side, three per arm).
  - Three gold shaft collars and a gold filigree helix.
  - Darkmetal spine plates along the arms and darkmetal langets on the shaft.
- **Review fixes made during this session** (from the renders): the first pass had loose, oversized rings/wire and two studs floating off the blade. I refit them from measured mesh slices. I also removed a pick pommel cap that z-fought the authored brass pommel.
- **Remaining art critique and limitations:**
  - The pick's crown crystals are partly buried in the pointed socket top. They read as small blue sparks rather than a crown.
  - The darkmetal spine plates on the pick arms read as a second stacked blade layer from some angles.
  - The axe's new detail is concentrated on the haft and poll. The blade face is unchanged apart from studs.
  - I did not re-texture anything and did not decimate the 7,200-tri leather grip. Any further axe detail needs triangles freed elsewhere first.
  - I have not seen the weapons in the browser renderer, first-person view or VR.

## Bowling special (`weapon-special-motion.js`)
- **Path:** a pendulum loop with the head swinging backward.
  - 0 → .16: pull back and down; the head goes behind and the arm out to the side.
  - .31: bottom, beside the hip, head hanging.
  - **.45: release.** Underhand delivery, low and forward, head rising toward the target.
  - .60: level forward "sundering" follow-through.
  - .80 → 1: recover.
- **Implementation:** non-uniform Catmull-Rom curves on the hand offset and on pitch/yaw/roll. Rotations are applied in camera space and premultiplied onto `rest.quaternion`, so the grip pivot stays the rotation centre.
- **Tested:** returns exactly to rest at 0 and 1; continuity (max 0.0103 m / 0.043 rad per 2 ms sample); the phase positions above; the release event.
- **Not done:** I have not viewed it animated in the game camera. The key values (`KEYS` table, offsets in metres) are the place to tune feel and reach for the actual first-person rest pose. Wire it so that progress = elapsed / 0.8, and fire the sundering hit when `crossedRelease()` is true.

## Crystal wall (`crystal-wall.js`)
- **Input:** `sync(snapshot)` reads `snapshot.deposits` where `special === 'pick_wall'`. Deposits are grouped by `editId` into curves, ordered by `d.segment` if present, otherwise by distance from the curve's far end. Tangents come from neighbours, and crystals spread about 0.55 × the neighbour gap so the segments interlink. Fields used: `x, z, hits, maxHits, depleted, editId`; `snapshot.edits` is passed through to `height`.
- **Shape:** 9 crystals plus 3 rubble plinths per segment. Bases sit at `height(x, z) - 2.4` and tips about `height + .5` (measured +0.53 in the test). Crystals lean outward and twist deterministically per `deposit.id`.
- **Growth:**
  - Deposits present at the first `sync` (late join), or already hit, are mature.
  - Later newborn deposits thrust up from below and spin about the curve tangent in 600 ms (ease-out-back). A wave runs along the 7 segments.
  - `now()` defaults to `performance.now()`.
- **Damage:**
  - Breaks `floor(9 × hits / maxHits)` crystals in a fixed per-id order: outer shards first, cores last. At least one crystal remains until `depleted` (test: 9,8,6,5,3,2,1).
  - Broken crystals are re-parented to an untagged debris group before a 0.45 s fall, so they never take hits.
  - Depleted or vanished deposits are retired.
- **Raycasts:** every live crystal and plinth is a real Mesh with `userData.targetId = deposit.id`. `targets()` returns the segment groups, for concatenation into `world-content-view.targets()`. The existing `resolveTarget` parent walk works unchanged.
- **Budget:** 3 materials and 4 geometries shared by all walls. One 7-segment wall is 1,428 tris (63 meshes, so 63 draw calls; InstancedMesh was not used).
- **Integration and limitations:**
  - Filter `special === 'pick_wall'` out of world-content-view's boulder path.
  - Call `update(dt)` each frame.
  - The raised terrain body is the root's. The review render has no terrain, so the buried 2.4 m is visible there.
  - The material colours are matched by eye to `Resonance_Crystal`. No glow or emissive animation, by design, to avoid shared-material mutation.

## Fracture (`mining-fracture.js`)
- **Integration:** replace `e.root.scale.setScalar(1 - c.hits / c.maxHits * .15)` with:
  `e.fracture ??= attachFracture(T, e.root, c.id); e.fracture?.setDamage(c.hits, c.maxHits);`
  Then call `e.fracture.update(dt)` in `tick`, and `e.fracture.dispose()` in `remove`. Call it after `tag(root, id)`.
- **How it works:**
  - The authored triangles (all primitives, with every attribute: uv, `COLOR_0` denormalised, tangent, normal) are split into 14 Voronoi cells. There are 4 deterministic variants, chosen by the deposit-id hash. Partitions are cached per template geometry and variant and shared between instances.
  - Damage removes up to 11 cells, upper cells first. Removed shells are detached and given a no-op raycast before flying off as chips (0.6 s).
  - In their place go recessed crater surfaces (scale 0.76 toward the centre) and fracture walls, using the asset's own `GeoInterior` material by reference. Walls exist per cell pair and orientation and are shown only when exactly one cell of the pair is gone.
  - The original meshes are hidden and given a no-op raycast. Their materials are never modified (asserted in the test).
- **Tested on the real `boulder.glb` and `meteor.glb` geometry:**
  - 200 inward rays at 0 % and full damage: 0 misses and 0 hits on untagged or invisible geometry.
  - Monotonic cell removal; no root scale.
  - Triangles go from 5,120 to 5,386 (boulder) and 5,800 to 6,094 (meteor).
- **Rendered:** `renders/fracture_review.png` shows OBJ geometry in flat placeholder colours. **It does not show the game textures**, and the tan colour stands in for `GeoInterior`.
- **Critique:**
  - Damage reads clearly.
  - Crater walls are built from per-edge quads and look striated or fin-like.
  - At high damage the boulder is mostly crater.
  - Without a texture check in three, I cannot confirm how `GeoInterior` looks on the walls. Their UVs are derived from position, which is crude.
- **Not done:** I did not use clipping planes; I chose cell partitioning instead. I did not check the material/program count at runtime. The craters add one draw call per removed cell, and the walls add up to about 12 more.

## Renders I made and inspected
| Render | Contents |
|---|---|
| `renders/axe_side.png`, `renders/pick_side.png` | Original (left) vs refined (right) |
| `renders/axe_head.png`, `renders/pick_head.png` | Refined head close-ups |
| `renders/fracture_review.png` | Boulder at 0, 5 and 10 hits of 10, plus the meteor at 6 of 10 |
| `renders/wall_review.png` | 7-segment wall; segments 2 and 4 damaged |

All renders are Blender 2.93 Eevee offline. They are not from the browser's three.js renderer, and no HMD or first-person check was done.
