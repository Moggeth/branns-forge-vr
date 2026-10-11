# Skyfire dragon, redesign (2026-10-09)

The streak dragon redesigned around big, realistic wings and big gusty flaps. It is a lean, powerful red dragon with
a deep chest, a long raised neck and a long tail. It keeps the friendly face of the level 2 dragon: huge amber eyes
with blinking lids, cream horns and a golden belly. Its wings span about 2.3 times its length (31 units, 23 m in game).
Each wing has a long arm and long finger bones, and broad cambered membranes with scalloped trailing edges. The thin
skin glows warm when lit from behind, and the veins stay darker. A small saddle sits at the base of the neck:
a blue blanket with gold trim, a leather seat, swinging stirrups and a swallowtail pennant. The level 1
stacked-primitive dragon survives as the stand-in `client/dragon-art.js` shows until the GLB has loaded, scaled to
the new size.

Signature features:

1. **Ember belly.** The golden belly plates from chest to throat are their own material. They smoulder at rest. While
   the dragon breathes fire they light up hot orange, in a wave that climbs the throat into the open jaw.
2. **Golden crest and flame tail.** A row of glowing golden spines runs down the back to a flickering flame tail tip.
3. **Backlit wings.** The membranes billow on the downstroke and glow translucent against the sky.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy
python3.11 build_skyfire_dragon.py -- --out ../../public/assets/skyfire-dragon.glb
python3.11 build_skyfire_dragon.py -- --out out/skyfire-dragon.glb --render out/review   # turnaround + poses (Cycles)
```

- The last line printed is `SKYFIRE_BUILD_OK`. Blender can exit 0 after a traceback, so check for that line.
- The build is deterministic: rebuilding gives a byte-identical GLB.
- Do not run it from a folder that holds a file named `inspect.py`.
- `out/build_report.json` records triangles, vertices, materials, bones and bytes.

## Budget

| Item | Value |
| --- | --- |
| Triangles | 11,530 |
| Meshes | 1 skinned mesh (three primitives) |
| Materials | 3: `SkyfireHide`, `SkyfireWing`, `SkyfireEmber` |
| Bones | 39 |
| Textures | one 256 px scale tile |
| Vertex colours | yes, with baked ambient occlusion |
| Lights | none |
| GLB size | about 396 KB |

The GLB is repacked with `KHR_mesh_quantization`: byte normals, colours and weights, and 16-bit masks. three.js
supports this natively.

## Runtime contract (client/dragon-art.js)

### Frame and scale

- +Z is forward and +Y is up. The origin is the centre of the body.
- Model units become metres through `DRAGON_SCALE` (0.75). The span is 31 units (23 m) and nose to tail is
  13.7 units (10.3 m).
- Every number in the builder uses this frame and matches the runtime constants.

### Bones

| Chain | Bones |
| --- | --- |
| Head | `Body` (root) > `Chest` > `Neck1..3` > `Head` > `Jaw`, `Horns`, `BrowL/R`, `LidUL/R`, `LidLL/R` |
| Tail | `Body` > `Hips` > `Tail1..6` |
| Wings | `Chest` > `WingArmL/R` > `WingForeL/R` > `WingF1..3L/R` |
| Legs | `LegFL/R` (on `Chest`), `LegHL/R` (on `Hips`) |
| Saddle | `StirrupL/R` and `Flag1` > `Flag2` (on `Chest`) |

- The runtime turns bones by angles about the dragon's own axes: x is pitch (nose down), y is yaw and z is roll (left
  side up). The angles are conjugated with each bone's rest orientation, so bone rolls in the GLB do not matter.
- Each lid turns about its eye's hinge axis, `d × u` from `eye_frame` in the builder (`EYE_K` in the runtime). The
  bind pose is half closed.
- A positive `Jaw` pitch opens the mouth.
- Scaling `Horns`, `BrowL` and `BrowR` to about 0 hides what would sit under the rider's camera.

### Materials and `TEXCOORD_1` masks

Mask y values are stored as `(y + 1) / 2.5`.

| Material | `TEXCOORD_1.x` | `TEXCOORD_1.y` |
| --- | --- | --- |
| `SkyfireHide` | multiplies the scale tile | unused |
| `SkyfireEmber` | glow | position along the throat (0 chest, 1 jaw, 1.25 mouth, -1 tail flame) |
| `SkyfireWing` | billow weight (0 on the bones, 1 mid-membrane) | thinness (how much light shows through) |

The runtime patches these into the shaders once, at load:

- All materials get a warm fresnel rim.
- The ember material gets the breath wave.
- The wing material gets the billow (a push along the normal before skinning) and translucency when lit from behind.

The ember and wing materials are cloned per dragon, because their uniforms are per dragon. The rider's see-through
wing shares those uniforms.

### `animateDragon(root, t, opts)`

- Options: `breath`, `dive`, `beat`, `amp`, `arrive`, `leave`, `roar`, `turn` (yaw rate, -0.9..0.9 rad/s, positive is
  to its left) and `bank` (roll in radians; when left out, it is read from the root).
- It returns the downstroke power of this frame, from 0 to 1, for gusts.

### Flight

- **Strokes:** about 0.85 Hz while cruising. The downstroke is fast and cups the air. On the upstroke the wrist bends
  and the fingers sweep back.
- **Glides:** cruising alternates long glides with bursts of beats. Climbing (`arrive` < 1, `leave` > 0), turning and
  roaring keep it beating, with deeper strokes.
- **Turns:** the outer wing beats up to 45% harder. The head follows a bank late, through two lags.
- **Smoothness:** the stroke phase and the lags integrate from successive `t` values, so changing `beat` never makes the
  wings jump. Blinks are closed-form in `t`.

### `setRiderView(root, mode)`

- `mode` is `'saddle'`, `'chase'` or `false`, and `true` means `'saddle'`.
- `'saddle'` makes the wings see-through and hides the horns and brows.
- `'chase'` raises the ember glow a little so the dragon reads from behind.

### `DRAGON_SEAT` [0, 3.4, 1.65]

- The seat sits just behind the saddle's pommel, at about eye height for a seated rider.
- It is fixed to the dragon's body frame, not to the neck bone, so neck and head motion never shakes the camera.
- The wings are behind the seat. A rider sees them only when looking to the side. Looking forward, the rider sees
  over the neck.

### `DRAGON_MOUTH` [0, 0.58, 5.8]

- This is the middle of the open jaw in the breathing pose: 0.44 m up and 4.35 m ahead of the origin in game units.
- It was measured on the skinned mesh in `tests/dragon-lab.html`. The snout tip is at about (0, 0.87, 5.92) and the
  jaw tip at (0, 0.27, 5.5).
- Breathing steadies the neck, so the mouth stays within about 0.1 unit of this point through the wingbeat.
