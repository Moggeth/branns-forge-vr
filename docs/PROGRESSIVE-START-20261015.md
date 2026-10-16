# Progressive opening - 2026-10-15

The playable gate now waits for **39 authored models**, down from 46. The full
world, trees, buildings, creatures, harvesting pieces and starting axe stay in
that set, so looking or walking around does not replace incomplete world geometry.
Seven unequipped weapons stream afterward alongside the existing optional models.
This is a conservative first split; it does not establish instant first-ever entry.

The queue runs one ordinary background job at a time, leaving room for input and
rendering. Selecting a weapon promotes its job and can start a separate demand
lane even if an ordinary download is stalled. Equip reaches the simulation only
after the prepared model is available; the old item remains usable. Sequence
numbers discard stale selections. Restored equipped tools also receive priority;
the client suppresses weapon actions while the authoritative tool is unavailable.
Remote heroes retain their previous item until the new one is prepared.

Streamed materials compile in batches of at most 16 representatives between
paints. The atmosphere wrapper adopts the actual HDR target only for the
synchronous compile call and restores it **before** awaiting completion, because
the world continues rendering. XR uses its direct target. Texture uploads yield
between textures. These paths do not mutate live scene hierarchy or layers.

Ground details install incrementally. Existing instance buffers and formations
stay in place. Both the final and fading instanced material variants compile
before attachment, followed by a 1.2-second depth-writing coverage fade. Temporary
materials are private copies and return to the original authored surfaces after
completion. Room changes invalidate suspended preparation and prepare placements
for the new seed; disposal never attaches a late group.

## Measured comparison

Fresh Chromium, same machine, identical production build settings and local
preview servers; no HTTP interception or public room creation. Each row is one
run, not a population estimate. The slower connection used CDP 12 Mbit/s download,
40 ms latency, 1 Mbit/s upload; it is not a physical phone acceptance test.

| Connection / visit | Before | Progressive |
| --- | ---: | ---: |
| Unthrottled cold navigation to ready | 4.771 s | 4.622 s |
| Cached reload navigation to ready | 2.534 s | 2.363 s |
| 12 Mbit/s cold navigation to ready | 30.969 s | 28.327 s |
| Packed models before ready | 46 | 39 |
| Encoded model bytes before ready | 31,234,792 | 26,164,909 |

That removes 5,069,883 bytes (16.2%) from the initial model transfer. Rendering
preparation and the complete starting world still dominate on a fast connection.
Total optional models still arrive afterward; this changes priority, not art
quality or the total content available. Performance evidence is ignored under
`logs/progressive-comparison.json` and `logs/progressive-comparison.log`.

## Verification and fast path

Use the production build and cached Chromium paths in the cold-start handoff.
Run `node tests/progressive-assets.mjs`, `mobile-render-budget.mjs`,
`compile-world.mjs`, `asset-delivery.mjs`, and `hero-view.mjs` for focused contracts.
`tests/ci.mjs` includes the new progressive suite. Browser verification:

- `tests/browser-progressive-assets.mjs`: stalls all seven streamed weapons,
  enters actual solo play, demands a blocked weapon, cancels it, then verifies
  real swaps and all ten detail groups. Desktop and touch landscape.
- `tests/browser-cold-assets.mjs`: packed/native/raw fallback and solo controls.
  The injected pick failure is now background work; wait for secondary readiness
  before asserting that fallback count.
- `tests/browser-startup-render.mjs`: desktop, touch portrait and forced HDR
  landscape; initial pixels, resize, controls and null startup error.

Check `#world.brannDiagnostics().startup`: `initialModels`, `streamedModels`,
`pendingTool`, `restoringTool`, `secondaryReady`, `completeMs`, `error`. Check
`world.decorations` for group/fade counts and `assetQueue` for demand progress.
A failed tool load retains the current item and reports how to retry. Rebuild the
frontend if packed assets are absent; no room Worker change is required.

## Failures that informed the fast path

- Fixed-delay browser assertions were unreliable on touch even when the queue
  was correct. Observe the requested URL with a bounded wait; keep the background
  response deliberately held so success proves bypass rather than eventual load.
- Python defaults to a Windows legacy encoding here. An inserted ellipsis became
  byte 0x85 and Vite rejected invalid UTF-8. Use explicit UTF-8 reads/writes and
  ASCII inserted literals; preserve existing non-UTF-8 documentation bytewise.
- Shell and Python file paths must agree with the tool working directory. An
  initial test creation and an archived-baseline npm invocation used repo-root
  paths from a different cwd. Use explicit repo/multiplayer directories and guard
  every external command before executing dependent tests or preview steps.
- The lightweight Node GLB helper omits animations; hero tests that do not need
  clips must explicitly provide an empty animations array.

Timing evidence: `logs/work-timing.csv`, including unsuccessful strategies.

- First required CI run caught a preloaded-fixture regression (212/213 passed in
  223.7 s): constructor-supplied decoration templates were treated as unprepared,
  and the terrain test searched only direct scene children. Preserve preloaded
  readiness and locate the named GroundDetail instance through the group. The
  terrain placement assertions remain intact; none was moved to the stale suite.


## Released and checked on production

PR #104 merged as `830cc7e`; its tree exactly matched tested PR head `e3062aa`
(`25bf8bacf76acfd793dc074cad000edb9fc3e2b2`). Corrected required CI run
38667225181 passed **213/213 suites in 360.9 s**; the check job took 391 s.
The first run found the preloaded-fixture issue above (253 s job, 223.7 s suites).
Production deployment 38667852674 succeeded in **42 s** on the existing project
and domain. No room service, credentials or public destination was changed.

The hosted HTML identified `830cc7e - 10-15 01:51Z`. HTTP was 200 and packed
models retained the immutable one-year cache header. Fresh hosted Chromium
navigation to ready measured **7.234 s**, including **6.181 s** renderer time;
39 packed models transferred 26,176,609 bytes including resource overhead.
Reload measured **2.448 s**, renderer 2.232 s, **39/39 model cache hits** and zero
model transfer bytes. All transferred resources on reload totalled 6,600 bytes.
These live timings differ from the paired local comparison and do not establish
an instant first visit. No HTTP routes were used in the cache benchmark.

Separate hosted acceptance held streamed weapon responses and exercised actual
solo entry, demand priority, cancellation, swaps and all ten scenery groups on
desktop and touch landscape. Both passed with null startup errors and no browser
errors. Those tests use offline room stubs and do not create public rooms.
Evidence: `logs/progressive-production-controls.log` and
`logs/progressive-production-repeat-visits.json`.

A further local first-swap probe found a remaining first-pick frame spike:
158.2 ms before and 191.7 ms with progressive delivery in one paired run; p95 was
8.4 ms in both. First crossbow max was 16.7 versus 25.0 ms (p95 ~16.7 ms).
These single observations do not prove a regression or stall-free first use.
Compilation and texture preparation do not guarantee every first draw is free
of driver/buffer-upload cost. Treat bounded GPU first-draw preparation as a next
performance investigation, and keep it against the real rendering target.
Raw evidence: `logs/compare-progressive-swaps.log`. Do not claim this release
makes every first action seamless or physical phones consistently 60 FPS.

The optional read-only WorkCodex review failed before producing findings:
Azure returned HTTP 401, principal lacks API/operation access. Wrapper metadata
recorded **9 s** with its internal reconnects. Do not repeat that strategy until
access changes; the release used local code review, focused checks, real browser
acceptance and full required CI instead.

PowerShell revision expressions containing braces must be quoted, for example
`git rev-parse 'HEAD^{tree}'`; an unquoted expression was interpreted as a
script block during release preparation. The quoted tree comparison succeeded.
For future startup work, include `node tests/progressive-sunder.mjs` in the quick
pre-push set, since it checks preloaded scatter transforms as well as terrain.

Measured elapsed time through hosted verification: 1737.1 s.
Detailed timing rows include overlapping review/CI/browser work and must not be
summed as sequential elapsed time. Owned local preview servers and test browsers
were stopped; the original diverged checkout and its user files were preserved.
