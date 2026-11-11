# Sunfall Sledge, reforged 2026-11-11

`build_sunfall.py` builds `public/assets/hammer.glb` from code in Blender (bpy 5.2 or 4.5 as a Python module:
`pip install bpy`). The docstring holds the story, the frame and the runtime contract (mesh, material and empty names
that `sunfall-sledge.js`, `weapon-readiness.js` and `asset-pose.js` rely on). It reuses the Stonewhisper textures.

```
python ../pick-refinement-20261004/paint_textures.py textures   # shared hero-kit textures (ignored, regenerate)
python build_sunfall.py -- --out ../../public/assets/hammer.glb
python build_sunfall.py -- --out out/hammer.glb --render out/review --samples 40 --views hero,head,crown,cheek,grip
```

The build fails over 24k triangles (it is ~15.9k). `out/` (renders, scratch exports) is ignored.

Runtime review page: `tests/sunfall-review.html` (`?night`, `?phone` for no light). From the console:
`review.held({charge: .3, view: 'cheek'})`, `review.slam([.05, .3, 1.2])`.
