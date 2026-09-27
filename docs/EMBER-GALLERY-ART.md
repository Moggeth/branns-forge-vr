# Ember Gallery art integration

`godot/ember_gallery_art.gd` is a self-contained Node3D module. Instantiate it,
call `setup(parent_node)`, and place the parent at the region origin. The module
adds itself to the parent, builds static art and colliders, and leaves all
interaction logic to the gallery owner. It changes no world environment, player
state, global materials or existing region. Remove/free its root to unload.

## Coordinates

Local bounds are x/z -10..10. Walkable base is y=0. The central entrance is on
the +Z side; a 2.6 m wide stone path connects it to the three fluid basins.
`world_point(id)` returns translated world coordinates from live Marker3D anchors.

| Anchor | Local point | Intended use |
|---|---|---|
| entry | (0, 0, 8) | Safe arrival / return point |
| supply | (-5, 1.02, 5) | Bench top: actual collidable surface |
| fire | (-5, 1.12, -4) | Cold brazier / ignition station |
| alcove | (8, 0, -5) | Optional torch reveal room |
| basin_0 | (-4, .03, 0) | Left patinated copper catch basin |
| basin_1 | (4, .03, 0) | Right catch basin |
| basin_2 | (0, .03, -6) | Rear catch basin |
| gutter_0 | (-4, .272, -4.45) | Left high inlet |
| gutter_1 | (4, .272, -4.45) | Right high inlet |
| gutter_2 | (0, .272, -8.85) | Rear high inlet |

Channels are 0.74 m wide with low guide rails. They slope from roughly 0.27 m to
0.05 m at the inlet opening of a 2.8 m basin. Each has a real angled collider;
the surface-field fluid system should use its normal/height samples rather than
assume y=0. Rim height is about 0.18 m. The central walkway is deliberately
independent of the channels. Altar and supplies are away from the exit.

## Lighting and performance

The building has actual closed side/back walls and a solid shallow pitched roof
with four broad ornamental vault ribs. These cast shadows. Two low-energy cool
OmniLight3Ds keep silhouettes and the exit legible; both disable shadows. There
are no active flame lights in this module. Supply the torch/fire lights from the
interaction module, keeping its own global shadow/light budget. The right alcove
has a separate low roof and a narrow doorway; its copper leaf carving and small
plinth sculpture are non-emissive so a moved torch reveals them physically.

The ambient contribution still depends on the enclosing game's Environment.
Fade a local gallery lighting profile in/out at entry/exit rather than darkening
every region. A standalone visual review used ambient color #7b9aa9 at energy
0.12, FILMIC tone mapping, torch color #ffb56b, energy 4, range 13 and shadows.
Those are demonstration settings, not a hardware-verified VR recommendation.
The owner should retain a comfortable navigation floor and tune final exposure.

Static opaque scenery is consolidated using `workshop_art.bake`. Copper and
patina materials are duplicated before adjusting metallic/roughness values, so
shared WorldZones materials remain unchanged. Result: **8 mesh batches, 83
StaticBody3D colliders, two unshadowed lights and 10 interaction anchors**.
Batching does not remove collisions. This count is not a GPU timing claim.

## Verification and visual evidence

Headless physical-ray checks are in `work/ember-gallery/art-smoke.gd` (21 checks,
zero failures), log `logs/ember-gallery-art-smoke.log`. They check the clear
entrance, continuous central floor, solid walls/roof, accurate supply surface,
three catch surfaces and three actual raised gutter inlets after batching.

Run with bundled Godot, `--headless --xr-mode off --audio-driver Dummy --path
godot --script ../work/ember-gallery/art-smoke.gd --quit-after 1000`. Require
`EMBER_ART_CHECKS`, no failures and no engine errors.

`work/ember-gallery/art-capture.gd` renders the module in a standalone native
scene on the RTX 3080 Ti, without reading player saves or calling paid services.
Remove `--headless`, use that script, and require `EMBER_ART_CAPTURED`.
Images: `work/ember-gallery/art-lit.png` and `art-unlit.png`. Hero framing is
(0,2.1,8.5) towards (-.8,2.3,-3), FOV 75. Both were visually reviewed. They show
the environment before interactive fluid/flame props are added; final evidence
should be captured from the integrated scene. No headset comfort test was done.

## Small lessons from this implementation

- A GDScript ternary containing an inline `as int % 2` failed parsing; use
  `posmod(z, 4)` for alternating integer courses. The failed engine run exited
  zero, reinforcing the required success-marker/no-error checks.
- SceneTree._process is a bool-returning callback; do not put an async screenshot
  coroutine there. Defer a separate `run()` method, await frame_post_draw, save,
  then quit. Also defer setup before Node3D.look_at; tree attachment is incomplete
  during SceneTree._initialize.
- Native art review required 1.983 seconds after fixing that harness. Final
  physics smoke completed in 0.381 seconds. Art construction and verification
  occupied approximately eight measured wall-clock minutes; timing rows are in
  logs/work-timing.csv. No Git repository exists, so no commit was made.

Alcove export follow-up: the shared custom WorldZones.rock primitives were absent
in the GPU image, while cylinders remained visible. This module now uses native
8-segment SphereMesh for its small faceted decorative elements. An actual torch
view now reveals the copper branch relief and a carved stone ember inside copper
prongs. Capture: work/ember-gallery/alcove-art-lit.png; 21 physical checks passed.
No shared WorldZones geometry was changed. Follow-up took 74 measured seconds.
