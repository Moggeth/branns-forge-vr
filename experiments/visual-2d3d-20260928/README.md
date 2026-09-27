# Orchard Brook: 2D ↔ 3D production experiment

The [results report](reports/RESULTS.md) leads with the conclusions. The [evidence gallery](gallery/index.html) compares five scenes from identical Godot cameras, with a hide-labels switch for a first visual pass. The [walkable desktop preview](../../godot/experiments/visual_2d3d/preview/README.md) lets you move through A–E. This is an isolated R&D scene; it does not change the live Forge Yard or Orchard.

## Try it locally

From the repository root, run one of these PowerShell commands:

```powershell
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant A
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant E
```

WASD moves, mouse looks, Shift sprints, Space jumps, R resets, F1–F5 switches variants, and Escape releases the cursor. The preview is desktop-only. Godot 4.7.2 and the imported Orchard GLBs are needed. The launcher writes timestamped logs under `godot/experiments/visual_2d3d/preview/logs/`.

To rebuild one scene from its cached specification and capture the fixed cameras:

```powershell
& godot/experiments/visual_2d3d/Run-World.ps1 -Spec experiments/visual-2d3d-20260928/variants/E/world_spec.json -Out godot/experiments/visual_2d3d/e_smoke
python experiments/visual-2d3d-20260928/gallery/build.py
```

The gallery itself is a static HTML file with no server dependency. Its links to source plans, images, models, and validation data are relative. The saved 160 × 160 m [scaling plan](variants/scale/world_spec.json) rebuilds with `python experiments/visual-2d3d-20260928/variants/scale/build_large.py`, followed by the same Godot runner with `-Spec .../variants/scale/world_spec.json`.

## Cached inputs and repeatable pipeline

The [benchmark](benchmark.json) fixed the 80 × 80 m world, route, crossing and five cameras before the variants. [CONTRACT.md](CONTRACT.md) defines image/grid/world orientation. The A and C [editable Blender scenes](variants/A/scene.blend) and [specialist handoffs](variants/C/HANDOFF.md), the actual [generated map source](planning/input/generated-map-source.png), [registered layers and extracted B plan](planning/README.md), [procedural D generator](variants/D/README.md), and [hybrid E builder](variants/E/build_hybrid.py) are saved. All A–E Godot captures are frozen in `evidence/` and are reproducible without generating another image or making another model call.

The [bridge asset trial](asset_trial/with_ref/HANDOFF.md) compares no-reference and reference-assisted Opus models. The [secondary probes](probes/README.md) cover image-derived foliage, material pixels, stereo-offset views, and a single-view illusion that fails off-axis. `evaluation/` holds structural checks and concrete edit metrics. `docs/VERIFICATION.md` records fast paths and failed strategies. The generated 160 m output scene and runtime logs are ignored; the scale plan, selected views and measured metrics are saved.

No VR frame-rate, stereo comfort or in-headset collision claim follows from the desktop and headless checks. The preview's mouse/keyboard controls passed automated spawn/movement checks, but a human desktop traversal and headset playtest are still needed before integration into the live world.
