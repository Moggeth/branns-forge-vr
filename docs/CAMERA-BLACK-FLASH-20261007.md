# Camera-dependent black rectangles

The user's 13.7-second video shows intermittent hard-edged rectangles while
looking around a built-up world, including while holding the axe (not specific
to Stormreel). HUD remains visible. The earlier negative-startup-delta fix is
present. Fresh-world and charged-Stormspire camera sweeps (96 views each) did
not reproduce the original material trigger. Do not claim that trigger is known.

A deterministic WebGL test of the actual atmosphere post pipeline reproduces
the visual failure: a tiny shader quad returning NaN blackens 78.95% of the view;
negative infinity similarly blackens 78.86%. UnrealBloomPass spreads invalid
HDR samples through its blur pyramid. This fix sanitizes the bright-pass input
before any blur, and the original scene/ray samples before tone mapping.
Finite HDR 0..1024 is unchanged; negative/NaN channels become zero, extreme
values cap at 1024 to retain half-float arithmetic headroom. No new render target,
render pass, readback, asset downgrade, or disabling of bloom is involved.

Afterward, injected invalid pixels affect under 0.02% of the screen and subsequent
healthy frames recover. Normal, infinity, overflowing brightness and recovered
frames have no black pixels. The test uses genuine WebGL and checks browser errors.

Run tests/browser-hdr-safety.mjs from multiplayer with PW_CORE/PW_CHROME and
ACCEPT_BASE configured as in browser-acceptance-lib.mjs. It needs a local Vite
server for source imports, has no VR/pointer capture and closes its owned browser.
Also run browser-startup-render.mjs for cold start, phone sizes and resize.

The guard patches the pinned Three.js bloom shader with an explicit source check;
a future dependency change must update this integration and rerun the GPU test.
Remaining limitation: the exact material producing invalid pixels in the user's
saved world has not been isolated. The guard contains that entire class of failure.
