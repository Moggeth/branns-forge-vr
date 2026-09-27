# Secondary 2D → 3D probes

These are small, deliberately limited studies using pixels from `../references/environment-board.png`, which was generated with OpenAI image generation on 2026-09-28. Python 3.13/Pillow/NumPy prepare the textures; Blender 2.93.6 Eevee constructs both saved `.blend` scenes and renders every camera. No model was called for these probes. Neither scene is a playable environment or part of the five-variant comparison.

## Results

| Probe | Matched or front view | Changed view | Finding |
| --- | --- | --- | --- |
| Generated tree on two crossed alpha cards | [front](renders/foliage_front.png) | [side, about 75°](renders/foliage_side_75deg.png) | Generated colour and foliage detail survive at a distance, but the cards reveal their crossing, flat trunk, cutout residue and lack of volumetric crown under head motion. The [simple geometry proxy](renders/foliage_side_75deg.png) retains volume but has much less authored detail. It is a depth control, not an equal art-quality comparison. |
| Player-height reference used as a scene panel | [matched](renders/view_matched.png) | [unfamiliar side](renders/view_unfamiliar_70deg.png), [closer](renders/view_close_left.png) | The single camera sees the intended composition. Off-axis movement exposes a thin rectangular panel and perspective compression; the apparent route and bridge cannot be traversed. This is a measured visual failure of the view-driven illusion, not evidence of a constructed world. |

The [left](renders/foliage_stereo_left.png) and [right](renders/foliage_stereo_right.png) foliage views simulate a 64 mm camera separation, aimed at the same target. They allow flat-image inspection only. Headset stereo comfort, tracking, frame time, and close viewing remain unverified. Transparent card edges, baked lighting and shadow from the generated art would need cleaner extraction and dedicated texture authoring before production use. Reserve cards for distant vegetation where movement and interaction are limited; retain geometry for nearby trees, collision, bridge and route.

## Rebuild

From the repository root:

```powershell
python experiments/visual-2d3d-20260928/probes/prepare_textures.py
& 'C:\Program Files\Blender Foundation\Blender 2.93\blender.exe' --background --factory-startup --python experiments/visual-2d3d-20260928/probes/build_blender.py
```

`prepare_textures.py` records crop coordinates and alpha coverage in `textures/extraction.json`. `build_blender.py` saves the source scenes, PNG renders and per-render wall times in `render_metrics.json`. The generated image source is held in `../references/`. The Blender scenes use Blender `+Z` up; the benchmark world uses Godot `+Y` up, so these probes are not imported as benchmark variants.

## Evidence and limits

The tree cutout is produced from the generated board with a deterministic beige-background RGB classifier. The cutout preserves generated colour pixels but has visible beige and shadow residue. It is not a clean foliage atlas. Two crossed cards use four triangles in total; the depth-control trunk and level-2 ico-sphere crown use about 332 triangles. This polygon comparison excludes transparency overdraw and says nothing about actual VR performance. The reference-panel probe has no geometric path, bridge, water or landmark; the entire scene image is a texture on one plane. The saved source and output make that limitation inspectable.

The first attempted GrabCut texture extraction selected only 0.19% opaque pixels, a failure evident in `textures/extraction.json` from the later method and the recorded timing note. The beige classifier yielded 64.8% nonzero alpha and retained more of the tree, while still leaking some background. A first Blender run failed because an empty factory scene had no world; `reset()` now creates one. These fixes are kept in the scripts so the failed strategies do not need to be repeated.

`render_metrics.json` measures Blender render calls at 800 × 600 with Eevee 32 samples. The final generation pass took about 1.0 s inside Blender plus process startup; the first render incurs shader setup and subsequent renders benefit from warm caches. These times are desktop headless measurements, not headset frame rates. Failed and repeated command timings are in `timings.csv`.
