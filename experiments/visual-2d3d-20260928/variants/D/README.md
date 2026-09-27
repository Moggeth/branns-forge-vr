# D: seeded procedural-only Orchard Brook

`world_spec.json` is the default seed (20260928). Two further saved seeds and
`clearing-edit.json` are comparable variant inputs. This baseline uses authored
Python rules and the written benchmark only. It does not read or generate 2D
images and makes no claim about image extraction.

From the repository root:

```powershell
python experiments/visual-2d3d-20260928/variants/D/generate.py
python experiments/visual-2d3d-20260928/variants/D/generate.py --seed 20260929 --output experiments/visual-2d3d-20260928/variants/D/seed-20260929.json
python experiments/visual-2d3d-20260928/variants/D/generate.py --seed 20260930 --output experiments/visual-2d3d-20260928/variants/D/seed-20260930.json
python experiments/visual-2d3d-20260928/variants/D/generate.py --seed 20260928 --clearing-radius 9 --output experiments/visual-2d3d-20260928/variants/D/clearing-edit.json
```

The stream winds east-west, with a single bridge near the origin. The path
connects the benchmark spawn and ruin goal across it. Each planting cell has
its own seed-derived random stream, so changing the clearing only affects
trees within the edited area. `radius_m` is a conservative placement proxy;
the authored GLB bounds and Godot collider sizes still require engine checks.
The bridge is represented separately from terrain so its underside remains
possible in 3D. `yaw_rad=0` means its long axis runs along Z.

Generation itself measured 0.0022–0.0028 seconds for these four specs, recorded
in each spec's provenance. This excludes Python startup and scene import/render.
