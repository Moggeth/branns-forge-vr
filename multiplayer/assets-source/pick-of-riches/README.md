# Pick of Riches (Stonewhisper), reforged 2026-11-10

`build_pick_of_riches.py` builds `public/assets/pick.glb` from code in Blender 4.5 (`pip install "bpy==4.5.*"` for
python3.11). The docstring at the top holds the story, the frame and the runtime contract (mesh, material and empty
names that `pick-luminance.js`, `weapon-readiness.js`, `pick-riches.js` and `asset-pose.js` rely on).

```
python3.11 ../pick-refinement-20261004/paint_textures.py textures   # shared Stonewhisper textures (ignored, regenerate)
python3.11 build_pick_of_riches.py -- --out ../../public/assets/pick.glb
python3.11 build_pick_of_riches.py -- --render out/review --samples 64 --views hero,head,heart
```

The build fails if the pick goes over 36k triangles. `out/` (renders, scratch exports) is ignored.

In-game review page: `tests/pick-of-riches-review.html?target=ore&tool=pick&clean&dist=1.7&tick=18720`
(`tick=54720` for night, `weather=rain|storm|snow|fog`). Runtime look: `client/pick-luminance.js` (gem refraction,
temper colours, gold seam), `client/pick-riches.js` (light, seam pulse, sparks, glints, dowsing, heartbeat, tag, admire idle).
