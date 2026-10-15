# Smaller first downloads, 2026-10-15

Build-time lossless image packaging reduces the bytes needed for the same complete
starting world. Source GLBs and PNGs remain unchanged. There are still 39 initial
models and 19 streamed models; no geometry, texture resolution, material tuning,
animation, loading gate or scenery visibility was removed or deferred here.

## Delivery and quality contracts

- `multiplayer/scripts/lossless-textures.mjs` converts eligible embedded and external
  PNGs to lossless WebP, using pinned build-only Sharp 0.35.5. Every conversion must
  preserve decoded RGBA bytes and dimensions, including RGB behind zero alpha.
  Encoding uses lossless/exact mode, never near-lossless. Profiled, oriented,
  animated or non-8-bit images keep their original representation. JPEGs are kept.
- Model bufferView indices remain stable; non-image contents remain bit-exact.
  Repacked buffers align ranges to four bytes and share identical ranges within a
  model. Nodes, meshes, accessors, materials, skins, animation and texture settings
  remain identical. Converted textures declare required `EXT_texture_webp`.
- Compare final gzip sizes and retain the old exact-source gzip when it is smaller.
  Unmodified models retain their existing immutable URLs. No extra model requests
  or cross-model texture dependency chain is introduced.
- Model gzip/parse failure uses the original GLB. Unsupported decompression also
  uses original GLBs. External smaller-image HTTP/decode failure retries the
  original PNG before reporting failure; callbacks and texture settings are kept.
- Content hashes cover actual emitted bytes. The diagnostic inventory is
  `/assets/download-report.json`, outside the immutable `/assets/packed/` route.
  It records original gzip/image size, delivered size and URL per file.
- The original byte-exact gzip helper and tests remain. Optimized GLB containers
  intentionally differ from the source file; the new stronger art check compares
  scene semantics, exact geometry buffers and decoded image pixels separately.

## Verification and commands

Run `node tests/lossless-textures.mjs` from `multiplayer/` for all 63 source models,
all root PNGs, invisible RGB/profile protection and texture fallback callbacks.
This suite is required by `node tests/ci.mjs`. `npm run build` performs the same
pixel guard before emitting any optimized images. Build overhead on this runner
is about 14 seconds; no image encoder is downloaded by the game browser.

Use the existing installed browser paths and acceptance harness documented in
`docs/COLD-START-PICK-20261015.md`. Against production preview/deployment:

```
node tests/browser-lossless-textures.mjs
node tests/browser-cold-assets.mjs
node tests/browser-progressive-assets.mjs
node tests/browser-pick-readiness.mjs
```

The new browser check independently compares all converted embedded/external
images after actual browser decoding and GPU texture upload/readback, exercising
both default and disabled colour conversion. Separate touch-mode HTTP 503 and
invalid-image cases verify ground PNG fallback. Keep these interception-based
failure checks separate from cache and slow-link measurements.

The first Node run passed in 15.365 s: 48 converted embedded image uses, all scene
semantics and geometry preserved. Initial model payload fell from 26,164,909 to
23,038,709 bytes (12.0%). All root PNG candidates together fell from 13,484,827 to
10,638,620 bytes; not all of those files are requested during startup.

## Measurements and release

Paired baseline is current `b54eef7`, archived into ignored
`logs/download-baseline-source/`, sharing dependencies through a junction. Browser
benchmarks use clean contexts, welcome screen only, no HTTP interception, one GPU
workload at a time. Network runs use CDP throughput limits and 40 ms latency.
Raw results: `logs/download-comparison.json`; timings: `logs/work-timing.csv`.
Final benchmark and release results are appended after verification.

## Discarded strategies and lessons

- Exact decoded JPEG-to-lossless-WebP trials on landmarks, golem and bases took
  6.405 s and usually grew image sizes several-fold; keep their JPEG payloads.
  Do not use lossy recompression to chase an unsupported download-size claim.
- Identical embedded images across models total about 3.5 MB of raw redundancy.
  Splitting all images into network dependencies adds many small critical requests;
  this pass keeps self-contained models and only shares duplicate ranges inside
  each model. Cross-file sharing remains a measured future option.
- Compare bytes rather than Buffer object identity for cached optimizer results:
  duplicate input images can have different Buffer instances with identical bytes.
- Read and execute from the verified directory. A baseline build's first relative
  redirect landed one level above logs; moved it into ignored logs before staging.
  Use `rg -g 'browser-*.mjs'` rather than a positional Windows wildcard path.
- Do not put an unhashed diagnostic inventory under the immutable packed route.

Primary references used for implementation: [Sharp lossless WebP options](https://sharp.pixelplumbing.com/api-output/#webp)
and [Khronos EXT_texture_webp](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_webp/README.md).

## Released measurements

PR [#106](https://github.com/Moggeth/branns-forge-vr/pull/106), source commit
`2a5abb73b932bb4331e61825ab1be5f7935a5e6b`, merged as
`0fd49af96bf20f63de1fe5f23fa027782b86c025`. Required CI run `38694294970`
passed **216/216 suites in 389.0 s**, job duration 416 s. The historical nonblocking
stale suite remained unchanged. The tested and merged trees were identical:
`7181de6706b06a1c8fe282b00c6438570eb03228`.

Production workflow `38695131287` passed in **79 s**, including the existing cloud
room health check, pixel-guarded production build and staged asset-integrity check.
The build adds a pinned native image encoder on CI/developer machines only; it
does not add a browser image-compression library or new runtime image requests.

Paired local navigation-to-ready results (one controlled run per case, fresh
contexts, 40 ms latency for limited links, no HTTP interception):

| Connection / visit | Before | Smaller textures |
| --- | ---: | ---: |
| Unrestricted, first | 6.112 s | 4.381 s |
| Unrestricted, cached | 2.679 s | 2.795 s |
| 12 Mbps, first | 28.044 s | 25.007 s |
| 6 Mbps, first | 52.261 s | 45.371 s |

First-visit resource transfer fell from **36,510,537 to 31,656,275 bytes**:
**4,854,262 bytes / 13.3% smaller**. Initial models were 26,164,909 -> 23,038,709
encoded bytes; the eight initial world textures were 8,140,696 -> 6,412,314 bytes.
Across all 63 models, gzip delivery fell 32,728,498 -> 29,170,891 bytes. Fast-link
CPU/driver variation affects the unrestricted figures; the link-limited gains
align with the smaller payload. These measurements do not establish physical
phone acceptance, universal timings, or instant startup on slow connections.

Local acceptance passed: lossless browser pixels/fallbacks 13.105 s, packed/raw/
failed-model cold paths 27.632 s, progressive desktop/touch priority/cancellation/
decoration fades 25.804 s, and nine pick swaps across desktop/touch/touch HDR
45.394 s. The actual committed production build passed in 19.340 s. Paired load
benchmarks took 180.281 s; dependency installation took 1.736 s.

Actual hosted revision `0fd49af` then passed:

- Fresh visit: 9.066 s navigation-to-ready, 39 initial models, eight smaller world
  textures, zero delivery fallbacks, baked lighting and null startup error. Total
  resource transfer 31,379,711 bytes. Live network results are unpaired and must
  not be compared directly with prior release timings as a performance proof.
- Cached reload: 2.667 s; **39/39 models and 8/8 world textures transferred zero
  bytes**, total resource transfer 4,200 bytes. Healthy visit/reload/header check
  took 24.287 s. Model/image URLs returned one-year immutable cache headers.
- Browser/GPU equality: **58 delivered images, 152,436,736 channel values, zero
  differences**, covering both colour-conversion settings. Deliberate external
  HTTP 503 and undecodable-image cases recovered the authored ground PNG. Hosted
  pixel and fallback harness took 26.449 s.
- Nine hosted pick/axe swaps passed in 60.876 s: maximum observed frame gap
  **16.8 ms**, no new readiness effects and no rendering-program count increase.
  Includes desktop, touch and touch HDR; this is desktop Chromium touch emulation.

Evidence is ignored under `logs/download-*.json`, `logs/download-*.log`, browser
captures and `logs/work-timing.csv`. Both owned preview servers were stopped and
each browser closed in its finally block. No public room was created, no voice
was invoked, and the original diverged/user checkout was preserved.
