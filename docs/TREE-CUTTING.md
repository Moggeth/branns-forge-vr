# Tree cutting and physical lumber

Orchard's Edge records axe hits in 18 cm height bands. Three strikes in the same
band fell a harvest tree. Each strike replaces the authored cut wedge with a
larger wound at the original impact, with wood-chip feedback. The third strike
splits every direct tree render mesh at the selected band's height: a static
rooted stump remains, and the upper tree rocks before falling around that
plane. The split includes `Crown`, `Trunk`, `Far`, and `LeafCards`, so one-piece
branch/root triangles crossing the plane are clipped as well. Cut-end caps are
centred on the transformed trunk cross-section.

A `RigidBody3D` lumber log drops after the fall. After 1.1 seconds, pressing
the ordinary E/grip pickup action within 2.15 m tethers it to the player's
hand/chest; reaching the player gathers it. Standing nearby does not collect
anything. The source resource stays authoritative: its existing event ID,
quantity, RPG/quest XP and 35-second respawn are handled by
`adventure_runtime.gd::gather` **only after log pickup**. A failed request
leaves the same physical log available for another pickup. The felled source
has hidden visuals/collision while the log is pending; its stump remains visible
under an independent scene node until the original source respawns.

Orchard scenic `builder_forest` trunks have a separate settlement ledger.
Their first axe hit reveals a TreeKit timber resource at that exact placement
and hides only that tree's instanced render parts and collision proxy. The same
three-band felling and physical log then apply. An intentional log claim adds
one settlement wood and marks the scenic key harvested exactly once. It does
not also call the Hero inventory gather API. Cut height is saved with that key
so a clipped stump with its actual endgrain is rebuilt on reload. An unfinished
cut/log is transient and the full scenic tree returns after a restart, without
an unearned settlement award. Workers assigned to a revealed scenic tree are
released from that job so they cannot harvest it while its log awaits pickup.
An index of instanced tree addresses makes the reveal update touch only that
tree's MultiMesh entries instead of rescanning the entire Orchard each chop.

## Art contract

The runtime probes these optional imported GLBs in `res://assets/tree_cutting/`:

| File | Runtime placement |
| --- | --- |
| `log_y.glb` | Y-axis log, 0.9 m long and roughly 0.18 m radius, inside a horizontal 0.9 m physical cylinder. Bark side and both endgrain faces should be complete. |
| `cut_endcap.glb` | Flat, double-sided cap centred at the origin, local Y normal, unit radius. Runtime scales XYZ uniformly to the transformed trunk radius, positions it at the selected cut plane and flips the falling underside. |
| `cut_wedge_1.glb` through `cut_wedge_3.glb` | Progressive wound keyed by matching hit count. +X points outward from the trunk; +Y is up; Z is tangent. The art origin sits on the trunk surface with its axis at local -X. Runtime rotates and places that origin at the selected surface and scales it to trunk radius; stage Y/Z spreads are 1.8×, 1.5× and 1.12× for readable progression on actual Orchard trunks. |
| `chip_a.glb`, `chip_b.glb` | Small loose chips centred at origin. Runtime animates transient copies outward on each hit. |

The installed GLBs come from Sonnet's editable
`assets/tree-cutting/kit.blend` and `build_kit.py`. If an import is missing,
plain cylinders supply diagnostic log/endgrain geometry and a procedural trunk
wound. The art does not assume a fixed cut height or bake in the lower tree. `tree_felling.gd`
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
constructs an actual TreeKit resource and a scenic World Builder proxy without
loading `main.tscn`, connecting to the service, or touching the user's save.
It checks geometry on both sides of the selected plane, distinct hit bands,
no premature gather, intentional pickup, one inventory claim, scenic
settlement idempotence, saved cut height and stump rebuild.

For actual Godot Mobile renders without the playable scene or service, run:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://tree_cutting_capture.gd
```

The script writes `outputs/tree-cutting/cut-1.png`, `cut-2.png`,
`cut-3-start.png`, `felled-and-log.png`, `stump-and-log.png` and
`settled-log.png`. The first and second wounds, authored endgrain and textured
log were inspected in these captures. The settled log lies clear of the stump.
Headset review remains needed for physical grip comfort and fall feel.

Failure learning (2026-09-30): `--path godot -- --contact-check` loaded
`main.tscn` before running a flag; that starts the normal game and touches
its configured local service/save. Use the standalone `--script` command above
for isolated checks. The first splitter run also assigned a missing index
array (`null`) directly to `PackedInt32Array`, which threw and left the test
running; absent mesh channels now use empty typed arrays, and the check has a
12-second timeout. Measured commands: accidental game start 9.244 s; first
splitter check 30.001 s to yield before interruption; failed respawn assertion
0.343 s; corrected checks 0.345 s and 0.432 s. Imported Sonnet GLBs with
Godot's standalone editor import in 4.998 s; graphical capture passed in
4.005 s, face-on recapture in 6.737 s, final log-position recapture in
6.948 s; scenic-inclusive mechanical check passed in 1.167 s.
