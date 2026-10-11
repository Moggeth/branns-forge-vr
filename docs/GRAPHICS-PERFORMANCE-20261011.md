# Graphics and performance candidate â€” 2026-10-11

Branch: `codex/graphics-performance-20261011`, based on `d94d191`.
Implemented and code-tested. **Local startup and visual checks passed on 2026-10-12;
performance acceptance and a hosted preview remain pending. Do not merge/deploy yet.**
Original local main divergence/work was preserved. Draft PR: #99.

## Changes

- Opus-authored soft canopy shafts, daylight-gated ground flecks, meadow colour
  drift/path fringes, rolling grass wind/tip sheen and coherent alpine colours with
  frosted treetops. Existing instancing, geometry/texture counts and simulation
  semantics are unchanged. Added shader noise and wider shafts still need profiling.
- Stable standing-tree lists across ordinary network snapshots avoid needless
  sunbeam rebuild/upload invalidation. Felling, growth ticks, awakening, relocated
  roots, clearings and seed changes still update exactly.
- GPU timing samples one frame in 30, keeps at most four queries outstanding, never
  waits for results, discards disjoint/context-lost samples and respects external
  profilers. Unsupported devices report `supported: false`.
- Renderer diagnostics count all scene/post passes. `cpuTimings` now also contains
  `gpuFrame`, plus lifetime counts over 33/50/100 ms. Percentiles are rolling 240-sample
  values; `gpuTiming` reports support and sampling cadence. Zero samples means no
  measurement, not a zero-cost GPU.
- Ability benchmark now reports p99/hitches, CPU/GPU and resource counts, and stops
  collecting before screenshots. The crowd profiler avoids nested GPU queries.
- `python scripts/graphics_asset_audit.py` produces an indexed deterministic report
  at ignored `logs/graphics-assets.json` (Pillow required). Stable filenames/hashes,
  download bytes, mesh primitives/triangles, skins, animations and image dimensions
  support future asset budgets. All LOD meshes count; procedural geometry does not.

Existing progressive loading/construction, warm-up, instancing, manual graphics
override, adaptive resolution hysteresis and quantized resizing were retained.
No competing governor or gameplay reduction was added.

## Asset audit and deferred decisions

61 production GLBs total **51,881,972 bytes**. Their 225 unique source images imply
**291,241,957 bytes** of RGBA+mipmap storage. This is a source estimate, not measured
GPU residency; excludes render targets, procedural textures, duplicated uploads and
driver overhead. Only axe and Stormreel exceed 1024, within the existing 2048 held-item
budget. An extra downscaled-GLB pipeline would mostly duplicate already-small assets,
so it was not built. Compressed GPU textures may help memory, but need colour-space,
normal-map and visual verification. Additional animation/post LOD must follow actual
profiling rather than guessing at a bottleneck.

## Art provenance

Original repository commission folder: `work/opus-graphics-polish-20261011`.
Fresh cleaned-child auth: `fauxgrady@gmail.com`, `claude.ai`, Max subscription.
Explicit/actual/final-verified model: `claude-opus-5-5`. Duration **340.126 s**, cap
720 s. No API billing/extra usage. Owned files: sunbeams, alpine-forest, meadow-cover,
mountain-ground-treatment. Root integrated the day/night uniform and reviewed changes.
Opus had no render available; no visual or GPU shader-compile acceptance claimed.

## Measured verification

| Step | Seconds | Result |
|---|---:|---|
| Isolated worktree creation | 5.303 | Original checkout preserved |
| Opus commission | 340.126 | Auth/model/output verified |
| Static dependency install, E: cache, scripts disabled | 7.265 | Passed |
| Production-style build check | 1.545 | Passed, existing large-bundle warning |
| Focused weather/meadow/adaptive tests | 2.648 | Passed |
| Full required suite | 132.668 | 205/205 passed |
| Ground shader-chain structural checks | 1.298 | 15 orchard checks passed |
| Asset audit | 0.279 | 61 GLBs read |

Ignored detailed logs: `logs/work-timing.csv`, `logs/graphics-ci.log`,
`logs/graphics-orchard.log`. The initial felling test omitted `cuts:3`; authority
correctly kept that tree standing. Fixed the fixture, not the implementation.

## Browser verification — 2026-10-12

The user started Vite on port 5197 after automatic approval review had blocked the
agent's launch. That user-owned server was left running. All owned browser contexts
were closed; WebXR and pointer capture were disabled throughout.

- Mobile startup passed in **38.922 s**: Chromium touch emulation, 4x CPU throttle,
  delayed game module/optional assets and a never-resolving orientation promise.
  Rotate acknowledged the tap in **1.5 ms**, before the renderer import. Cancelled
  joining stayed in the lobby. Orientation did not reload assets/rebuild the world;
  manual quality remained accessible in portrait and landscape. This is not an iPhone.
  Full ready time was 16.834 s under intentional loading stalls/throttling, so it is
  not a cold-phone load-time claim. Construction still contains long main-thread slices.
- Negative-frame/black-viewport checks passed in **32.568 s** at desktop tall, phone
  portrait and phone landscape with high post effects, including resize. The sampled
  black-pixel fractions were 0–0.418%, rather than an opaque viewport-sized rectangle.
  No runtime/shader/asset errors. Ready times were 6.610 / 4.772 / 9.023 s respectively.
- **16 matched full-game captures** passed in **59.230 s**, seed 41, noon/golden/night
  and God overview, phone 844x390 and desktop 1280x720. Camera position/quaternion
  matched exactly for every pair. Visually inspected both galleries: no black overlay,
  missing geometry or shader errors; meadow and alpine silhouette preserved, ground
  variation subtle, shafts softer. Moving foliage/particles are not pixel-deterministic.
- Actual backend: ANGLE D3D11 on **NVIDIA RTX 3080 Ti**. Phone viewport emulation does
  not emulate an iPhone GPU, thermal limits or Safari.

Evidence remains in ignored `output/playwright/graphics-20261012/` (comparison/gallery,
startup screenshots/results); raw ability profiles are in `logs/ability-performance/`.
`logs/work-timing.csv` records each measured run.

### Performance results are contaminated — do not use as an improvement claim

The 24-enemy idle/Pick aim/Pick cast/Phoenix aim fixtures completed and verified real
wall creation/forecast updates. Baseline took 51.865 s; candidate 53.576 s. Frame p95
was ~47–48 ms before and ~115–131 ms after. A 33.258 s diagnostic using old art still
performed poorly. These observations prompted checking the environment rather than
shipping or guessing at a shader regression.

After all test browsers closed, `nvidia-smi` still reported **95% GPU utilization,
7,726 MiB occupied and 326 W**; an unrelated Galactic Racer process was running.
During the diagnostic run utilization was 99%. Concurrent workload changed between
runs, so the figures do **not** establish a causal regression or an improvement.
The unrelated game was not stopped. Asked the user to close it and reply `GPU free`.
Repeat matched tests only when the GPU is idle; record utilization before/after each.
No sustained/crowd acceptance or physical iPhone 12 acceptance is claimed.

### Lessons and reproducible comparison

- Startup test initially failed in 13.502 s because the old `_BallistaBolt` selector
  missed the current `S_Bolt` / `G_Harpoon` assets. Check both current bolt scales and
  their reload-pivot scales; retain the legacy selector for historical fixtures.
- Baseline extraction must include `assets-source` JavaScript, not just client/shared:
  Timberline imports runtime code from there. The missing import caused HTTP 500.
  Run Git archive from the repository root, not the multiplayer subdirectory.
- Use `python scripts/prepare_graphics_baseline.py d94d191` from the repo root.
  It resolves the commit, rejects differing public assets, extracts only JS/JSON to
  ignored `multiplayer/tests/.graphics-baseline`, and records ownership/revision.
  Same-server comparisons share unchanged public assets; differing assets require
  separate complete checkouts. Existing unowned output is never overwritten.
- Then run `node tests/browser-graphics-comparison.mjs` from multiplayer with the
  environment below. For ability comparisons set `PERF_SOURCE_ROOT` to
  `/tests/.graphics-baseline` and `PERF_LABEL` to a unique baseline name; clear
  `PERF_SOURCE_ROOT` and use a second label for the candidate.
- Shader timings and profiler captures require an otherwise idle GPU. Check for
  unrelated games/renderers before starting a long benchmark; never close them silently.

## Remaining acceptance

Remote main advanced to a6f04e5 (Dragon round two and Watch-Arch remodel) while this
candidate remains based on d94d191. Integrate/recheck those changes before merge.
Private origin branch is the delivery location; no production deployment was made.

From this branch's `multiplayer` directory, the user can run:

```powershell
npm run dev -- --port 5197 --strictPort
```

Then set `ACCEPT_BASE` and `FORGE_PERF_URL` to `http://127.0.0.1:5197`, and
`PW_CORE`/`PW_CHROME` to installed Playwright/Chromium paths. Harness defaults disable
WebXR and Windows pointer capture. Close owned browsers in `finally`.

1. `node tests/browser-mobile-startup.mjs`: throttled touch, delayed assets,
   orientation response and rotation during warm-up.
2. `node tests/browser-startup-render.mjs`: negative-delta/black-viewport regression.
3. `node tests/browser-ability-performance.mjs` with `PERF_ENEMIES=24`,
   `PERF_PHASE_MS=10000`: idle, moving Pick aim/cast and Phoenix aim.
4. `node tests/browser-battle-render-load.mjs` with `PERF_TOUCH=1`, `PERF_BASES=1`,
   `PERF_DURATION_MS=900000`: 15 minutes per role, 32-player/32-bot synthetic renderer
   fixture. This is not network or physical-phone acceptance. Run without builds/tests.
5. Matched seed/camera/time/weather screenshots versus `d94d191`: Hero/God, noon,
   golden hour, canopy, treeline and night. Inspect new shader cost, hitch deltas and
   resource-count trends, not only average FPS.
6. Physical iPhone 12/Safari: cold/warm join, first spell use, sustained combat,
   orientation, heat/reconnect. Targets: 60 FPS, p95 <=20 ms, p99 <=33 ms, no repeatable
   first-use >50 ms spikes. **These remain targets, not achieved results.**

Use PowerShell `$env:NAME='value'` syntax for environment settings above. After
browser acceptance, verify a separate hosted preview before promoting to production.
