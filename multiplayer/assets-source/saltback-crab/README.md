# Saltback, the salt-mine hermit crab (2026-10-16)

A hermit crab from the brine pools of a pink rock-salt mine. It wears a cluster of halite crystals for a shell.
The style is optimistic and goofy-charming, not spooky. The character comes from proportion and silhouette.

Signature features:

1. **Salt-lamp shell.** A chunky cluster of 19 chamfered halite cubes in milky white, pale pink, rose and a few
   deeper rose. Three of them are stepped "hopper" cubes with recessed square terraces. The faces are flat-shaded
   and crisp. A glow mask (vertex colour alpha) lets the runtime light the shell from within like a Himalayan salt
   lamp.
2. **Lopsided claws.** An oversized crusher claw on the right (-X) with blunt cream teeth, and a small nimble picker
   on the left (+X).
3. **Googly stalk eyes.** Tall stalks, big glossy black pupils with two catch-lights, a little off-axis so they look
   slightly surprised. There is also a small dark smile.
4. **Coral body.** A squat, rounded coral-orange carapace with soft cream speckles and a peach belly. Six chunky
   orange legs with knee knobs and cream tips.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy pillow
python3.11 build_saltback_crab.py -- --out ../../public/assets/saltback-crab.glb
python3.11 build_saltback_crab.py -- --out out/saltback-crab.glb --render out/review   # Cycles review set
```

`--only front,face,strips,...` renders a subset and `--samples N` sets quality. The review set has these views:

- front, three-quarter, side, back, top, face and phone-10m (24 mm lens from 10 m)
- glow-three-quarter and glow-back, a dark mine with the shell glowing
- clip-<name>.png, a six-pose strip for each clip

The last line printed is `SALTBACK_BUILD_OK`. Blender can exit 0 after a traceback, so check for it. Do not run
the builder from a folder that holds a file named `inspect.py`.

`out/build_report.json` records triangles by part, vertices, rest bounds, per-clip lowest point, bytes, and a
re-parse of the written GLB. That re-parse covers joints, materials, triangle count, clip durations, the colour
and alpha statistics of each primitive, and the cross-check error between the exact clip samples and Blender's
own export.

## Budget

8,838 triangles in one skinned mesh. It has three primitives (`CrabShell`, `CrabBody`, `CrabEye`), 23 bones and
no textures. The file is about 340 KB, repacked with `KHR_mesh_quantization`: byte normals, RGBA byte colours,
byte weights and joints, and 16-bit rotation keys. Channels that never leave rest are dropped.

## Runtime contract

- **Frame.** +Z forward (eyes and claws), +Y up, +X is the crab's left. Units are metres. The origin is on the
  ground under the body centre. At rest it spans x -0.37..0.37, y 0..0.575 and z -0.40..0.51 (the crusher's tips).
- **Materials.** `CrabShell` (the crystals), `CrabBody` (carapace, legs, claws, stalks, smile) and `CrabEye`
  (eyeballs and catch-lights). Every base colour factor is white, so use the vertex colours.
- **COLOR_0** is RGBA, unsigned byte normalized:
  - rgb is the authored colour (linear) with baked ambient occlusion.
  - alpha on `CrabShell` is the glow mask. It is 1 at crystal face cores and the deepest hopper terraces, about
    0.5-0.9 on the inner rings (higher on faces turned toward the cluster's heart) and 0 at edges and chamfers.
  - alpha is 1.0 on `CrabBody` and `CrabEye`.
  - The glow is meant as emissive, e.g. `emissive += glowColour * vColor.a * strength` on CrabShell only. Keep the
    materials opaque: three forces alpha to 1 for opaque materials, so the mask never makes anything see-through.
  - There are no texture coordinates.
- **Bones.**
  - `Root` (origin) > `Body` (0, 0.165, 0) > `Shell`
  - `Body` > `EyeL`, `EyeR` (the stalk bases)
  - `Body` > `ClawL1` > `ClawL2` > `PincerL`, and the same for R (1 = arm, 2 = hand with the fixed finger,
    Pincer = the movable finger)
  - `Body` > `LegL1A` > `LegL1B` … `LegR3A` > `LegR3B` (1 = front, A = hip, B = knee-to-tip)

  Every joint's rest rotation is the identity. So a runtime rotation set on `EyeL`/`EyeR` (for example
  `quaternion.setFromEuler(pitch, yaw, 0)`) turns that stalk about the crab's own axes at the stalk base. Apply it
  after the mixer update, or premultiply it onto the clip value.
- **Clips** (30 fps samples, linear):

  | Clip | Length | Type | What happens |
  |---|---|---|---|
  | `Idle` | 2.0 s | loop | Bob, independent stalk swivels, small claw fidget; the big claw clacks shut at 1.30 s |
  | `Scuttle` | 0.6 s | loop | Alternating-tripod sideways gait (L1, R2, L3 against R1, L2, R3) |
  | `Pinch` | 0.7 s | one-shot | Rears back, lunges; the crusher snaps shut at **0.35 s**, the hit frame (keyed exactly) |
  | `Hurt` | 0.35 s | one-shot | Flinches back; the stalks squash down |
  | `Death` | 1.2 s | one-shot | Rolls onto its back over its right side, legs curl in, eyes droop; clamp the end pose |
  | `Emerge` | 1.2 s | one-shot | Root starts 0.45 m underground and rises; shakes off; eyes pop up last (0.9-1.2 s) |

  - **Scuttle.** The planted feet sweep toward -X at 0.4 m/s, which matches travel along **+X** at timeScale 1.
    Use timeScale = speed / 0.4, and a negative timeScale for travel along -X.
  - **Root.** Only Emerge (vertical rise) and Death (roll, a lift of about 0.53 m onto the shell, and a slide of up to 0.3 m toward -X, ending at -0.25 m, that keeps
    its contact from skidding) key the Root. All other clips leave Root untouched; body motion lives on `Body`.
  - **Feet.** The clips solve the feet with IK, so planted feet stay on the ground while the body moves. No clip
    except Emerge dips below the ground.
