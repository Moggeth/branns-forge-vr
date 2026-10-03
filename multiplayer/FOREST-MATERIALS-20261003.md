# Shared forest materials

The existing authored tree meshes now use the completed Opus bark/root/leaf
materials. Trunk fissures, a damp root collar, subtle per-tree colour variation,
leaf-cluster shading and bounded canopy wind are shared across intact instance
batches and promoted wounded/falling trees. No geometry, harvest, fall, growth,
save or network contract changed. Trunks and roots remain static in the shader,
preserving notch and axe raycast surfaces.

Provenance: `work/opus-forest-material-scale-20261003/metadata.json` verifies
`fauxgrady@gmail.com`, Claude.ai Pro, explicit and actual `claude-opus-5-5`,
including final verification. Measured commission duration **399.339 seconds**;
the artist handoff's informal duration estimate is not the measured value.
No new commission was required for integration.
Measured integration, review, tests and handoff interval: **487.187 seconds**;
individual execution durations are also recorded in `logs/work-timing.csv`.

## Ownership and integration

`client/tree-materials.js` owns cached material clones, shader uniforms and the
matching depth/distance materials. Authored GLB materials are untouched. The
default `createTreeView` owns a manager and releases its resources on reload or
dispose. A supplied `treeMaterials` manager belongs to the caller, who updates
its clock and disposes it. `treeMaterials:false` retains the legacy path, and
`windAmplitude:0` disables wind. Batch capacity doubling preserves decorated
shadow materials and logical tree IDs. No per-tree material allocation or
per-frame tree-matrix rewrite was added.

Integration fixes:

- Column-specific squared scale handles growth's nonuniform scale when
  converting world offsets and lighting normals. The actual GLBs have identity
  part frames, verified against their tree roots, so carved bark keeps its
  coordinates after promotion.
- Both shadow shaders retain `alphaMap` along with alpha-tested colour maps.
- The wind clock remains continuous across the former hourly wrap.
- Existing tree shadow enablement is preserved. Adding full-forest point-light
  shadows would substantially increase geometry submissions.

## Verification and cost

Run from the repository root:

```
node multiplayer/tests/tree-materials.mjs
node multiplayer/tests/tree-growth.mjs
node multiplayer/tests/legacy-trees.mjs
node multiplayer/tests/tree-integration.mjs
node multiplayer/tests/tree-land-timing.mjs
```

Six new checks passed (0.059 seconds test time): actual GLB frames, authored
material isolation, shared shader/shadow uniforms and cutout masks, nonuniform
normal/offset math, 500-instance growth/swap identity, notch/fall/reload cleanup,
and shared-manager/zero-wind/legacy compatibility. Existing six growth and
26 tree/notch checks passed (0.049 seconds and 0.628 seconds combined shell
time with the initial new-test attempt). Simulation integration passed in
0.075 seconds and landing timing in 0.036 seconds.

The reusable `tests/tree-materials.html` fixture renders actual GLBs through
production `createTreeView`, including growth at 100/300/600/1400 ms, carving,
falling, reload and a 500-tree LOD forest. It enables directional and point
shadows deliberately to compile both custom shadow shaders. Serve the checkout
root with a read-only static server, set `ACCEPT_BASE` to that loopback server,
and use the existing `PW_CORE`/`PW_CHROME` environment overrides with:

```
node multiplayer/tests/browser-tree-materials.mjs
```

Integrated Chromium verification passed in **3.538 seconds**, with zero page or
shader errors. Captures `output/playwright/forest-integrated-500.png` and
`forest-integrated-fall.png` were visually inspected; structured results are in
ignored `logs/browser-acceptance/tree-materials-results.json`.

The 500-tree fixture uses 12 LOD batch meshes, 27 shared surface materials and
30 depth/distance materials across the six source kits. Its deliberately enabled
sun plus point shadows submit 97 draws and 7,089,882 triangles across all passes.
Production retains its existing disabled tree shadows. This is shader/geometry
and draw-budget evidence, not a GPU frame-time claim or physical phone/HMD test.
The existing LOD remains about 1,772 triangles per tree; a future much cheaper
far silhouette requires an authored LOD and visual acceptance, rather than
silently changing gameplay or hiding trees.

## Fast-path lessons

Three 0.186.1 uses `ShaderLib.distance`, not `distanceRGBA`; the first new unit
test failed on that fixture name and passed after correcting it. Inspect the
installed `ShaderLib.js` before copying shader names from older examples.
Artist reference files are under `reference/client/`, not directly in
`reference/`; compare delivered files to the current checkout before copying.
On this Windows machine cached Playwright lives under
`AppData/Local/npm-cache/_npx`, not `.npm/_npx`; reuse the project harness's
explicit `PW_CORE` path instead of installing another copy. Existing QA port
5188 may serve a built distribution: use the isolated source fixture to verify
new shader source without overwriting a root-owned build.
