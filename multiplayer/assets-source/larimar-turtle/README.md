# Shellbright, the larimar turtle (2026-10-10)

A sea turtle brought to life from a sterling-silver pendant: a pale sky-blue, pear-shaped larimar cabochon for the
shell (point at the tail) set in a notched silver crown bezel, with pebbled, hammered silver scales on the flippers
and head. It lives in Larimar Cove, the lake beside each keep's back town (`shared/larimar-cove.js`), and is drawn by
`client/larimar-turtle-art.js` and animated by `client/larimar-turtle-motion.js` through `client/larimar-cove-view.js`.

Signature features:

1. **Larimar shell.** A procedural larimar texture (cloudy blues, white veins, a glow mask) on a glassy dome. The
   runtime adds a second, deeper sample along the view ray so the clouds sit inside the stone, a cool rim, and at
   night the veins glow from within (emissive only; the water shows a matching glow pool, no lights).
2. **Crown bezel.** 34 square notches round a polished silver band, the setting of the pendant's stone.
3. **Hammered silver.** A 512 px tile of puffy pebbled scales (normal map + shade) masked to the flippers, head and
   neck through `TEXCOORD_1.x`; `TEXCOORD_1.y` turns the bezel and beak into bright polished silver.
4. **A face with character.** Almond lids over glossy dark eyes (blinks, sleepy basking), an overbite beak with a
   separate jaw for breaths and yawns.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy pillow
python3.11 build_larimar_turtle.py -- --out ../../public/assets/larimar-turtle.glb
python3.11 build_larimar_turtle.py -- --out out/larimar-turtle.glb --render out/review   # turnaround + rig poses (Cycles)
```

The last line printed is `TURTLE_BUILD_OK`. `out/build_report.json` records triangles, vertices, materials, bones and
bytes. Do not run it from a folder holding a file named `inspect.py`.

## Budget

17,408 triangles, one skinned mesh (three primitives: `TurtleShell`, `TurtleSkin`, `TurtleEye`), 19 bones, a 1024 px
larimar map, a 512 px scale tile and its normal map (JPEG), vertex colours with baked ambient occlusion, about 712 KB.
Repacked with `KHR_mesh_quantization`. The cove draws only within 62 m of the camera, so at most one turtle is ever
skinned and drawn at a time in practice.

## Runtime contract

- Frame: +Z forward, +Y up, origin at the body's centre, 0.9 m nose to tail before `TURTLE.scale` (1.25).
- Bones: `Body` > `Neck` > `Head` > `Jaw`, `EyeL/R`, `LidL/R`; `Body` > `FinF1..3L/R` (front flippers, shoulder to
  tip), `FinB1..2L/R`, `Tail`. Poses are delta angles about the turtle's own axes (x pitch, y yaw, z roll), applied
  conjugated with each bone's rest orientation; the right side mirrors by flipping y and z. Lids roll about the
  eye's look direction crossed with up.
