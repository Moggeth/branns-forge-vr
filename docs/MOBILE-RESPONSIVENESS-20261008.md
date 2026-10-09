# Mobile responsiveness — 8 October 2026

Branch `codex/mobile-responsive-20261008`, based on cached `origin/main` 091f487. Personal GitHub authentication blocks fetching and publishing. No production deployment claimed.

## Changes

- Tiny bootstrap mounts orientation controls before the lobby/Three.js dependency graph. Rotate acknowledges before awaiting OS promises. Early join shows progress and remains cancellable.
- Cooperative renderer construction; two concurrent GLB installations on touch, four otherwise. Essential world/weapon/actor assets first; secondary decorations, optional launcher and VR pouch after readiness. No gameplay entities removed.
- Mining partitions, texture uploads and first draws yield between jobs. Atmosphere is adopted before compilation; desktop materials compile against the actual HDR render target.
- Automatic resolution starts at 1.25 CSS pixels on touch, capped by DPR and 1.5. Sustained pressure lowers quality; recovery needs 20 seconds of headroom. Hidden tabs, menus and XR do not drive adaptation. CPU-bound overload stops at CSS resolution; GPU-bound workloads may use 0.75. Manual overrides in Input → Graphics. DOM text stays native resolution.
- Mobile reflection capture is 128px (formerly 256). Oversized GLB maps have a 1024px budget, held weapons 2048px. Most current maps already fit. Existing geometry/animation LOD, instanced vegetation and mobile shadow/effect budgets remain.
- Remote rigid axes/picks batch exact compatible triangles/materials, preserving local shader coordinates and named anchors. Saves 19 draws per axe and four per pick. Animated mechanisms excluded.
- Rotation resizes existing buffers without rebuilding the scene or requesting assets again. Warm-up restores the current viewport even if rotated during an awaited batch.

## Evidence

**RTX 3080 Ti Windows Chromium, not iPhone 12 or Safari.** Touch emulation and CPU throttling are synthetic stresses. No phone attached (`adb devices` empty; no iOS tooling). Sustained iPhone 12 60 FPS remains an unverified acceptance target.

Fresh-context welcome-screen runs:

| Measurement | Before | After |
|---|---:|---:|
| Desktop renderer ready | 18.214 s | 4.976 s |
| Desktop longest loading task | 14.777 s | 0.405 s |
| Touch renderer ready | 3.722 s | 3.512 s |
| Touch longest loading task | 0.813 s | 0.407 s |

Mobile readiness improved modestly (about 6%). Earlier usable controls, smaller uninterrupted tasks and optional downloads no longer gating entry are the main mobile gains. Synchronous environment preparation still costs roughly 0.4–0.5 seconds here; do not claim stall-free startup.

Early-input test passed at 4× CPU throttling: held game import and four optional GLBs, indefinitely pending OS orientation promise, cancelled early join, rotation during GPU preparation, solo entry without optional assets, repeated rotation, portrait/landscape graphics override. Initial tap measurements of 147–247ms included Playwright round-trip overhead. Final in-page click-to-next-frame-callback acknowledgement was 2ms in this synthetic blocked-import test, not physical input-to-photon latency. Renderer readiness under this 4× test was 8.653s.

Crowd A/B: 32 moving avatars + 32 bots, vegetation/home bases, 20Hz snapshots, 60 seconds each Hero/God, DPR 3, CPU 4×. Renderer fixture only, not 32 network clients. Both used Chromium's 980 CSS-pixel layout viewport (fixture lacked viewport meta).

| Metric | Before | Final |
|---|---:|---:|
| Hero frame interval p95 | 50.0 ms | 47.2 ms |
| Hero frame interval p99 | 59.9 ms | 51.5 ms |
| Hero GPU p95 | 30.63 ms | 26.41 ms |
| Hero draws | 1711 | 1569 |
| Hero triangles | 2,688,631 | 2,688,631 |
| God frame interval p95 | 35.2 ms | 36.1 ms |
| GPU textures | 283 | 281 |

The final policy settled at 1.0 under CPU overload (three gradual adjustments), preserving more detail than the intermediate 0.75-floor candidate. Hero improved modestly; the God result does not establish an improvement. Neither crowd result is 60 FPS. Worst intervals were 473ms Hero and 555ms God, with diagnostics/role transitions included. Exact real-GLB geometry/material/anchor tests pass independently.

Two-minute touch/DPR3 ability run with eight skeletons, oscillating movement, a confirmed crystal-wall cast and continuous Phoenix trajectory updates passed on the unthrottled desktop GPU (8.4ms p95 in each 30-second phase). This is not a thermal soak or a physical phone test. All 193 required Node suites passed in 109.9s; production build passed in 2.987s. Stale-RAF/rotation pixel checks passed for desktop, touch and forced HDR; invalid HDR containment passed in 0.575s. Runtime implementation commit: 4f07184.

The built production bundle also passed solo-entry and resize pixel checks on desktop, portrait touch and forced-HDR touch (20.733s total). Central screen black fractions stayed below 0.12%. These were local Vite-preview checks, not hosted production acceptance. The two owned Vite servers and all test browsers were closed at handoff; no headset runtime was opened.

## Reproduction and handoff

From multiplayer, `npm run dev`. Set `ACCEPT_BASE=http://127.0.0.1:5178`; Windows harness additionally uses `PW_CORE` and `PW_CHROME` for cached Playwright/Chromium. It disables native cursor capture and XR and closes browsers in finally blocks.

- Pure checks: `node tests/mobile-render-budget.mjs`, `node tests/rigid-weapon-batch.mjs`, `node tests/mining-warmup.mjs`.
- Browser: `browser-mobile-startup.mjs`, `browser-loading-response.mjs`, `browser-startup-render.mjs`, `browser-hdr-safety.mjs` in tests/.
- Ability run: `browser-ability-performance.mjs` with `PERF_TOUCH=1`, `PERF_DPR=3`, `PERF_PHASE_MS=30000`, `FORGE_PERF_URL=http://127.0.0.1:5178` (PowerShell uses environment variables).
- Crowd: `browser-battle-render-load.mjs` with `PERF_TOUCH=1`, `PERF_DPR=3`, `PERF_CPU_RATE=4`, `PERF_BASES=1`, `PERF_DURATION_MS=60000`. Optional `PERF_GAME_MODULE` selects a local Vite-transformed baseline. Never benchmark live public rooms.
- Required regression/build: `node tests/ci.mjs`; `npm run build`.

Do not run builds/CPU suites concurrently with frame benchmarks or edit watched source during a run. Read-only `document.querySelector('#world').brannDiagnostics()` exposes construction times, startup phases/queue, quality mode/pressure/resolution and frame timings. Ignored logs/captures: logs/mobile-responsive/. Stop only the owned test server; never terminate unrelated Node/VR processes.

Real-device acceptance still required: iPhone 12 Safari cold/warm launch, rotation, join/rejoin, forest movement, first tree strike, skeleton combat, pick wall and Phoenix aim; at least 15 minutes to expose thermal pressure. Record p95/p99 and stalls, chosen resolution, OS/network/battery conditions. Compare Automatic/Sharper image, verify clear UI and readable effects, and use a second client to confirm shared gameplay remains identical.

## Failed strategies and lessons

- Whole-scene warm draw hid a 14–24s synchronous desktop compile. Atmosphere adoption alone did not fix it; HDR/no-tone-mapping variants must match play.
- Offscreen warm batches compiled additional variants and worsened touch readiness to ~20s. Use a scissored canvas region behind the lobby; prepare HDR separately.
- Three.compileAsync traverses all meshes regardless of batch camera layers. Repeating it for every warm batch wasted startup CPU; compile the exact variants once, then split only the draws/uploads.
- Uploading all GLB textures before material enhancement inflated GPU textures to 319. Budget decoded images first; upload final scene textures afterward (281).
- Geometry merge needs compatible attribute layouts and local shader coordinates. Actual asset equivalence tests catch both.
- Old stress instrumentation matched an obsolete direct-render call. Assert the current skyCycle.render hook and include post-processing.
- UI acknowledgement cannot depend on an OS fullscreen promise resolving. Test blocked imports and platform promises deliberately.
- A long test that walks continuously leaves its intended cast area. Use bounded oscillatory movement and record authoritative action results; the original long test failed its wall assertion despite no browser exception. A subsequent run was invalidated by Vite reloading after patch-note edits. The isolated ability harness now disables the dev HMR client; source remains unchanged throughout measurements.
- PowerShell rg wildcards belong in `-g` filters; text source uses explicit UTF-8. Use apply_patch for long documentation payloads.


## Publication integration — 2026-10-09

Personal GitHub CLI authentication was repaired and verified as Moggeth against the private repository. The connector still uses the work account; use the verified per-command CLI wrapper for this project. Integrated the original two commits onto fresh main ee022e5 on codex/mobile-responsive-release-20261009, preserving the original branch. Retained voiceActivity and the new Emberdew, corner-ground and back-town diagnostics while resolving the game-constructor overlap.

The simplified welcome screen on current main hides the old solo button. Updated browser acceptance to exercise Play then the visible offline fallback, with only room sockets mocked. Initial mock closed every WebSocket, including Vite HMR, causing reloads and a missing prompt; restrict it to /peer paths. Fixed early Play so waiting for the renderer preserves invite and quick-play semantics and cancellation.

Integrated required checks: 200/200 in 152.9 seconds; production build passed (3.40 seconds tool duration). Early-input/rotation/settings check passed in 29.70 seconds on Chromium touch with 4x CPU throttling: orientation acknowledgement 3ms, 58 GLB requests with no repeats across rotations. Renderer-ready 11.89 seconds under that throttle; not a real-phone result. Pixel coverage checks passed desktop, portrait touch and forced-HDR touch in 28.21 seconds, without runtime exceptions. New upstream towns and assets increase startup work, so the historical A/B timings above must not be represented as measurements of current production content. iPhone 12 60 FPS remains unverified.
