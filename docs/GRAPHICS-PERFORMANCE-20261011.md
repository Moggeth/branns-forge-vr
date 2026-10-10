# Graphics and performance candidate — 2026-10-11

Branch: `codex/graphics-performance-20261011`, based on `d94d191`.
Implemented and code-tested; **browser/visual acceptance is pending. Do not deploy
or merge on code checks alone.** Original local main divergence/work was preserved.

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

## Remaining browser acceptance

Automatic approval review rejected the combined dependency-link, hidden Vite launch
and browser-test command: **"blocked by policy"**, no more specific reason. Nothing
launched and the operation was not rerouted. Independent dependency setup/static
checks succeeded. User was asked to start the server; no reply/server yet at handoff.
No hosted preview or production deployment was made.

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
