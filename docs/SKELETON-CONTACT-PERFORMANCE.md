# Skeleton contact performance — 2026-10-03

## Cause and fix

The shipped skeleton has 27 skinned meshes, 11,183 vertices and 17,092 triangles. Every 10 Hz contextual hover queried every enemy, and the contact cache CPU-skinned every vertex merely to discover that the ray was nowhere near it. This produced intermittent long frames as groups followed the player. Spawn synchronization also eagerly classified all triangles for dismemberment even when no body part was missing.

`skin-bounds.js` builds bind-local bone envelopes once per shared geometry/bind layout. Their posed union is conservative because normalized skinning weights form a convex combination. These bounds ONLY reject impossible candidates; the existing raycast still resolves the actual animated triangles, gaps, normals, entry position and articulated bone. Unsupported morph/invalid-weight layouts fall back to exact bounds. No animation or collision mesh is simplified.

`combat-view.js` now defers missing-part maps until needed, shares immutable triangle classifications between identical clones, and calculates death-pose bounds from unique part vertices rather than visiting each triangle vertex repeatedly. Aim-only callers may pass `{includePartPoses:false}` to `segmentContacts`; strikes and projectiles keep the default full death/embedding metadata.

## Measured results (desktop CPU; not a phone FPS claim)

| Work | Before | After |
|---|---:|---:|
|32 enemies, initial mask sync|268.09 ms|0.63 ms|
|32 enemies, one missed ray on each of100 fresh frames, mean|56.86 ms|0.81 ms|
|Same missed-ray p95|71.54 ms|1.22 ms|
|64 dense contact rays through32 enemies, exactly1096 intersections|769.89 ms|253.23 ms|

Real Chromium/WebGL fixture: missed-ray mean0.775 ms, p951.0 ms, zero errors. All32 enemies cast shadows:1729 draws/1,093,890 triangles. Only8 enemy shadow casters:1081 draws/683,682 triangles. This is render-work evidence, not an end-device timing guarantee. The fixture retains all32 visible/animated models. Integrated runtime caps touch at four and desktop at eight nearby enemy shadow casters; authored material/mesh batching remains a future art/runtime optimization.

## Regression commands and evidence

- `node multiplayer/tests/skin-bounds.mjs`:4320 animated mesh bounds across all shipped clips enclose the exact deformed vertices;15 actual ray results match exact bounds.
- `node multiplayer/tests/skeleton-performance.mjs`: reproducible timings; asserts zero skinned-vertex evaluations on off-ray hover, rather than a machine-specific time threshold.
- `node multiplayer/tests/combat-view.mjs`: actual bone gaps, animated attachments, severed/frozen handoff, native leg, material/source isolation and host-only reporting.
- `node multiplayer/tests/combat-view-perf.mjs`: same1096 intersections.
- Existing `node multiplayer/tests/enemy-motion.mjs`:16 tests;64-enemy animation layer already0.938 ms mean/1.885 ms worst, so retained intact.
- `node multiplayer/tests/browser-skeleton-performance.mjs`: uses existing browser-acceptance helper/environment. Actual draw-count comparison and screenshot at `logs/browser-acceptance/captures/skeleton-performance.png`. Viewed: all32 actors intact and correctly oriented. Requires the Vite server; default5188. Physical phone/HMD not tested.

Measured tool groups: initial CPU baselines2.185 s; focused missed-ray baseline6.290 s; initial fix/regression2.031 s; shared-topology regression1.238 s; exhaustive bound test0.564 s; browser render capture3.752 s; final tests1.486 s. Lessons: the old64-ray/one-cache benchmark hid the repeated-frame hover cost. Always invalidate the cache between miss tests and measure that path independently. PowerShell does not expand wildcard path operands for rg; use directory plus -g instead.

Runtime helper: enemy-shadow-budget.js selects nearest casters in18m, defaults8 and accepts setMaxCasters(4) for touch. update(actors, focusVector, monotonicNow) throttles internally to5Hz, caches mesh lists, writes only changes, restores original flags on dispose. Quality-disabled casters stay disabled. Root owns invocation/diagnostics. Unit tests include replacement/removal and immediate mobile cap change; measured helper build+test0.207s.
