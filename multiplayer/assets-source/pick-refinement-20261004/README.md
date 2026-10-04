# Stonewhisper pick refinement (2026-10-04)

Round 2 of the pick polish. Rebuilds the pick's metal, wood, leather and brass from surface functions so no
decoration clips, and paints new tiling textures. Gems, node names, transforms, sockets and bounds are kept,
so `asset-pose`, `held-sway`, `pick-wall-motion` and `pick-luminance` all work unchanged.

## Rebuild

```
pip install numpy pillow
python paint_textures.py <texDir>
node build-pick.mjs pick-input-20261003.glb <texDir> ../../public/assets/pick.glb > build-report.json
```

Run from `multiplayer/` or here; `build-pick.mjs` imports three from `multiplayer/node_modules`. Output is
byte-identical for identical inputs. The builder asserts the pick contract bounds (min -.32,-.045,-.0428 /
max .32,.718,.0428).

## What changed

- PickHead: smooth swept arms (was a 200-triangle faceted mesh); the 4 crown side gems now sit on the arm cheeks.
- All brass is generated as an offset of the arm, socket or haft surface: arm bands follow the arm tangent, socket
  collar, petals, throat, heart-gem bezels, strap plates, ferrules and spiral wire no longer intersect each other.
- Textures: blued steel (hammer pitting), ash wood (two-frequency rings), wrapped leather (stitches), patinated brass.

## Budget

29,194 triangles, 1.53 MB (textures about 850 KB). The previous pick was about 6k triangles and 292 KB.
