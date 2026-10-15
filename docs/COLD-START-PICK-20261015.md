# Cold opening and the first-pick hitch - 2026-10-15

The complete 39-model starting world and all authored models remain unchanged.

## Findings and changes

The first Stonewhisper equip created private crystal geometry/attributes, metal
spill materials and an instanced halo during play. A trace measured 5.2 ms of
construction followed by a 267.5 ms render adding a program. Unequipping disposed
those materials, forcing work again. The loader had prepared only the shared GLB.

A local equipment cache now constructs the actual held effect before background
material compilation, retains it between swaps and releases it at game shutdown.
Readiness still comes from authoritative fractions; animations and appearance are
unchanged. Held bones remain transient and release on deselection. Equipment
arriving during initial rendering preparation also prepares before publication.

Every visit also regenerated the fixed Three RoomEnvironment reflection lighting,
costing roughly 0.4-0.6 s. Two stored CubeUV variants retain every half-float RGBA
sample. Reversible channel prediction, byte-plane encoding and neutral RGB sharing
reduce gzip payloads to 120,146 bytes (128) and 339,214 bytes (256). Colored data
retains all channels; alpha, including unused zeros, is preserved. This caches the
existing lighting calculation, with no new lighting design or lower precision.

Bootstrap prefetches it while the interface and models load. Construction proceeds
while it decodes. A DataTexture adopts the same mapping, dimensions, linear color
space and filters before world preparation. Failed delivery, invalid data or an
unsupported decoder uses the original generator. The build rejects stale Three,
RoomEnvironment source, atmosphere source, parameters or binary hashes. Committed
payloads get content-addressed URLs on the existing immutable packed-asset route.

## Measured evidence

Same-runner production builds against main f22dbb4; fresh Chromium, welcome-only,
no HTTP interception for cache/network measurements. Individual paired runs:

| Navigation to renderer ready | Before | Candidate |
| --- | ---: | ---: |
| Unthrottled cold | 4.467 s | 4.065 s |
| Cached reload | 2.388 s | 2.047 s |
| 12 Mbit/s, 40 ms latency cold | 27.624 s | 27.631 s |

The full initial model payload stays 26,164,909 encoded bytes across 39 models.
The small extra lighting transfer offsets the CPU saving on the limited link;
that case is effectively unchanged. Do not claim instant first-ever entry or
faster slow-network downloads. World construction and rendering remain the floor.

Production-build pick -> axe -> pick checks on desktop, touch and forced-HDR touch
all measured 8.5 ms maximum frame gaps, unchanged program counts and unchanged
cached-effect construction counts. These nine swaps are distinct from development
source instrumentation. Physical phone/headset acceptance is not established.

Generated versus baked lighting on metallic/matte surfaces at both resolutions
showed zero changed half-float samples out of 262,144 per variant on this
NVIDIA/D3D11 runner. This checks upload, mapping, filtering and reflections beyond
the codec's exact source-pixel SHA-256 roundtrip. Production browser checks passed
healthy desktop/touch lighting, deliberate HTTP 503 fallback, unsupported decoding
and raw model fallback, desktop/portrait/HDR startup, resize, solo controls,
delayed optional equipment and all ten detail groups. Startup errors were null.
No public rooms or microphones were used. All 63 GLB byte roundtrips still pass.

## Reproduce and maintain

From multiplayer, use the cached browser paths in the previous cold-start handoff.
Owned Vite uses 5196 for the bake fixture; production preview uses 5194. Stop only
identity-checked owned servers after verification.

- Fast Node suites: environment-delivery, readiness-cache, pick-luminance,
  weapon-readiness, progressive-assets, progressive-sunder, asset-delivery,
  mobile-render-budget, compile-world and patch-notes under tests/.
- Run production and engineering builds. The two new Node suites are required in
  tests/ci.mjs; browser checks remain separate manual acceptance.
- Set BAKE_BASE=http://127.0.0.1:5196 and ACCEPT_BASE=http://127.0.0.1:5194, then
  run tests/browser-environment.mjs for rendered equality and real fallback.
- Run tests/browser-pick-readiness.mjs for first/repeat swaps in three render modes.
- Run browser-cold-assets, browser-startup-render and browser-progressive-assets
  for the complete-world, delivery, resize and demand-priority checks.
- Regenerate with scripts/bake-room-environment.mjs against owned Vite. Review
  fingerprints and rerun roundtrip/rendered equality. Commit both bfenv.gz files
  and room-environment.json together. Never re-bake silently during CI.

Diagnostics expose startup.environment (source, readyMs, fallbackReason),
startup.weaponPreparation (readiness build time), readiness (prepared, constructed,
disposed) and programs. Healthy packed openings report source baked; generated
fallback should have a reason. Logs are ignored under logs/pick-cold-*,
logs/pick-first-trace-* and logs/pick-readiness-production.log. Timings are in
logs/work-timing.csv; overlapping steps must not be summed as elapsed time.

## Lessons from attempts

- Prepare held-only material/attribute variants, not only the GLB. Retain effects
  through swaps rather than delaying equip or substituting a different visual.
- Raw HDR gzip was about 1.2 MB desktop. Exact half-float prediction reduced it to
  339 KB. Validate alpha and colored inputs, not just neutral RGB.
- Vite adds timestamp queries after edits. Profile routes by pathname and assert
  the hook exists. A query-sensitive glob produced no trace and was discarded.
- Large combined source/document-writing shell requests were rejected before
  execution. Structured apply_patch plus separate verified-directory commands
  completed those steps. Avoid combined writing/execution/publishing requests.
- Use absolute log paths when mixing repo-root and multiplayer tools. Locate
  installed Three sources with rg --files rather than guessing package paths.
- WorkCodex's known Azure 401 was not retried without an access change.
