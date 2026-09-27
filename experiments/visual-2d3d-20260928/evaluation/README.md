# Structured evaluation

`evaluate.py` accepts any world_spec v1 using the shared contract. It checks
route endpoints and continuity, one water crossing inside the bridge, bridge
span/alignment, grade, declared object footprints against route and water,
placement inside world bounds, terrain contact, and pairwise footprint overlap.
CSV and JSON outputs live here. Missing object radii are reported as unknown
for clearance/collision; they are not silently treated as measured colliders.

From the repository root:

```powershell
python experiments/visual-2d3d-20260928/evaluation/evaluate.py experiments/visual-2d3d-20260928/variants/D/*.json
python experiments/visual-2d3d-20260928/evaluation/compare_edit.py experiments/visual-2d3d-20260928/variants/D/world_spec.json experiments/visual-2d3d-20260928/variants/D/clearing-edit.json
python experiments/visual-2d3d-20260928/evaluation/test_evaluation.py
```

On PowerShell, `*.json` argument expansion may depend on the Python launcher;
pass the four file paths explicitly if it does not expand. `metrics.json` and
`metrics.csv` currently contain the four explicit D cases. The clearing edit
increases radius from 6 to 9 m: it removes two nearby trees, retains 55 objects
unchanged, does not change the path, and passes before/after validation.

The semantic SHA-256 ignores only `provenance.measured_time_s`, so rerunning a
seed can prove reproducible world content. The focused tests include a missed
bridge and a blocked route as negative controls. These metrics do not assess
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
