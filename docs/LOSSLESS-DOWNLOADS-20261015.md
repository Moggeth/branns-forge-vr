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
