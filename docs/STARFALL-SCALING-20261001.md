# Starfall contact and scaling — 2026-10-01

Starfall commits crater height and replaces the affected terrain colliders in
the same impact callback through `landscape.apply_impact_magic()`. This path
preserves the ordinary animated terrain edits for Raise, Sunder and other
spells. The meteor emits `visual_event` phases `descent`, `impact`,
`crystal_reveal`, `settling` and `settled`; descent and settling include a
normalized progress value and elapsed/duration seconds. The event center is
local to the settlement root. The generic impact feedback call and the
meteor-owned torus were removed. The optional `set_crystal_art(artist)` hook
calls `artist.decorate_meteor(meteor, gems)` while preserving the existing
gem-node positions used by pick targeting and saved vein rewards.

The durable meteor ledger accepts up to 256 records, matching the terrain's
existing 256-operation journal; other terrain spells consume that same journal
budget, so the practical number of impacts may be lower. The world save safety
ceiling is 2 MiB. No mined value or record is deleted to satisfy these limits.
At most 20 landed meteors within 52 m of the player own detailed nodes and
precise mineable triangle colliders. Other landed rocks share one MultiMesh
draw source and have no physics body until approached. The selection refreshes
every 0.4 seconds, prioritizing the nearest rocks. At most four falling
meteors animate at once; later saved in-flight records wait in ledger order.
This is an explicit CPU, draw and collision budget rather than a promise of
unlimited free objects. Far rocks show the core silhouette; gems and scars
become visible when the player approaches. The normal 256 terrain-operation
limit remains the next scale boundary.

Verification: `landscape_meteor_checks.gd` reports `LANDSCAPE_METEOR_RESULT []`.
`starfall_scaling_checks.gd -- --world-builder-check` reports zero failures for
128 records, 128-record save/reload including a mined vein and scar, near/far
collider swaps, and a crater whose authoritative height changes on contact and
whose replacement collider is queryable by the next physics frame. A
representative offline full-scene run measured 1.042 ms for the
128-record visibility refresh and 12.98 ms for the full impact callback,
including terrain collision replacement. These are CPU wall-clock samples on
this machine, not headset frame-time measurements. Current art integration and
headset feel require separate visual/HMD review. The final art-integrated repeat
passed 128-record save/reload in 7.964 seconds, measuring a 1.312 ms visibility
refresh and 12.489 ms impact callback. Ground-level and elevated native GPU
captures and their scope are recorded in
[the integrated handoff](ORCHARD-TRAVEL-STARFALL-20261001.md).

Diagnostic lessons: Godot inferred no type for a test ray's computed position;
declare it `Vector3` explicitly and require a named empty result plus no script
errors, since process exit zero alone can hide parse failures. A ray through
the crater center hit the mineable meteor shell, not terrain. Probe the crater
floor outside the 2 m core when verifying collider height. The first complete
fixture then passed in 8.2 seconds; a repeat after the concurrency budget
passed in 8.2 seconds.
