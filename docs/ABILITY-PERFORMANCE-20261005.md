# Ability performance pass â€” 2026-10-05

Isolated from the active Leap preview (5194); QA uses 5195 with XR and native pointer capture disabled.

## Findings and fixes
- Pick wall casting rebuilt all merged landmark geometry on every changed terrain snapshot, including distant unaffected landmarks. Retain buffers, compare actual anchor heights and refit affected vertex ranges; live landmark details rebuild only when their own anchors move.
- Emberwing forecast rays tested whole map-spanning material buckets. Per-piece bounds reject irrelevant triangles before the unchanged Three raycast. Render batching, geometry, normals, face IDs, trajectory equations and preview cadence remain intact.
- 1,000 seeded rays after deformation and a non-uniform parent transform matched all 2,259 original Three contacts (point, object, face index). Retained terrain vertices match a fresh rebuild within 4e-6 metres; normals are identical.

## Measurement and lessons
Initial 23.436 s browser CPU profile confirmed landmark build/BufferAttribute churn during Pick cast and triangle traversal dominating curved bow aiming. After the refit/bounds change, a 24.568 s profile removed build churn and reduced triangle traversal markedly. These are local automated browser results, not physical phone/VR acceptance or a guarantee of every frame's latency.
The initial RAF probe could briefly overlap adjacent phase callbacks; do not use its frame percentile numbers as controlled evidence. Use a generation ID and deterministic aim time for subsequent comparisons. Profiles are in ignored logs/ability-*.cpuprofile.

| Step | Measured seconds | Result |
|---|---:|---|
| Scoped personal Git fetch/private visibility | 3.105 | Private origin verified |
| Isolated worktree creation | 6.266 | Active Leap checkout unchanged |
| First CPU profile | 23.436 | Both bottlenecks reproduced |
| Profile after retained geometry and piece bounds | 24.568 | Build churn removed, bow CPU reduced |
| Starting-world and ranged checks | 0.429 | Pass |
| Exact ray/refit and authored kit tests | 0.758 | Pass |

Use rg --files before targeted reads; guessed filenames and PowerShell positional globs caused failed reads during discovery. Future tuning should profile actual casts and retain render/collision parity, rather than lower effect resolution or preview refresh rate.

## First-use preparation
Startup now renders isolated representatives of existing shader-based effects, including the hidden Pick footprint, Emberwing ribbon/impact markers, axe cleave and pooled particles. Explicit crystal/crust/strip representatives cover the instanced variants only created by earth spells. They share retained runtime materials, use owned temporary geometry/buffers, and never synthesize a gameplay action or sound.

The guarded browser exercised actual Pick aim/release and curved Emberwing aim (23.773 s), with no console or shader errors. The authored landmark kit retained the same 46,328 triangles, seven merged draws, and only the two startup builds (initial fallback and installed kit) across the cast. The corrected probe observed ~8.3 ms median / 8.4–8.5 ms 95th-percentile frame intervals at 800×450. This is a local small-viewport test, not an expected phone/fullscreen FPS claim. Screenshots in logs/ability-warm-*.png retain the full wall, foliage and visible trajectory.

Targeted warmup lifecycle check passed in 0.192 s. Exact source visibility/draw ranges remain unchanged; no wall state/events change; duplicate cleanup is safe and runtime materials survive. Commit 1ec40e0 pushed to private origin/codex/ability-performance (2.569 s).

## Reproduce
From multiplayer, start Vite on an unused loopback port. Set FORGE_PERF_URL to that URL and run `node tests/browser-ability-performance.mjs` (same PW_CORE / PW_CHROME settings as the project's browser acceptance helpers if not locally installed). Outputs, screenshots and CPU profiles go to ignored logs/ability-performance/. This uses a disposable simulation, asserts an actual wall and curved guide ran, closes its browser, and never requests XR or native pointer capture. Node regression checks: `node tests/landmark-performance.mjs` and `node tests/ability-warmup.mjs`.

The root README contains legacy mixed-encoding bytes; a UTF-8 whole-file read failed. Append the ASCII handoff link as bytes instead of recoding unrelated text. Always specify encoding for UTF-8 documentation; Python's Windows default is cp1252. PowerShell continues after child failures: inspect exit codes before dependent operations.

## Final local checks
- 165/166 CI checks passed in 116.5 s; the only failure was our patch-note phrase "shader hitches" (player-facing jargon lint). Reworded it and reran the focused patch-note check. Date corrected to the actual Sydney date, October 4.
- The reusable guarded browser runner passed in 24.260 s, including actual wall cast and curved guide assertions. No console errors.
- Check build passed in 1.084 s; Vite's existing large-bundle warning remains.
- Warmup commit 453cd11 pushed to private origin/codex/ability-performance (2.546 s).
