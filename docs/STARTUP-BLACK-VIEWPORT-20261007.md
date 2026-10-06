# Startup black viewport: 2026-10-07

## Cause and fix

On source 62d44be, startup completes asynchronous shader compilation and sets `previous=performance.now()`. A queued RAF callback can then arrive carrying a timestamp from before compilation finished. The frame loop capped positive deltas at 50 ms but did not clamp negative deltas. Exponential easing `1-exp(-dt*6)` became a huge negative value. Home-base bolt reload scale exploded (observed world matrix scale 1.3076e25), producing giant geometry and non-finite HDR pixels. Bloom spread those values across the screen. The HUD remained usable.

Clamp animation dt to [0, 0.05] at the frame-loop boundary. All downstream animation, movement and view updates receive nonnegative elapsed time. No shader, post-processing, asset, quality or networking changes are needed.

## Verification

- Reproduced the original black world locally with a real WebGL browser and intact HUD.
- Binary isolation identified Dawnhold/Grumblekeep ballista bolt meshes; their geometry attributes were finite but world transforms had exploded.
- Natural cold-start test: desktop 1504x1590, touch 390x844, touch 844x390 with full post-processing; each also resized/rotated. All pass, 44.696 s. Central black pixel coverage below 0.12%.
- Forced stale-frame test: inject a future completion timestamp into the served game, then verify first dt is zero, subsequent deltas stay within bounds, actual loaded bolt scales remain within [0.001,1], and pixels remain visible after resize. Previous code fails with first dt -16.0922 s. Initial fixed run passed all three modes in 43.189 s.
- Build check passed in 1.117 s. All 189 required CI suites passed in 116.632 s. Final assertion-enabled stale-frame regression passed all three modes in 43.749 s.
- Headless Chromium uses real WebGL; XR and native Windows pointer lock are disabled. Physical handset/headset acceptance is not claimed.

Run from repository root with PW_CORE/PW_CHROME configured as described in the browser acceptance helper:

```powershell
$env:ACCEPT_BASE='http://127.0.0.1:5197'
node multiplayer/tests/browser-startup-render.mjs
$env:STARTUP_STALE_FRAME='1'
node multiplayer/tests/browser-startup-render.mjs
```

Only use stale-frame injection against a local Vite source server. Default mode also supports the hosted build. Outputs and timings go to BROWSER_QA_DIR (default logs/browser-acceptance), outside Git.

## Investigation lessons

- First inspect frame dt, object transforms, bounds and material inputs when world pixels fail but DOM works. Shader NaNs can be a downstream symptom of animation instability.
- Match diagnostic browser routes by URL pathname, not an exact suffix: Vite adds `?t=` after edits. Assert that diagnostic hooks ran. Several initial route-based experiments did not run; their results were discarded.
- Read the entire HDR target, not just its center; resolve MSAA by switching render targets before readback. Three bad source pixels can spread through bloom.
- Shader isolation must preserve parent visibility and check an empty scene as a control. Binary search over visible renderables then inspect the guilty object's world matrix.
- Unique shader keys, fog clamps and alternate render buffers changed startup timing and sometimes hid the race. One clean screenshot did not validate those hypotheses. All speculative shader changes were reverted.
- Material investigation from 12:23:53 to 13:20:04 UTC took 3371 seconds (including failed experiments and local GPU runs). This was unnecessarily long; use the frame-clock/transform checks above first next time.

## Publication validation follow-up

GitHub rejected the initial patch-note category `Fixes`; the parser requires `Bug fixes`. The initial local CI run had started before that note was written, so it did not cover the final metadata. All other 188 remote checks passed. Validate new patch notes with `node tests/patch-notes.mjs` after authoring them, before committing; run the production build too. The category correction changes no runtime logic.

Also, `gh pr merge --auto` may merge immediately when status checks are optional. It is not a substitute for explicitly awaiting successful checks. The deployment workflow correctly held publication after the patch-note check failed.
