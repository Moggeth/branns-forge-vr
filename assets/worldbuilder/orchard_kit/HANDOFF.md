# Orchard world-building kit — handoff

This kit has three assets: a lumberjack helper, a timber work site, and a survey waymarker. It is styled to sit next to `input/bridge_reference.*`: the pale stone, lime moss and orange plank tones are reused, with brass and warm cloth accents added. The bridge itself was not remade.

All assets use metres at 1 unit = 1 m. Each GLB is Y-up and grounded at Y = 0. There is no stage, background, light or camera in any GLB.

## Files (all in `output/`)
| File | Purpose |
|---|---|
| `worker.glb` | Rigged helper: 1 skinned mesh, 13 bones, sockets, 3 clips |
| `stockpile.glb` | Log rack, chopping block, plank stack and flagstone pad |
| `waymarker.glb` | Survey post with two arrow boards, a pennant and a stone footing |
| `build_orchard_kit.py` | Deterministic builder. It builds all three assets, exports them, saves the `.blend`, renders the reviews and writes `build_report.json` |
| `validate_kit.py` | Re-imports each GLB in a fresh Blender process and writes `inventory.json` |
| `orchard_kit.blend` | Editable source. The `Worker`, `Stockpile` and `Waymarker` collections plus the `ReviewStage` collection (ground, 2 m corridor strip, sun, camera; never exported) |
| `inventory.json` | Measured from the re-imported GLBs: bounds, triangles, nodes, bones, clips, sockets, materials, textures, transparency and light checks |
| `review/*.png` | `review_front`, `review_side`, `review_overhead` (orthographic), `review_vr_eye` (1.6 m eye height, 22 mm lens), plus worker poses `worker_{idle,walk,chop_windup,chop_strike}_side` and `worker_chop_strike_front` |
| `textures/*.png` | Five procedural grain maps: 256² each, handle 128². They are also embedded in the GLBs |
| `BUILDER-UI.md` | Spec for the second-window builder UI |

To rebuild, run from the commission folder:
```
blender.exe --background --factory-startup --python output/build_orchard_kit.py
blender.exe --background --factory-startup --python output/validate_kit.py
```
Determinism check: I ran the build twice. All three GLBs came out byte-identical (MD5 `worker 20b72d8a…`, `stockpile 9873d391…`, `waymarker 646cd5f8…` on the run before the final polish pass). All randomness uses `random.Random(1729)`.

## Coordinate convention
The builder works in Blender space (Z-up, characters face −Y). The glTF exporter converts this to glTF/Godot as **(x, y, z)_gltf = (x, z, −y)_blender**. The worker's forward direction is **glTF +Z**; the Godot importer handles this as usual.

The tables below give socket positions in **glTF/Godot coordinates** relative to each asset root. They are measured on re-import, in the bind pose.

### Worker (`Worker_Rig` root at origin)
- **Height:** 1.675 m standing (the cap pom-pom is the top). Footprint at rest is 0.70 (X) × 0.64 (Z) m, including the axe head that rests in front.
- **Bones:** `root`, `hips`, `spine`, `head`, then for each of `L`/`R`: `upperarm`, `forearm`, `hand`, `thigh`, `shin`. Every mesh part is rigidly weighted (weight 1.0) to a single bone.
- **Axe:** a double-bit axe on the `hand.R` weights. It has a 0.78 m handle, brass bands and a pommel.

| Socket (parent bone) | Position (x, y, z) | Use |
|---|---|---|
| `socket_ground_center` (root) | 0, 0, 0 | Placement pivot / nav agent centre |
| `socket_hand_R` (hand.R) | −0.30, 0.705, 0 | Axe grip; attach held props |
| `socket_hand_L` (hand.L) | 0.30, 0.705, 0 | Off hand: carried log or plank |
| `socket_axe_blade` (hand.R) | −0.30, 0.151, 0.32 | Chop VFX, chips and hit event (follows the animation) |
| `socket_carry_shoulder` (spine) | 0, 1.30, −0.05 | Shouldered log |
| `socket_overhead_icon` (head) | 0, 1.90, 0 | Task or status icon for the overhead view |

| Clip | Frames @24 fps | Length | Loop | Notes |
|---|---|---|---|---|
| `Worker_Idle` | 1–49 | 2.0 s | yes | Breathing and a head turn. The axe head rests on the ground (≤6 mm dip) |
| `Worker_Walk` | 1–25 | 1.0 s | yes | **In place, no root motion.** Move the node at ≈1.1 m/s (stride ≈0.55 m per step). Bob +3 cm |
| `Worker_Chop` | 1–37 | 1.5 s | one-shot (loopable: first and last frames match) | Wind-up at frame 11 (axe reaches 2.25 m high), **impact at frame 16 (t = 0.625 s)**, recover by frame 37 |

The strike arm angle is **solved by the builder** so the blade lands at 0.495 m height, 0.91 m in front of the worker and 0.19 m to the right. That matches the stockpile's chopping block.

### Stockpile (`Stockpile` root at origin)
- **Bounds:** X −1.21…1.20, Z −0.91…0.76, height 0.84 m. Footprint 2.41 × 1.67 m.
- **Nodes:** `StoneBase` (20 flagstones and moss), `LogRack` (6 logs, 4 brass-banded stakes, 2 sleepers), `ChopBlock` (stump, split log, brass wedge, chips), `PlankStack` (15 planks on bearers with brass straps).

| Socket | Position (x, y, z) | Use |
|---|---|---|
| `socket_worker_chop_stand` | −0.906, 0, 1.252 | Worker stands here **yawed 180°** (facing glTF −Z, toward the block) and plays `Worker_Chop` |
| `socket_chop_target` | −0.72, 0.50, 0.34 | Split-log hit point; spawn chips here at chop frame 16 |
| `socket_log_drop` | 0, 0.813, −0.45 | Where harvested logs are added. Scale visible logs by stock count, or keep them static |
| `socket_log_pickup` | 0, 0.26, 0 | Front of the rack, for a hand grab |
| `socket_plank_pickup` | 0.60, 0.35, 0.34 | Top of the plank stack |
| `socket_label` | 0, 1.25, −0.45 | World-space label or resource badge anchor |

### Waymarker (`Waymarker` root at origin)
- **Bounds:** X −0.38…0.54, Z −0.24…0.30, height 1.50 m. Footprint 0.92 × 0.54 m.
- **Nodes:** `Footing` (octagonal stone plinth and moss), `Post`, `SignArrows` (the main arrow points **+X** at 1.16 m; a secondary arrow points back and to the left at 0.95 m), `Pennant`.

| Socket | Position (x, y, z) | Use |
|---|---|---|
| `socket_route_anchor` | 0, 0, 0 | Route/spline control point |
| `socket_arrow_tip` | 0.54, 1.16, 0.075 | Route direction. Yaw the node so +X points along the carved route |
| `socket_grab` | 0, 1.00, 0 | VR hand grab or pick-up point |
| `socket_top_beacon` | 0, 1.62, 0 | Emissive or VFX beacon for the overhead view (add in-engine, not a light) |
| `socket_pennant_tip` | −0.20, 0.99, 0 | Cloth or wind VFX origin |

## Walking corridor (2 m)
Checked on `review_overhead.png`: the teal strip is 2 m wide and none of the assets intrude on it.
- **Stockpile:** its nearest edge is 0.91 m from its origin on the chop side (+Z in glTF). The worker's chop zone extends to z ≈ 1.25 m, and the swing needs about 0.5 m more behind the worker. Place the stockpile origin at least **2.8 m from the corridor centreline** with its +Z side facing the path. If the long side runs parallel to the path and no chop zone is needed, 1.95 m is enough.
- **Waymarker:** place its origin at least **1.4 m from the centreline**. Yaw it so the arrow boards run *along* the path, not across it. The boards sit at 0.95–1.16 m, which is torso height for a walking player.
- **Worker:** the worker is a nav agent. Give it a radius of 0.30 m, or 0.55 m while chopping (the swing arc).

## Collision recommendations (use primitives, never the render mesh)
- **Worker:** a capsule with radius 0.28 and height 1.65, centred at y = 0.825. Put no collision on the axe; use a trigger sphere with r = 0.12 on `socket_axe_blade` during frames 14–18 only if you want hit events.
- **Stockpile:**
  - Box A for the rack and logs: centre (0, 0.42, −0.45), size 2.0 × 0.84 × 0.80.
  - Cylinder for the block: centre (−0.72, 0.25, 0.34), radius 0.24, height 0.50.
  - Box for the plank stack: centre (0.60, 0.18, 0.34), size 1.0 × 0.36 × 0.58.
  - Leave the flagstone pad (6 cm) walkable, with no collider.
- **Waymarker:** a cylinder with r = 0.10 and h = 1.50 for the post (centre y = 0.75), plus a cylinder with r = 0.27 and h = 0.18 for the footing. Leave the arrows and pennant non-colliding so the hand does not snag on them.

## Performance (measured on re-import)
| Asset | Triangles | Material slots (≈ draw calls) | Textures | GLB size |
|---|---|---|---|---|
| worker | 1,904 | 11 | handle 128² | 301 KB |
| stockpile | 2,628 | 15 (4 meshes) | 4 × 256² | 429 KB |
| waymarker | 494 | 11 (4 meshes) | 3 × 256² | 214 KB |

- Every material is opaque Principled (no blended transparency) and none use alpha.
- There are no lights, cameras or extras in the GLBs. Metallic is used only on brass and steel.
- **Caveats:**
  - Draw calls are the cost, not triangles. The worker has 11 material slots. For crowds of more than about 10 workers, bake to a single palette atlas. Every non-wood colour is flat, so a 64² palette texture with UV snapping gets the worker down to 1–2 surfaces.
  - The stockpile and waymarker can be merged to one mesh each in Godot (`MeshInstance` merge) if they will never be animated separately.
  - Textures are shared by name across the GLBs, but Godot imports a copy per file. De-duplicate them into a shared material library if memory matters.
  - Skinning 13 bones is trivial. Use `AnimationTree` with a 0.15 s blend between idle and walk.

## Visual defects found and corrected
1. **Feet sank during the chop crouch (−6.5 cm).** The whole root was being lowered. I removed the root drop; the crouch now comes from the knees and spine only. The remaining −1.6 cm is the toe of the leading boot at full knee bend, which is hidden by grass or flagstones.
2. **The chop stand socket was inside the log rack.** The blade offset had been applied without the 180° yaw. It is now at (−0.906, 0, 1.252), facing the block.
3. **The chop missed its target.** At first the strike blade was at 0.29 m against a 0.57 m target. I lowered the chopping block to 0.34 m and the builder now iterates the strike angle, landing at 0.495 m against a 0.50 m target.
4. **Logs were skewed in plan.** An axial spin was being applied as a yaw, which put the stockpile Y extent at 1.1 m. Logs are now aligned; the footprint shrank to 1.67 m.
5. **Wood grain looked noisy and zig-zagged, and planks read magenta-red.** I lowered the contrast and wobble and warmed the plank colour toward the bridge's deck.
6. **The waymarker pennant was edge-on**, so from the front it read as a stick. It is now in the XZ plane on the −X side, clear of the arrows.
7. **Wood chips rendered black.** They were sampling the bark rim of the end-grain map. They now use plank wood.
8. **The cap brim was too wide**, which made it read as a rice hat. I narrowed it by 1.3 cm.
9. **Waymarker footing moss sat 1.7 cm below ground.** I raised it, and the waymarker's min Y is now 0.000.
10. **Validator measurement errors.** Two measurement errors were fixed in the validator (not in the art):
    - It counted the importer's bone-display icosphere as geometry.
    - It measured sockets in the auto-applied first clip instead of the bind pose.

## Known limits / not done
- **Rigging:** the rig uses rigid parts, not smooth skinning. That keeps the faceted style and makes it cheap, but it means elbows and knees rely on joint spheres. Only the right arm holds the axe; the left arm counter-swings instead of making a two-handed grip, because hand IK was out of scope.
- **Walk:** the walk is in place with no root motion.
- **Lighting:** I did not bake AO or vertex-colour shading. All shading comes from real-time lighting.
- **Review renders:** they use Eevee with a single sun. Images after the last polish pass (pennant, chips, brim) were regenerated by the same build. The pennant fix was checked visually in the final `review_front.png`. The footing and chips fixes were verified numerically (bounds) only.
- **Game code:** none was edited, per the brief. `BUILDER-UI.md` is a spec only.

## Measured time
- **Build:** 2.8 s. This covers building, exporting three GLBs, saving the `.blend` and 9 Eevee renders.
- **Validation:** about 3 s per clean-process run.
- **Session wall clock:** the session started at epoch 1790591101 (2026-09-28 20:25 local). It ran about 10 min up to the final validated build (epoch 1790591666, about 565 s), The session ended at epoch 1790591782, **681 s (about 11.3 min) wall clock in total**.
