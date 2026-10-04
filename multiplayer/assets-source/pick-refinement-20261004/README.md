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

- PickHead and HeadSocket keep the authored crisp hexagon / octagon sections (Mitch prefers the faceted styling). They
  are swept smoothly along the arm with a narrow bevel on every ridge, and shaded with `autoSmooth(20)`, so the
  facets stay sharp while the curve is smooth.
- Gems keep their shapes but are rotated and moved rigidly to sit square in their settings: arm crystals stand on the
  ridge normal in a cup whose four claws touch the crystal's own flanks; the ridge gems become the glowing bed of each
  cup (the outermost is a cabochon in its own cup outboard of the tip band); cheek gems face out along the cheek
  normal inside their bezels; the heart gems face straight out, centred and narrowed to clear the oval bezel wire.
- All brass is generated as an offset of the arm, socket or haft surface: arm bands follow the arm tangent, socket
  collar, petals, throat, heart-gem bezels, strap plates, ferrules and spiral wire no longer intersect each other.
- Textures: blued steel (hammer pitting), ash wood (two-frequency rings), wrapped leather (stitches), patinated brass.

## Budget

27,066 triangles, 1.54 MB (textures about 850 KB). The previous pick was about 6k triangles and 292 KB.
