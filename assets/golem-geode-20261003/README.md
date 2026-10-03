# Geode golem (v2, 2026-10-03)

Source for `multiplayer/public/assets/golem.glb`. Replaces the quarry golem in `../golem-sonnet-20261001/`
(whose `ART-CONTRACT.md` still describes the pivots, node names and rotation signs, all unchanged).

Build (about 5 s, no Blender install needed):

```sh
pip install bpy==4.5.*        # or run inside Blender 4.5: blender --background --python build_golem.py
python3 build_golem.py        # writes golem.glb, golem_source.blend, textures/, build_report.json here
cp golem.glb ../../multiplayer/public/assets/golem.glb
```

What changed from v1
- Look: the world's own stone, rounder boulder masses, bound by blue resonance light. A geode heart sits behind two
  chest slabs (light shows through the seam), crystal spires break out of the back, pauldrons and brow, and joints
  (elbows, knees, belly cracks, mouth) leak light. The amber sun core, copper bands, gold studs, belt and harness are gone.
- Iron is the forged armour: bracers and knuckle plates (`ForearmL/R`), which is what a slain golem drops.
- Materials: three shared (`Stone`, `Iron`, `Crystal`) instead of nine. Stone tones (main, dark, pale, moss) are a
  `COLOR_0` multiply on one stone texture set, so most parts draw in one or two calls.
- Size: 2.26 MB (JPEG textures) instead of 17.1 MB; 16.4k triangles instead of 20.0k.
- `Crystal` is the emissive material. The game tints its emissive blue on load and clones it per golem to drive the
  breath, telegraph flare, hit stutter and death fade (`multiplayer/client/golem-presentation.js`).
- Clips `Idle`/`Walk`/`Slam` are still exported for tools, but the browser game poses golems procedurally
  (`multiplayer/client/enemy-motion.js`), so the walk is stride-locked to real movement.

Review pages (run `npm run dev` in `multiplayer/`): `tests/golem-studio.html` (model turntable, `?dusk`, `?armor=0`),
`tests/golem-motion-studio.html` (animation timeline, `?play`), `tests/golem-review.html` (real game renderer, `?weak`).
