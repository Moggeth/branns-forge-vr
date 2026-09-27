# Image-led Orchard Brook planner

`input/generated-map-source.png` is the actual 1254 × 1254 image-generation output. `plan.py extract` resizes its entire frame to the contract's registered 512 × 512 grid using Lanczos, classifies the palette, identifies route, bridge, stream, terrain, trees and ruin pieces, and saves `artifacts/B/world_spec.json`. Its `source_map.png` is the registered working image; `plan_preview.png` is deliberately rendered **from the JSON** to expose extraction differences. The nine semantic masks plus `mask_height.png` and `mask_density.png` share the exact pixel-to-world mapping in `CONTRACT.md`. The original is retained unchanged.

From the repository root:

```powershell
python experiments/visual-2d3d-20260928/planning/plan.py extract experiments/visual-2d3d-20260928/planning/input/generated-map-source.png experiments/visual-2d3d-20260928/planning/artifacts/B --model openai-imagegen
python experiments/visual-2d3d-20260928/planning/plan.py validate experiments/visual-2d3d-20260928/planning/artifacts/B/world_spec.json
python -m unittest discover -s experiments/visual-2d3d-20260928/planning -p test_plan.py -v
```

Requires Python, Pillow and NumPy. The extractor is deterministic and makes no API calls. The v1 object coordinate key is `position_xyz`; `center_xz` is used for hills and the crossing. The Godot builder can use the world spec directly and use the masks for diagnostics. No manual re-reading of the image is needed for rebuilds. `preview <spec> <png>` regenerates a structure-led view after edits to a saved spec.

The generated source required three specific corrections during extraction. Its 1254-pixel canvas needed full-frame registration to 512 pixels. The painted bridge split the visible blue stream into two large components, so the stream tracer joins substantial arms before finding its centreline. The warm hill patches share the dirt palette; their compact shapes are classified as hills while the long dirt components are classified as route halves. These operations use only image pixels and are recorded as algorithmic interpretation, not hand-authored scene layout. The output currently yields four hills, 113 trees/ruin objects, and a connected 32-vertex path. The preview preserves the major composition, though tiny trees and hill silhouettes are simplified. Source colours are close enough to the contract palette that no hand-edited mask was needed.

Limitations: the source has no independently drawn height or density layer; both are deterministic estimates derived from earth patches and tree canopy occupancy. Hill heights and object scale are heuristic, so terrain grade and scene appearance require inspection after 3D construction. A height mask cannot encode the bridge underside; `crossing` is a separate structure. The validator checks route topology, a single water crossing, bridge reach, width, bounds and modelled grade, but it cannot verify in-headset clearance or collision geometry.

Logs and failures: extraction writes `extraction_report.json` and warnings inside `world_spec.json`. `timing.csv` records measured local steps. If validation fails, inspect `plan_preview.png`, `mask_path.png`, `mask_water.png` and marker masks. The initial strict 512-pixel-only parser rejected the generated 1254-pixel source; the verified recovery is the deterministic full-frame resize. The initial largest-water-component strategy lost one bank-to-bank stream arm at the painted bridge; the verified recovery joins both substantial components.

Godot integration caught a further orientation error: the first extractor encoded bridge yaw relative to X while the builder's local-Z deck uses `yaw_rad=0` for a north/south bridge. The source preview had used the same wrong convention and hid it. The extractor and preview now use Godot's `(sin(yaw), cos(yaw))` bridge axis, and validation checks the nearest route segment's alignment. `artifacts/b_smoke/` is the rendered Godot smoke build from the corrected spec. Its `metrics.json` reports no errors, 0.911 bridge-route alignment, 0.096 m bridge path offset and a successful bridge collision raycast. The overhead render confirms the deck follows the source path across the stream.

The new alignment test first failed because its synthetic stream was vertical while its crossing stroke and route implied a different orientation. The fixture now draws a horizontal stream and bridge following the diagonal route, matching the constraint it tests. A separate 90-degree bridge mutation must fail validation.
