# Faster cold opening — 2026-10-15

Implementation: `30533a1`, preceded by stage diagnostics in `1d1de12`.
Based on main `007be8a`; isolated branch `codex/fast-cold-start`. The original
diverged main checkout and other projects were preserved. Routine publication is
authorized by this project's AGENTS.md.

## Changes

- A build-only Vite plugin emits gzip copies of all 63 GLBs: **53,790,848 bytes
  become 32,728,498 bytes (39.2% smaller)**. Decompression round-trips every source
  byte; no geometry, textures, animation or authored metadata are changed.
- Each packed URL includes its content hash. Both existing production publishers
  give only `/assets/packed/` a one-year immutable cache policy. Art changes create
  new URLs. Original authored assets remain available as a fallback.
- Bootstrap starts four low-priority model transfers while the welcome screen and
  code load. The same bounded installation queue consumes them once. Optional
  decorations are excluded; consumed transfer buffers are released from the queue.
- Browsers may automatically decode HTTP gzip, or receive raw gzip from static
  hosting. The loader checks the GLB magic before native decompression. Unsupported
  decompression, a failed download, corrupt gzip or a parse failure retain the
  original loader path and external-image base URL.
- Desktop preparations run against the actual HDR target, avoiding duplicate LDR
  world compilation and draws. First post-processing output happens after the
  framebuffer is restored, avoiding read/write feedback into its own scene texture.
- Compilation retains all hidden first-use, skinned, instanced and morph variants,
  but repeated exact geometry/material combinations are represented once. This uses
  original objects through read-only traversal, without reparenting or copying them.
- Small warm-render batches can share an eight-millisecond work budget, yielding
  between batches and painting at the budget boundary rather than waiting a full
  frame after every 24 meshes. Rotation, cancellation and prior target restoration
  retain their existing protections. Initial tree/resource reload happens once.
- Read-only startup diagnostics now expose named job timings, fallback counts and
  shader representative counts. No simulation, save, network authority, paid voice
  or gameplay rules changed.

## Measured evidence and limits

Fresh Chromium production-build contexts, local preview, same Windows runner:

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Bytes transferred before readiness | 60,595,041 | about 41,241,422 |
| Desktop renderer readiness | 6.503 s, 7.003 s | 4.398 s profiling; 4.512 s final render check |
| Phone-emulated renderer readiness | 5.228 s, 4.619 s | 4.114 s profiling; 4.466 s final render check |
| Exact world compile representatives | all 2000 objects | 1669 exact combinations |

These are individual local runs, not a statistical device/network guarantee. A
separate candidate browser case reached 5.391 s, illustrating variance. Phone gains
are smaller than desktop gains. The earlier hosted 11.687 s baseline is a different
network/run and must not be presented as a controlled percentage comparison.
Instantaneous first-ever loading is not claimed: about 41 MB still needs delivery,
and driver/environment preparation remains. Repeat visits benefit from immutable
model caching but still construct the renderer and prepare its GPU state.

Final production-build pixel checks passed for tall desktop, portrait touch and
forced-HDR landscape touch, including rotation and controls/solo entry. First-frame
black fractions remained below 0.2%; startup error was null in every case. Final
three-case harness: **21.248 s**. The standalone asset browser suite passed packed,
unsupported-decompression and deliberately unavailable packed-pick cases, with
original-file recovery, controls active and expected network failure excluded from
unexpected errors. Its latest full run before the final framebuffer-only correction
took **23.443 s**; final pixel checks cover that correction. No public test room or
microphone was used. Physical Safari/phone/headset acceptance remains unverified.

Ten asset-delivery tests pass, including all 63 byte-exact roundtrips, deterministic
hashes, HTTP/native decode, fallback, callback failure and bounded early fetch.
Compile-world tests retain exact hidden/skin/instance variants and the original live
graph. Focused ability, lighting, tree harvest, mining, fire, asset dependency,
day/night and quality checks pass; check and production builds pass.

## Reproduce / inspect / recover

From `multiplayer/`:

```powershell
node --test tests/asset-delivery.mjs
node tests/compile-world.mjs
node tests/mobile-render-budget.mjs
node tests/patch-notes.mjs
npm run build
npm run build:check
```

Run `vite preview --host 127.0.0.1 --port 5194 --strictPort` on the production build
for packed-delivery acceptance. Development intentionally uses original GLBs.
Set `ACCEPT_BASE` to that preview, then run `tests/browser-cold-assets.mjs` and
`tests/browser-startup-render.mjs`. Windows harnesses use the cached `PW_CORE` and
verified `PW_CHROME` paths documented in the recovery handoff. Stop only the owned
preview server/browsers. Do not benchmark alongside builds, tests or watched edits.

Runtime diagnostics: `document.querySelector('#world').brannDiagnostics().startup`.
`jobs.atmosphere` encloses other jobs and must not be added to them as an independent
duration. `deliveryFallbacks` should be zero on a healthy packed build; failures
retry the original authored model. Inspect the browser console and network request
for the failed URL. Rebuild the frontend if the packed file is absent; no Worker
deployment or credentials change is involved.

Ignored evidence: `logs/cold-start/` (profiles, builds, acceptance JSON, screenshots)
and `logs/work-timing.csv` (measured work steps). Original model sources remain in
`multiplayer/public/assets/`; packed files are generated under `multiplayer/dist/`.

## Failed strategies and verified lessons

- Explored Meshopt tooling, then removed it: native gzip met the lossless delivery
  requirement with no new runtime codec/dependency or art rewrite. No quantization
  or lossy texture conversion was introduced.
- Preview served `.glb.gz` with `Content-Encoding: gzip`; blindly decompressing it
  again caused all 46 essential loads to fall back and transferred about 77 MB.
  Inspect payload magic; tests cover both HTTP-decoded and raw gzip responses.
- The mobile post-processing-off object exists but has no `prepare` method. Test
  that method specifically and run the preparation callback directly when absent.
  Renderer readiness alone is insufficient: assert `startup.error === null`.
- Parallel shader preparation did not improve desktop readiness and produced an
  861 ms mobile main-thread task in one run. Keep renderer-state jobs sequential;
  overlap low-priority network delivery instead.
- Shallow `Object3D.clone(false)` still JSON-copies circular runtime userData. A
  tree-batch cycle aborted preparation and caused an 8.063 s first draw. Read-only
  traversal preserves original references and avoids copying instance buffers.
- A test-local `before` name collided with an existing declaration; use specific
  names. Guard shell exit codes and do not run browser acceptance after a failed
  build (an earlier patch-note jargon failure otherwise left an old preview build).
- Player notes reject developer terms such as "shader". Validate their final text
  before building; describe shorter loading in ordinary player language.
