# Wyrmspout CPU performance pass (2026-10-03)

The expensive path was repeated terrain work, not the pooled particle update. Continuous fuel/heat changes rebuilt an entire fuel mesh, including thousands of identical edited-terrain height queries. Each short flame flight segment also traversed all 51,200 ground triangles. The existing fire-only performance test measured repeated animation after one snapshot, so it missed both costs.

## Changes and integration

client/fire-presentation.js now separates cell topology, terrain samples and changing fuel/heat attributes. A cell-coordinate change rebuilds the bounded topology. Static coordinates reuse heights while fuel burns. Shared tile vertices reuse bilinear sample stencils; their analytic derivatives exactly reproduce the previous central finite difference on the quarter-cell grid. Existing buffers, triangle order, shaders, materials, effects, sparse puddle borders and .03-.042 metre surface lift are preserved. Buffer uploads cover only active ranges.

Production should pass terrainGrid:true with the shared bare-earth height callback. This samples/caches the shared .75 metre grid and reconstructs exact triangle heights. Generic/custom height callbacks should leave this option false. The existing fireVisual.invalidateTerrain() hook clears heights before the next sync, including progressive terrain, rewinds, saves and same-count edits. Ground/vertex caches each cap at32,768 entries. stats() exposes topologyBuilds, heightSamples, uniqueFuelSamples and cache sizes for diagnostics.

shared/fire.js caches terrain queries only within one 10 Hz ecology step. Heat diffusion, conservative downhill flow, scorch and damage retain their original order and numerical results. No cache survives to another tick, so moving terrain or bridges cannot leave stale heights.

client/terrain-ray.js exports createTerrainRaycaster({height}). segment(from,to) returns null or {point:[x,y,z],normal:[nx,ny,nz],distance}. It clips to the rendered120m square, traverses crossed .75m cells, and tests their two original Float32 front-face triangles in order. Its25,921-vertex cache and323-cell maximum are fixed by TERRAIN_GRID. Call invalidateTerrain() whenever the rendered earth changes. Compare its distance with the existing prop/tree/forge contact; exclude only ground from the slow Three scene ray. The root game integration now does this and keeps matrix refresh outside repeated world queries.

## Controlled evidence

Run from the repository root:

    node multiplayer/tests/fire-performance.mjs --baseline=96ce51c
    node multiplayer/tests/terrain-ray.mjs
    node multiplayer/tests/fire.mjs
    node multiplayer/tests/fire-presentation.mjs

The optional baseline flag loads the committed old modules through git show in the same Node process. Omitting it runs portable invariants and current timings without Git. No production browser or live world is modified by these tests.

| Operation | Before | After |
| --- | ---: | ---: |
| Fuel sync,256cells/64edits |21.263ms mean|0.125ms mean|
| Same fuel case maximum |21.646ms|0.174ms|
| Terrain invalidation in that case |21.423ms|1.952ms|
| Terrain calls per routine fuel update |8,256|0|
| Ecology,256cells/64edits |8.954ms mean|1.285ms mean|
| Ecology terrain calls |3,146|256|
| Short ground ray |0.864ms mean|0.000090ms mean cached|
|500 cached short ground queries |—|0.038ms total|

The ecology baseline included one27.14ms outlier; a preceding controlled run measured7.750→1.167ms. These are CPU observations on this desktop, not GPU or headset frame-rate claims.

The before/after comparison passes24 real old/new buffer cases covering fuel changes, topology relocation, quenching, removal and in-place terrain edits. Every active position/fuel/heat/gradient value matches within1e-6; instance counts match. Eighty ecology steps also produce identical authoritative state while terrain changes and clears.

The grid-ray suite compares1,303 actual Three.Raycaster contacts, misses, normals, mountains,64edits, progressive Sunder, rewinds, exact boundaries and rays from below. Maximum contact difference is1.5987e-14 metres. It includes invalid inputs and proves repeated cached queries perform no new height sampling.

Requested1/10/100/500 effect fixtures remain bounded: at500 requested, only256fuelcells and96packets are admitted, with the existing768-instance/4-draw/3-shadowless-light budgets. The tested dense500request fixture initialized in3.532ms and updated fuel in0.482ms before JIT warmup. This does not authorize500independent flame lights or500authoritative fuel cells.

Final focused commands passed: fire .242s, fire-presentation .307s, terrain-ray1.143s. Final baseline command2.690s (2.425s test body). Implementation/verification interval through this handoff 438.188s; preceding read-only audit281.435s. logs/work-timing.csv records measured steps.

## GPU and broader limits

No fire shader complexity, transparency blend, tongue count or shape was reduced. Flame/smoke overdraw and fragment-noise cost therefore remain as before. The three pooled lights intentionally remain visible at zero intensity while idle: toggling visibility previously caused large shader recompilation stalls. Do not reintroduce that optimization. The new timings measure CPU work and mathematical/visual-buffer equivalence; actual integrated browser GPU, phone and physical HMD acceptance belongs to the root integration verification.

## Busy error diagnosis and durable-capacity proposal

lobby.js used a broad /rate|busy|limit/ fallback. world_limit is not a lock or cooldown. Permanent terrain edits cap at64; each axe special consumes6, pick wall7 and a longest God line9. Deposits cap at80 including retained depleted tombstones. Waiting ten seconds was demonstrated not to clear terrain capacity. Projectiles instead expire after.8s flame/3s fuel/8s arrows and may temporarily occupy the96-projectile pool. Signaling rate limits are separate; normal weapon commands use local simulation or WebRTC, and geometry contacts are host-local.

Root/harvest own the capacity repair and player-facing wording. A bounded durable terrain bake can preserve completed earth/scar as separate UNCLAMPED shared-grid vertex sums, applying the existing combined clamps and mountain protection only when sampling. Keep active ruptures and destructible pick walls live so timing and mining removal remain correct. All snapshot/save/height/signature consumers must carry the bake; silently deleting old edits would destroy permanent terrain or change future raise/lower cancellation. This document describes the proposal, not a completed capacity change.

## Lessons

Benchmark sync/topology rebuild and collision as well as per-frame particles. Run direct Node ESM probes from multiplayer (where three is installed); the first root-level probe failed package resolution before running. On PowerShell, use rg directory -g patterns rather than unexpanded wildcard path arguments. One availability-test syntax typo was caught immediately and corrected; final544case audit passed. Cache invalidation must represent terrain content and temporal phases, never edit count alone. Keep the fixed light count and original transparent fire appearance while optimizing independent CPU work.
