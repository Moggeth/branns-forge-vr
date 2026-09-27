# Forge Yard lantern pilot

`build_lantern.py` builds a hand-scale lantern from fixed geometry and materials. The exported GLB uses metres, +Y up and -Z forward. It has 904 triangles, five embedded materials, and no texture or external file dependency. The opaque honey chamber gives a warm glow without transparency sorting or alpha overdraw in VR. `FlameCore` is an art mesh; a game light, flame motion, collision, and interaction belong to the runtime.

From the repository root, run:

```powershell
& './tools/blender-4.5.13-windows-x64/blender.exe' --background --factory-startup --python-exit-code 2 --python './assets/asset-lab/pilot/build_lantern.py' -- --out 'C:\absolute\output\directory'
```

The output directory gets `model.glb`, editable `source.blend`, `front.png`, `side.png`, `three_quarter.png`, and `report.json`. The script requires an absolute `--out` path. These outputs are build artifacts; the builder is the reproducible source. No playable asset is installed by this pilot.

The exported mesh bounds are X `-0.073..0.073`, Y `0..0.346896`, Z `-0.073..0.115` metres. The `Grip` marker is at `(0, 0.132, 0.101)` on the rear knob; `Flame` is at `(0, 0.145, 0)` in the chamber. Named parts include `Foot`, `HoneyGlass`, `FlameCore`, `GripWrap`, six `CagePost_XX` meshes, and nine `CarryHandle_XX` segments. The exact complete name list is in `report.json` after a build.

The pilot render and GLB export completed with bundled Blender 4.5.13 in 4.38 seconds on 2026-09-27. I visually checked the three-quarter preview. The GLB still needs a Godot import and an in-world scale/hand comfort review before game integration.
