# Skyfire dragon, level 2 (2026-10-06)

The streak dragon rebuilt to the level 2 bar of `docs/VISUAL-FIDELITY-LEVELS.md`: a chubby-but-powerful red dragon
with a deep chest, tapered neck and tail, a big friendly head with huge amber eyes, cream horns, a golden belly and
orange bat wings with crisp finger bones and scalloped trailing edges. It replaces the stacked-primitive level 1 dragon
(that one survives, much smaller, as the stand-in `client/dragon-art.js` shows until the GLB has loaded).

Signature features:

1. **Ember belly.** The golden belly plates from chest to throat are their own material. They smoulder at rest and,
   while the dragon breathes fire, light up hot orange in a wave that climbs the throat into the open jaw.
2. **Golden crest and flame tail.** A row of golden spines runs from the head down the back to a glowing,
   flickering flame-shaped tail tip.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy
python3.11 build_skyfire_dragon.py -- --out ../../public/assets/skyfire-dragon.glb
python3.11 build_skyfire_dragon.py -- --out out/skyfire-dragon.glb --render out/review   # turnaround + poses (Cycles, ~1 min)
```

The last line printed is `SKYFIRE_BUILD_OK`; Blender can exit 0 after a traceback, so check for it. The build is
deterministic (byte-identical GLB on rebuild). Do not run it from a folder holding a file named `inspect.py`.
`out/build_report.json` records triangles, vertices, materials, bones and bytes.

## Budget

8,740 triangles, one skinned mesh (three primitives), 3 materials (`SkyfireHide`, `SkyfireWing`, `SkyfireEmber`),
31 bones, one 256 px scale tile, vertex colours with baked ambient occlusion, no lights, about 292 KB. The GLB is
repacked with `KHR_mesh_quantization` (byte normals, colours and weights, 16-bit masks; three.js supports it natively).

## Runtime contract (client/dragon-art.js)

- Frame: +Z forward, +Y up, origin at the centre of the body, metres before `DRAGON_SCALE` (1.15; wingspan 12.8 units
  = 14.7 m). All numbers in the builder are in this frame and match the runtime constants.
- Bones: `Body` (root) > `Chest` > `Neck1..3` > `Head` > `Jaw`, `Horns` (horns, cheek frills, head crest), `BrowL/R`;
  `Body` > `Hips` > `Tail1..6`; `Chest` > `WingArmL/R` > `WingForeL/R` > `WingF1..3L/R`; `LegFL/R` (Chest), `LegHL/R` (Hips).
  The runtime turns bones by angles about the dragon's own axes (x pitch nose-down, y yaw, z roll left side up),
  conjugated with each bone's rest orientation, so bone rolls in the GLB do not matter.
- `Jaw` positive pitch opens the mouth. Scaling `Horns`, `BrowL`, `BrowR` to ~0 hides what sits under the rider's camera.
- Materials: `SkyfireHide` multiplies the scale tile by `TEXCOORD_1.x`; `SkyfireEmber` glows by `TEXCOORD_1.x`, with
  `TEXCOORD_1.y` (stored as `(y + 1) / 2.5`) the position along the throat (0 chest, 1 jaw, 1.25 mouth, -1 tail flame).
  The runtime patches these into the shaders once at load, plus a warm fresnel rim; the ember material is cloned per
  dragon (its breath uniform), the wing material only for the rider's see-through copy.
- `DRAGON_SEAT` [0, 3.35, 2.15] sits above the base of the neck, ahead of the wings. It is fixed to the dragon's body
  frame, not the neck bone, so neck and head motion never shake the camera; the body bob (a few cm at the rider's
  amp 0.5) moves under it. The rider's own dragon carries its head a little lower so the aim point stays clear.
- `DRAGON_MOUTH` [0, 0.45, 4.85] is the middle of the open jaw in the breathing pose, measured on the skinned mesh in
  `tests/dragon-lab.html`. Breathing steadies the neck and holds the wings spread, so the mouth stays within a few cm
  of it; when not breathing, the head looks around freely.
