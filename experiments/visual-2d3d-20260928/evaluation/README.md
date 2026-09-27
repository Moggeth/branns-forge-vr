# Structured evaluation

`evaluate.py` accepts any world_spec v1 using the shared contract. It checks
route endpoints and continuity, one water crossing inside the bridge, bridge
span/alignment, grade, declared object footprints against route and water,
placement inside world bounds, terrain contact, and pairwise footprint overlap.
CSV and JSON outputs live here. Missing object radii are reported as unknown
for clearance/collision; they are not silently treated as measured colliders.
It accepts `terrain.base_y` and `base_height_m`. Gaussian hills use
`terrain.gaussian_coefficient` when declared; current A/C formula metadata is
recognized for older specs, and untagged B/D specs use the original 0.5
coefficient. A's declared ravine and channel carve are included in grounding
and off-bridge grade. The bridge deck is separate geometry, so terrain grade
beneath its crossing segment is excluded from the walkable grade result.

`path_*` assets are inferred to be path surfacing, and an explicit
`role: "surface"` on those assets has the same treatment. They may occupy the
named walkable route, spawn, bridge, and goal clearances; other exclusions
still apply. An explicit `role: "outcrop"` on a cliff chunk, or an untagged
cliff chunk, marks a terrain feature whose centre Y may be deliberately below
the surface; its actual mesh contact remains unknown. These inferences and
unknowns are counted in metrics. Ordinary rocks embedded up to 0.2 m meet the grounding
proxy; this tolerance covers deliberate 0.15 m sinking and coordinate rounding.
An exclusion may declare `except_roles`, which exempts only objects explicitly
tagged with one of those roles. Exemptions are counted, and exemptions near a
water region retain an unverified mesh-water contact warning.

From the repository root:

```powershell
python experiments/visual-2d3d-20260928/evaluation/evaluate.py experiments/visual-2d3d-20260928/variants/D/*.json
python experiments/visual-2d3d-20260928/evaluation/compare_edit.py experiments/visual-2d3d-20260928/variants/D/world_spec.json experiments/visual-2d3d-20260928/variants/D/clearing-edit.json
python experiments/visual-2d3d-20260928/evaluation/test_evaluation.py
python -B experiments/visual-2d3d-20260928/evaluation/evaluate.py experiments/visual-2d3d-20260928/variants/A/world_spec.json experiments/visual-2d3d-20260928/planning/artifacts/B/world_spec.json experiments/visual-2d3d-20260928/variants/C/world_spec.json experiments/visual-2d3d-20260928/variants/D/world_spec.json
```

On PowerShell, `*.json` argument expansion may depend on the Python launcher;
pass the four file paths explicitly if it does not expand. `metrics.json` and
`metrics.csv` currently contain the four explicit D cases. The clearing edit
increases radius from 6 to 9 m: it removes two nearby trees, retains 55 objects
unchanged, does not change the path, and passes before/after validation.

The semantic SHA-256 ignores only `provenance.measured_time_s`, so rerunning a
seed can prove reproducible world content. The focused tests include a missed
bridge, a blocked route and a prohibited path placement as negative controls.
The A/B/C/D comparison currently passes all four structured specs. A's bridge
exclusion was changed to its actual footprint and its outcrop was moved clear
of the water polygon. C explicitly exempts 15 bank boulders from its broad
brook exclusion: all 15 centres are outside C's mapped water polygon, but
some may touch water once their mesh extents are considered. A/B/C do not
declare object footprint radii, so a pass does not establish their
route/object collision clearance. These metrics do not assess
composition, true GLB collider bounds, render cost, actual navigation mesh,
stereo appearance or headset performance. Those need scene/render/VR evidence.

## Measured step timings

See `timings.csv`. Values are observed tool wall times; Python's inner
generation timings are in the specs. The first schema patch failed because the
patch context order did not match the file; rereading exact lines and applying
smaller context resolved it. For future schema adjustments, search exact keys
first and patch each occurrence independently.

The local bytecode cleanup command was blocked by command policy. The two
experiment folders now ignore bytecode so no generated cache is staged. Future
checks can use `python -B` to avoid creating cache files.
