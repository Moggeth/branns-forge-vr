# Browser asset orientation

The simulation, camera and normalized assets use +Y up, -Z forward, metres.
`client/asset-pose.js` is the sole authored-to-runtime conversion boundary.

- Mossward GLB faces +Z: its eye sockets and shield face are on positive Z.
- Orchard's Edge works along +X: CuttingEdge_Mid is x=.45, Poll_Face x=-.09.
- Axe origin is the named Grip_Center socket, not mesh centre or bounding-box bottom.
- Skeleton feet retain authored x/z origin; an asymmetric shield must not move its centre.
- Conversion wraps the cloned hierarchy. Never rotate animated Root bones to fix imports.
- Facing/yaw belongs on the parent actor; desktop/XR presentation is separate from asset basis.
- Never mirror a weapon with negative scale to change hands. Register distinct grip poses when needed.

Run `node tests/asset-pose.mjs` from multiplayer. Run `npm run dev`, then open
`http://127.0.0.1:5178/tests/orientation-review.html` for six fixed actual-GLB views
and actual-socket/animation checks. This diagnostic is excluded from the production build.
Inspect the face, shield front, cutting edge, grip, FPS view and XR grip-space view.
These are offline transform checks, not physical headset comfort acceptance.

New imports require: explicit forward/up axes, metres/height, named grip or foot pivot,
source file/hash, animation compatibility, collision attachment contract, reviewed
cardinal/first-person/XR images and passing tests. Unknown assets and absent grip sockets
fail explicitly. No more silent fallback orientation guesses.

2026-10-02: passed 15 cardinal/oblique facing comparisons, axis/socket/reattachment tests,
6 actual-GLB browser checks, existing touch input tests. Corrected first-person presentation
after the first contact sheet showed an edge-on blade. A review fixture originally changed
Euler Y on the already-converted model; use a parent heading group just like production.
Do not infer a quaternion's yaw by adding to its decomposed Euler Y.

Discovery lesson: PowerShell does not expand positional `godot/skeleton*` arguments to rg;
use `rg -g` or discover actual paths first. Do not guess test filenames (there is no
peer/test-simulation.mjs); list tests before selecting. No native assets were changed.
