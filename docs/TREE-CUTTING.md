# Tree cutting and physical lumber

Orchard's Edge records axe hits in 18 cm height bands. Three strikes in the same
band fell a harvest tree. Each strike deepens and widens a wound in the main
trunk mesh at the original impact, with wood-chip feedback. The third strike
splits every direct tree render mesh at the selected band's height: a static
rooted stump remains, and the upper tree rocks before falling around that
plane. The split includes `Crown`, `Trunk`, `Far`, and `LeafCards`, so one-piece
branch/root triangles crossing the plane are clipped as well. Cut-end caps are
centred on the transformed trunk cross-section.

A `RigidBody3D` lumber log drops after the fall. After 1.1 seconds, it draws
toward the player's chest from within 2.15 m and gathers when it reaches the
player. The source resource stays authoritative: its existing event ID,
quantity, RPG/quest XP and 35-second respawn are handled by
`adventure_runtime.gd::gather` **only after log pickup**. A failed request
leaves the same physical log available for another pickup. The felled source
has hidden visuals/collision while the log is pending; its stump remains visible
under an independent scene node until the original source respawns.

## Art contract

The runtime probes these optional imported GLBs in `res://assets/tree_cutting/`:

| File | Runtime placement |
| --- | --- |
| `log_y.glb` | Y-axis log, 0.9 m long and roughly 0.18 m radius, inside a horizontal 0.9 m physical cylinder. Bark side and both endgrain faces should be complete. |
| `cut_endcap.glb` | Flat, double-sided cap centred at the origin, local Y normal, unit radius in X/Z. Runtime scales X/Z to the transformed trunk radius and positions it at the selected cut plane. |
| `cut_wedge_1.glb` through `cut_wedge_3.glb` | Progressive wound keyed by matching hit count. +X points outward from the trunk; +Y is up; Z is tangent. Unit-radius proportions; runtime scales and rotates to the hit-facing point. |
| `chip_a.glb`, `chip_b.glb` | Small loose chips centred at origin. Runtime animates transient copies outward on each hit. |

Until those assets are installed, plain cylinders supply diagnostic log and
endgrain geometry; the actual trunk wound still changes shape. The art should
not assume a fixed cut height or bake in the whole lower tree. `tree_felling.gd`
clips each render mesh by a resource-local horizontal plane, preserving the
original mesh surface material, vertex colours and UV channels. For a future
imported tree that uses tangent-space normal maps, add tangent interpolation to
the splitter or deliver trunk/crown parts split at the cut interface. This
contract covers TreeKit's current colour-shader meshes.

## Offline verification and recovery

Run from the project root:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://tree_cutting_checks.gd
```

Require `TREE_CUTTING_RESULT []` and exit 0. This standalone `SceneTree`
constructs an actual TreeKit resource without loading `main.tscn`, connecting
to the service, or touching the user's save. It checks geometry on both sides
of the selected plane, distinct hit bands, no premature gather, log physics,
claim timing and respawn cleanup. A live headset visual review remains needed
for final art scale, chip motion, fall feel and pickup comfort.

Failure learning (2026-09-30): `--path godot -- --contact-check` loaded
`main.tscn` before running a flag; that starts the normal game and touches
its configured local service/save. Use the standalone `--script` command above
for isolated checks. The first splitter run also assigned a missing index
array (`null`) directly to `PackedInt32Array`, which threw and left the test
running; absent mesh channels now use empty typed arrays, and the check has a
12-second timeout. Measured commands: accidental game start 9.244 s; first
splitter check 30.001 s to yield before interruption; failed respawn assertion
0.343 s; corrected checks 0.345 s and 0.432 s.
