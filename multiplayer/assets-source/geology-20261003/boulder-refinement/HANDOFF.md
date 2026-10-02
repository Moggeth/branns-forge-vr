# Boulder silhouette follow-up — HANDOFF (2026-10-02 UTC)

Scope: this replaces only the ordinary mineable **boulder** (`authored('boulder', 1.2)` in `reference/world-content-view.js`). I did not build, export or touch the meteor, boulder_b/c, LODs, worked stages, ores or chips. `reference/meteor.glb` is read-only, and its SHA-256 is still `974C25F5…C41A5EAD`. No runtime, gameplay, UI, coordinate or collider code was changed. Nothing has been validated in-game. The renders below are offline Blender Cycles images only.

## What was wrong / what changed
`reference/actual-ground.png`: the boulder had concentric horizontal strata terraces (`strata freq 4, amp 0.12`, near-vertical axis) on a near-ellipsoid. That stacks evenly spaced radial ledges, so it read as round pancakes.

v2 (`DEPOSITS['boulder']` in `build_boulder.py`):
- **Bold fracture:** six explicit planar fracture cuts plus two seeded ones (the old version had five seeded ones). This gives large flat broken faces and a sharp slanted top facet.
- **Asymmetry:** low-frequency lobes (`chunk=0.16`) and a base-anchored shear lean (`lean=(0.16, 0.05)`). The shear has det = 1, so the base stays flat at y=0 around the origin and the winding is preserved.
- **Limited weathered strata:** tilted axis `(0.45,1,0.3)`, freq 2.6, amp 0.05. `sparse=0.45` drops the weaker bands, leaving only a few irregular ledges.
- **One readable ore seam:** a single diagonal recessed vein (`n=(0.7,0.7,0.06)`, width 0.13, depth 0.065, wobble 0.07) in the existing `GeoInterior` material. Its vertex colour is warm iron/bronze `(1.0,0.70,0.36)·k`, and the stone either side of the vein is rust-darkened. Where the vein crosses the pick-worked face it shows through.
- **Material presentation:** the stone strata texture is now tilted and more warped, with sparser hairline cracks. The top-face special-case UV that produced wood-grain smears on slanted facets has been removed.
- The pick-worked front face (`GeoInterior`, blue-grey interior) is kept at the same normal `(0.2,0.35,-1)`, plane 0.80 (was 0.78).

## Files (all in this folder)
- `boulder.glb`: the deliverable (a copy of `out/glb/boulder.glb`).
- `build_boulder.py`: a standalone deterministic builder, forked from `reference/build_geology.py`. It builds only the boulder, adds a mesh validator and makes the before/after renders.
- `out/source_boulder.blend`: editable source with packed textures. `out/textures/geo_albedo.png` (1024) and `geo_normal.png` (512) are its texture atlases. Only the stone quadrant changed versus the kit, and these textures are embedded in the GLB.
- `out/boulder_contract.json`: stats, bounds, validation and timings.
- `out/gltf_validator_report.json`, plus `validate_gltf.cjs` (a copy of the reference script).
- Renders: `out/before_after_sheet.png`, which stacks ground-eye front, elevated and ground-eye back. The individual frames are `out/renders/pair_ground.png`, `pair_elevated.png` and `pair_ground_back.png`. The front views look along +Z, so screen-left is +X: **AFTER (v2) is on the left and BEFORE (shipped reference) is on the right** in rows 1–2. In the back view (row 3) BEFORE is on the left and AFTER on the right. Both are at native GLB scale, 1.3 m either side of the origin.
- `out_repeat/`: a determinism rebuild (`--no-render`).

## Contract preserved
| | BEFORE (reference/boulder.glb) | AFTER (v2) |
|---|---|---|
| Nodes | Boulder › BoulderMesh, Grip, ResourcePivot | identical names/hierarchy |
| Triangles | 5120 (GeoRock 4824 + GeoInterior 296) | 5120 |
| Materials / draws | 2 (GeoRock, GeoInterior) | 2 (GeoRock, GeoInterior) |
| Images | 2 embedded JPEG | 2 embedded JPEG |
| Bytes | 825,860 | 663,896 |
| bbox min (m) | (-0.9553, 0, -0.7748) | (-0.8561, 0, -0.7886) |
| bbox max (m) | (0.9469, 1.1208, 0.7739) | (0.9360, 1.1640, 0.7646) |

The origin is still bottom centre on y=0, with +Y up and −Z front. Grip and ResourcePivot are at 0.45 and 0.5 of the height, as before. Runtime normalises height to 1.2 m. The scale factor is now 1.031 (it was 1.071), so the runtime footprint is about 1.85 × 1.60 m against 2.04 × 1.66 m before: roughly 9 % narrower in X and 4 % shallower in Z. That is still a full-size outer profile for reach and placement, but root should confirm with real pick strikes.

## Validation (measured)
- Mesh validator (`validate_mesh` in the builder, run on the exported mesh): 0 non-manifold edges, 0 degenerate faces, 1 connected shell, signed volume +1.4822 m³ (closed and outward), outward-face fraction 1.0 relative to the shell centroid. **passed=True**. Because it is one closed opaque single-sided shell, a surface ray can only hit visible rock. In-game raycasts have not been run.
- Khronos glTF-Validator: `boulder.glb` errors 0, warnings 0.
- Determinism: two independent builds gave a byte-identical GLB, SHA-256 `756086222C5B74D05AEEF61B51FFB6F4AAC7CE84F99502E6A5A81155951833A7`.

## Commands
```
set BL=C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe
%BL% --background --factory-startup --python-exit-code 2 --python build_boulder.py -- --out <ABS>/out --samples 16 --threads 2   [--before <ABS>/reference/boulder.glb]
%BL% --background --factory-startup --python-exit-code 2 --python build_boulder.py -- --out <ABS>/out_repeat --no-render
node validate_gltf.cjs <ABS>/out
```
Install: copy `boulder.glb` over the runtime boulder asset. The material names are unchanged.

## Timings (wall clock, CPU 2 threads, 16 samples + denoise)
- Iteration 1 build+render: 32.1 s. Iteration 2: 27.9 s. Iteration 3 (final): 27.7 s. Each 960×440 render took 8.4–9.0 s.
- `--no-render` rebuild: 1.5 s. Textures: 0.67 s.

## Iterations (rendered and inspected)
1. Fractured silhouette worked, but slanted tops showed wood-grain UV smears and the seam was hidden.
2. Removed the top-face special UV and turned the seam to cross the front/top. The vein became visible but broken into fragments.
3. Reduced the seam wobble and widened it, and made the hairline cracks sparser. The vein now reads as one continuous bronze diagonal in the elevated view.

## Known limitations
- This is not validated in Godot/three/VR. No in-game pick strikes, collider fit or headset comfort checks were done; root owns those.
- `boulder_b`, `boulder_c`, `boulder_lod` and `boulder_worked1/2` from the original kit were **not** regenerated (the brief said no more variants). If the runtime swaps to `boulder_worked*` on strikes, those stages will still show the old pancake shape. Root can extend `ASSETS` stages in `build_boulder.py` (set stages to 2) if wanted.
- The ore seam reuses `GeoInterior` with a vertex tint, so it is metallic bronze rather than emissive. It is clearly readable in the elevated view but shorter in the ground-front view.
- Height grew from 1.121 to 1.164 m. Runtime re-normalisation to 1.2 m makes the footprint slightly smaller than before (see table).
