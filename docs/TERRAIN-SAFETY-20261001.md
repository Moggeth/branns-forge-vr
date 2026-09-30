# Orchard terrain safety handoff (2026-10-01)

The Orchard heightfield guides ground rays, but the current physics collider must
confirm the returned surface. `terrain_safety.gd` rejects a chunk collider when
its hit differs from the heightfield by more than 0.22 m. A pending swap therefore
cannot certify an old floor. Probes are bounded to the Orchard's 155 m local extent.

`respawn_recovery.find()` now starts rays above the modified height, searches a
supported clear capsule, and continues to relocate loose equipment without
touching held items. Desktop motion can step 0.42 m and walk on a 0.68 normal
(about 47 degrees). It tries a narrow, supported escape when the terrain rises
around the rig and holds position while the new collider is pending. A real cut
still drops the player under gravity. Animated terrain movement checks capsule
clearance before moving the rig; the VR ground sample follows the HMD's X/Z.

`landscape_runtime.apply_impact_magic(operation)` records an ordinary landscape
operation, then commits its target mesh and collider in the contact frame. Call
this only from a non-physics callback, such as the meteor's `_process` contact
signal; normal spells continue to use `apply_magic()` and their animated terrain
transition. Starfall's caller owns that hookup.

Quick checks, from repository root:

```powershell
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://desktop_locomotion_checks.gd --quit-after 1200
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://terrain_safety_checks.gd --quit-after 1800 -- --world-builder-check
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://respawn_equipment_checks.gd --quit-after 1800 -- --world-builder-check
```

The terrain fixture covers a 40-degree incline, raised spawn/capsule clearance,
an engulfed rig escape, immediate crater collider alignment, a genuine crater
drop, and a pending stale collider. The older motion fixture covers jump, low
step, wall, ceiling and unsupported ledge; the recovery fixture covers equipment,
held item, HMD offset and late delivery. These are headless source-scene checks,
not headset comfort evidence. A physical headset pass should check room-scale
walking and terrain edits under the camera before claiming VR comfort.

Failed/repeated strategies: an initial live check loaded a concurrently edited
`adventure_runtime.gd` with a parse error and ran into incomplete creature
planner state. Wait for the owning change to parse before re-running a full Main
fixture; use the isolated motion fixture for motion iteration. An initial terrain
test script inferred a type from dynamically typed landscape access and failed
to parse; explicitly type such local values in Godot 4.7. The Windows shell did
not expand guessed `godot/zone*` paths; use `rg -n PATTERN godot -g '*.gd'`.
