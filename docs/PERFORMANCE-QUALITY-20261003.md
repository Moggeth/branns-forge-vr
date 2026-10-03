# Preserve quality by removing redundant work

The user's performance brief is the acceptance policy: retain nearby silhouettes/materials, contact accuracy, animation cadence, responsive inputs, primary effects and coherent lighting. Do not lower resolution, populations, shadows, particles or simulation rate as a first response. Profile, change the underlying method, and compare behavior and visible output before claiming success.

## Measured baseline and first changes
- Repository/auth/discovery: 1.148 s; fetch/private visibility/readme checks: 1.939 s.
- Existing 3,600-tick busy-world test: 87.837 s, p95 31.890 ms, p99 34.892 ms. Eight players, 64 enemies, 64 terrain edits, 64 groves, 256 harvested trees and pickups, 80 deposits, 32 bridges. This exceeds a 60 Hz CPU budget before graphics.
- CPU profile of 600 ticks: 15.722 s with profiling; rawTerrainHeight accounted for 12.678 s of samples. Profile in ignored logs/quality-baseline.cpuprofile.
- Reject terrain kernels outside their exact bounding square before computing distance: 600 ticks 4.551 s, p95 8.533 ms.
- Reject tree collision candidates outside their widest authored trunk before sampling terrain: 600 ticks 0.764 s, p95 1.820 ms, p99 2.426 ms.
- Independent unmodified shared-source reference from 51e9e98: 600 ticks 14.182 s, p95 31.830 ms. Both runs produced the exact same checkpoint SHA256 a38e4e8002dc720db2f184dc86f08d718445d19d7385efe24c5ab1f537245c61 and snapshot size 81,188 bytes. About 18.6x faster in this CPU fixture; not a GPU, phone, headset or internet FPS claim.
- Caller-owned exact terrain vertex cache now serves the renderer's ground, trees, effects, targeting and environment callbacks. Invalidates only vertices touched by changed edits, including moving Sunder, deletions, resets and in-place mutations. Uses 233,289 bytes; no world-state cache is serialized. Authority's general terrain function remains immediately mutable and uncached.
- 44,066 exact height comparisons and 4,215 exact tree displacement comparisons against old source passed. Ground reads fell from 133,394 to 7,907. Repeated height sampling: old 46.467 ms, rejection-only 12.602 ms, shared cache 2.193 ms, identical sum.

## Verification and lessons
Run node multiplayer/tests/quality-performance.mjs and node multiplayer/tests/import-performance.mjs --steps=600 from repository root. The exactness test reads the fixed prior revision using git; preserve that history. Longer load: omit --steps for 3,600 ticks. No art, population caps, tick rate, shadow count, texture resolution or mesh resolution changed.

Terrain triangles (220 rays), terrain raycaster (1,303 cases), tree integration and all 14 invention authority checks passed. Progressive Sunder fixture initially failed because its old target was outside the new friendly influence radius (no_influence); moved the fixture's friendly source rather than weakening gameplay validation. Terrain saturation fixture previously expected a crater at the now-permanent central forge; moved that probe to unprotected earth. These were stale fixture assumptions, not reasons to remove protection or influence.

Public room hosting remains blocked as recorded in PEER-PLAYTEST.md. This pass does not retry the policy-blocked tunnel. Physical phone/HMD acceptance remains outstanding.
