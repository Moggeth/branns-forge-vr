# Rebuild, checks and lessons

The scripts in this experiment preserve cached model and image outputs. Start from [the experiment README](../README.md). The planned 80 m benchmark and camera IDs are in `benchmark.json`; never silently move those cameras when comparing A–E. `Run-World.ps1` reports a build only after schema, bridge alignment, spawn-ground and deck collision checks. The evaluator supplies complementary plan-level checks; it is not a substitute for mesh collision or a headset traverse.

## Fast verification from the repo root

```powershell
python -m unittest discover -s experiments/visual-2d3d-20260928/planning -p test_plan.py -v
python -m unittest discover -s experiments/visual-2d3d-20260928/evaluation -p test_evaluation.py -v
python -m unittest discover -s experiments/visual-2d3d-20260928/gallery -p test_gallery.py -v
python experiments/visual-2d3d-20260928/gallery/build.py --check
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant E -Smoke
```

Evaluate **all five primary specs in one call** before rebuilding the gallery. A one-spec evaluation overwrites `evaluation/metrics.json` and makes the other rows disappear, even though their scenes are fine. Read the evaluator's CLI help if its arguments change. `gallery/build.py` freezes no images; use `evidence/capture.py` after checking the corresponding common Godot render to update matched captures. Its output is committed separately from generated Godot smoke directories.

## Failures and the verified repair

| Attempt / evidence | Cause | Faster or safer method |
| --- | --- | --- |
| Passing `--setting-sources ''` to Claude CLI failed immediately (about 1.53 s). | The CLI treated an empty argument as a missing option value. | Omit that option. Clean the child environment, verify `claude auth status`, specify `claude-opus-5-5`, then verify the actual session model. Keep Opus in its isolated work folder. |
| A generated map was 1254 px; an initial 512-only parser rejected it. | The image generator did not obey the requested pixel size exactly. | Resize the full frame deterministically to the registered 512 grid, preserving the original source. |
| B's first bridge was angled wrong although its 2D preview looked plausible. | The preview and extractor shared an X-axis yaw convention; Godot bridge long axis is local Z. | Use `(sin(yaw), cos(yaw))`, check alignment against the route in Godot and retain the mutation regression test. |
| B initially lost a water arm and had displaced endpoint markers. | The painted bridge split the blue stream into components; source markers did not meet fixed benchmark anchors. | Join substantial components, save marker deltas, snap declared endpoints only and keep interior image-derived geometry. |
| Evaluator treated C's shore rocks as brook intrusions and two cliff origins as floating. | The representation omitted the intended role exception and intentional ground embed. | Declare the narrow `except_roles:["boulder"]`, verify centres outside water, and record the outcrop grounding semantics. Mesh contact remains unknown. |
| Common Godot build first culled terrain faces and missed orchard vertex colours. | Triangle winding and imported finish material differed from the working Orchard adapter. | Reuse its vertex-colour repair and correct winding; inspect an overhead render before changing geometry. |
| `python -m unittest -v path/test_gallery.py` imported an unrelated global `build` module. | File-path module resolution did not put the gallery alongside its test. | Use `python -m unittest discover -s .../gallery -p test_gallery.py -v`. |
| Direct file navigation in one Playwright CLI was refused despite valid local HTML. | That browser tool blocked `file:` URLs. | Serve the repo with `python -m http.server` for browser automation; the static page still opens normally from disk. |
| Preview Godot log failed, then a parse failure left the preview running. | `Tee-Object` held the same log path; later a typed GDScript inference error prevented normal startup. | Keep separate engine/console logs. Inspect `*.console.log` first after a hang, stop that preview instance, fix parse errors, rerun `-Smoke`. |
| First 160 m script used nonexistent `terrain.base_y`, then five objects blocked the extended route. | B/E use `base_height_m`; the new path crossed objects that were clear of the original path. | Support both terrain aliases. Preserve the obstruction rule and save each removed prop under `scale_probe.route_cleared`; rerun route physics. |

Blender `scene.blend` and GLB are editable/cached evidence, not a promise of unchanged byte output across Blender versions. A/C assets are high-detail full-LOD exports; performance should be checked in VR before integration. Godot runtime smoke scenes, imports, caches and logs should remain out of git; this experiment tracks the authoritative specs, source imagery/models and selected evidence.
