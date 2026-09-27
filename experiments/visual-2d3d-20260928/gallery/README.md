# Orchard Brook evidence gallery

Open [index.html](index.html) locally in a browser. It contains its data inline and links to saved experiment files through relative paths. After new renders, sources or evaluation metrics arrive, rebuild it from this directory:

```powershell
python build.py
python -m unittest discover -s . -p test_gallery.py -v
```

The builder requires only Python's standard library. It reads `../benchmark.json`, the known A–E source paths, `../evaluation/metrics.json`, `../evaluation/edit-metrics.json`, and `../variants/A/validation.json`. It never calls a model or changes scene assets. The five fixed camera IDs must still match the benchmark. Camera images are found by name (`overhead`, `approach`, `crossing`, `landmark`, `reverse`) in the first matching root below, each with `.png`, `.webp`, `.jpg` or `.jpeg` extension:

1. `../evidence/<letter>/` (frozen matched Godot captures)
2. `../variants/<letter>/renders/`
3. `../variants/<letter>/render/`
4. `../variants/<letter>/evidence/renders/`
5. `../renders/<letter>/`
6. `../../../godot/experiments/visual_2d3d/renders/<letter>/`

All image and document links remain relative; no copied evidence is needed. The gallery shows a source preview where one exists. The camera comparison has a label toggle for a less biased first pass. The metric table uses only the primary `world_spec.json` evaluation entry for each variant; separate seeds and edit variants do not overwrite the primary row. The D clearing edit is described as a structural correction because before/after visual renders are not yet present. An imported GLB check for A is reported separately from engine validation.

Current build: all five variants have five fixed-camera captures from the same Godot renderer. A and C also retain their original Blender scene renders for specialist review. E includes the reference-assisted bridge and C beacon. The gallery links the bridge A/B asset trial, 2.5D probes, and 160 m scaling capture. Desktop captures do not verify headset performance.

For a browser automation check, serve the repository root with `python -m http.server 8765 --bind 127.0.0.1` and open `/experiments/visual-2d3d-20260928/gallery/`. Stop with Ctrl+C. A Playwright CLI attempt to open `file:` was blocked by that tool, even though the standalone HTML is designed to open directly in a normal browser. The local HTTP server resolved that tool-specific limitation. The page has no external network dependencies.

## Verification and timing

At 1440 px and 390 px viewport widths, the gallery rendered with legible cards and a horizontally scrollable metric table. The Crossing camera button selected A's crossing render; missing renders would appear as explicit placeholders. A reload after adding an empty data favicon reported zero browser console errors or warnings. The final builder reports A–E: 5/5. Browser layout was checked before final evidence capture; rerun responsive visual checks after changing the template.

See [timing.csv](timing.csv) for measured step durations. The implementation-and-browser interval from `build.py` file creation at 00:34:07 to the 00:38:43 clock reading was 276.6 s, including edits, rebuilds and inspection. Discovery occurred before that interval and is recorded by command durations; it was not timed end to end.
