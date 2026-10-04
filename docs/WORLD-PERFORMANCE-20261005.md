# Loading, crowds and host performance - 2026-10-05

Source baseline: 702f9ea. Work branch: codex/world-performance. Evidence is in ignored
`logs/performance-world/`; step durations are in `logs/work-timing.csv`.

## Changes and measured evidence

- Loading: fire warmup accidentally rendered the entire world before its asynchronous
  shader compilation. A detached four-layer fire scene now warms only fire. The ordinary
  frame loop waits for startup preparation instead of concurrently traversing a cold world.
  The local empty-world startup benchmark went from 17.94 s to 3.81 s. Fresh actual lobby
  checks reached ready in 3.51 s desktop / 3.36 s touch emulation, accepted name input and
  entered solo play without errors. Largest main-thread tasks were 745 / 758 ms. This
  significantly reduces the freeze; it does not claim that all loading work is asynchronous.
- Crowds: cloned glTF mesh primitives with identical joints and inverse bind matrices now
  share one skeleton palette within each actor. Separate actors remain independent. Real
  hero/skeleton assets: 15/38 palettes become one each; 66,876 posed vertices match exactly.
  The same 32-hero/32-skeleton scene uses 230 GPU textures instead of 864, with identical
  2,195 hero-view draw calls and 3,478,711 triangles. GPU frame timings varied between runs;
  do not interpret the texture reduction as a guaranteed whole-game FPS multiplier.
- Simulation: one lazy tree map per fruit-shedding pass replaces repeated full forest
  materialization. Entity ID allocation scans collections directly instead of flattening
  the entire world for every drop/projectile. The deterministic 600-tick busy fixture fell
  from 30.663 s (p95 63.638 ms) to 6.123 s (p95 14.534 ms). Checkpoint SHA256 is identical:
  f1625f64a442c3ed63c39d245e65b27761896f02cc2abf16d2800eecbd6fb1f5.
- Networking: unchanged keyed roster/order takes a direct delta traversal, avoiding map/set
  reconstruction. 2,145 differential cases produce exactly the prior wire bytes. A 1,000
  snapshot encoding microbenchmark median fell from 125.55 to 73.02 ms; update frequency,
  protocol, precision, packet bytes and recovery rules are unchanged. This is host CPU
  improvement, not a measured WAN latency reduction.

## Verification and rerun

From multiplayer: `node tests/ci.mjs` and `npm run build`. The pre-codec suite passed
171/171 in 117.2 s; the added codec oracle and state-codec/network-capacity/publication
checks also passed. CI includes the new palette, entity-ID and codec regression checks.

With a QA Vite server, set ACCEPT_BASE, BROWSER_QA_DIR, PW_CORE and PW_CHROME to the local
installed paths, then run `tests/browser-loading-response.mjs` and
`tests/browser-battle-render-load.mjs`. They close their headless browsers in finally.
Native pointer lock and WebXR remain disabled on Windows. Never open a headset or capture
the desktop cursor just to measure performance. The render crowd fixture explicitly uses
legacyBattle to exercise 32 bots: the newer home-base rules otherwise populated only six
while the old test silently claimed 32. Actual lobby/solo checks use current home bases.

## Limits and lessons

- Physical phone/headset, separate-network latency and 32 GPU-rendering devices remain
  unverified. 31 guest codec reconstruction and transport rate/recovery unit tests passed.
- Local live transport verification initially failed Origin denied (403): custom QA port
  5196 is not the default allowlisted 5178. Set ALLOWED_ORIGINS at emulator launch; do not
  retry an unchanged setup. Automatic review blocked a combined server restart. Creating
  .dev.vars afterward did not hot-reload it. This is a QA setup failure, not a protocol result.
- WorkCodex simulation inspection yielded useful retained fruit code. The networking
  delegation timed out after 1,050 s with no usable edits. A Windows worktree's .git pointer
  is not Linux-Git compatible under /mnt/c; use a real Linux checkout or Windows-aware Git
  for future WSL commissions. Root completed the codec review and implementation.
- The browser harness control flag is brannHarness.state().controlsActive, not controls().
  The initial incorrect wait timed out; the corrected test passed.
- Preserve visual populations, geometry and 60 Hz simulation. Fruit shedding still has a
  bounded history FIFO that can churn in unusually heavily felled worlds; changing fruit
  yield semantics was intentionally outside this exact-equivalence optimization.

## Ownership / operations

Original checkout and live Leap preview on 5194 are preserved. QA used isolated Vite5196
and a local cloud emulator8796; runtime logs are ignored. No room-worker change is needed.
Release via the existing private PR, CI and gated Vercel deployment; verify the hosted
version and actual solo loading before claiming release.
