# Mobile performance, 6 October 2026

Based on private origin/main 8a74689. Source work isolated in codex/mobile-performance; the divergent original main and running Leap preview were preserved.

## Changes

- Merge compatible skeleton/Forgeling body primitives once per loaded template, by exact material, skin and identity transform. No simplified meshes, texture substitutions or animation-rate changes. Gear and shields remain independent. Skip animation clips, morphs, transformed hierarchies and incompatible layouts. Saves 5 body draws per skeleton, 13 per Forgeling. Keep all vertex attributes/indices and exact bone weights; original named attachment groups remain.
- Read coherent prepared matrices within limb aiming and two-bone IK rather than repeatedly updating all ancestors. Existing movement, attacks, recoil and foot placement remain unchanged.
- Keep two home-heart light slots visible to the renderer, at zero intensity when bases are hidden. Previously leaving the home-base mode changed the light count and invalidated all lit shaders. Authored position, colour, range, intensity and fall/fade behaviour are retained. The loaded base mode already has two lights; legacy worlds now retain two zero-intensity slots too.
- Warm the actual Forgeling variants before joining, alongside skeletons and Heroes.

## Measured evidence

Headless Chromium, RTX 3080 Ti, touch/coarse-pointer viewport 844x390. This is NOT physical Android/iPhone GPU or network acceptance. The synthetic scene has 32 Heroes and 32 bots, 20 Hz moving snapshots, no authority stepping or networking. No concurrent heavy tests during the throttled pair.

With bases enabled and CDP CPU throttling 4x:

| Metric | Before | After |
|---|---:|---:|
| Hero draw calls | 1,998 | 1,710 |
| Hero triangles | 2,688,295 | 2,688,295 |
| Hero frame CPU median | 55.7 ms | 45.7 ms |
| Hero frame CPU p95 | 75.8 ms | 63.3 ms |
| God draw calls | 1,151 | 863 |
| God triangles | 1,515,066 | 1,515,066 |
| God frame CPU median | 35.4 ms | 30.6 ms |
| God frame CPU p95 | 55.2 ms | 44.9 ms |

Unthrottled legacy-mode join: 67 new shader programs became 3; worst recorded frame CPU went from 5,324.9 ms to 175.1 ms. This specifically exercises removal of home bases after the default lobby, not every loading bottleneck. Empty-lobby readiness remains separately recorded. GPU timings fluctuate and do not establish a phone FPS improvement; first after-run overlapped focused CPU tests and was discarded for speed claims. A quiet repeat showed mixed desktop frame tails, motivating the controlled 4x pair. Do not promise 60 fps for 32 players from these numbers.

## Correctness and visual preservation

- 448,810 posed vertices checked against original GLBs, all attributes and triangle indices identical; independent actor cloning maintained.
- 1,781,760 world-matrix values compared against pre-change animation modules across both rigs, walking, slopes, attack, recoil and missing limbs (tolerance 1e-12).
- Actual batched skull surfaces pass front/rear, eye socket, jaw and glancing projectile tests; actual batched creature presentation passes emergence, scorching, dismemberment/death.
- Home-light tests cover exact position/intensity/range, hiding without phantom illumination, repeated transitions, kit reload and cleanup.
- Hero before/after captures visually reviewed: authored models, materials, meadow, trees, mountains and equipment retained.

## Reproduction and evidence

Use the existing guarded browser harness (headless, Windows native pointer lock and XR disabled). Start a foreground, tool-owned Vite process on an unused loopback port; no visible background console. Set PW_CORE/PW_CHROME to the installed Playwright library/Chromium, ACCEPT_BASE to the server, BROWSER_QA_DIR to an ignored result folder. Run `node multiplayer/tests/browser-battle-render-load.mjs` from repo root. Optional PERF_TOUCH=1, PERF_WIDTH=844, PERF_HEIGHT=390, PERF_CPU_RATE=4, PERF_BASES=1. The last flag keeps current home bases while explicitly preserving the 32-bot stress roster. Without it the legacy fixture tests the shader-count transition.

Results, profiles and captures are under logs/mobile-perf/{before,after-idle,final,throttle-before,throttle-after}. Measured harness durations: 46.519, 46.896 (contended), 45.740, 40.916, 49.842, 49.695 seconds respectively. See logs/work-timing.csv for exact captured times. Ability baseline took 16.750 s; geometry proof 0.169 s, animation proof 0.229 s, skull regression 11.335 s.

## Learning

Warm every lighting configuration that can actually render, or retain a stable zero-intensity light slot. Warming every model alone did not fix the multi-second recompile: scene light-count tracing identified the difference. Keep CPU benchmarks isolated from regression suites. Fewer draws are deterministic evidence; noisy desktop frame timings alone are not. A combined background-launch command was rejected; the existing foreground tool-owned Vite path worked, so no persistent process or approval workaround was needed.

Full blocking CI: **188/188 passed in 116.0 seconds**. Production build passed (2.275 s command / 486 ms Vite build); build-check passed (0.773 s command / 491 ms Vite build). Existing large-chunk warning remains.
