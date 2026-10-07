# Stormspire lizard crew: the Voltnewt, level 2 (2026-10-07)

Mitch: "Please make sure the lizards get a graphical and animation uplift - they're so cute and I love them", with the
concept sheet "03 · VOLTNEWT" as the target. A chunky teal newt about 0.6 m nose to tail curl (shown at 1.2x in game):
darker teal spots, a cream belly, throat and jaw, orange spikes down the back and a thick tail that curls up into a
hook. Big amber eyes high on a broad head and a wide toothy grin. Work gear: a yellow hard hat with a blue bolt, a yellow
chest harness with brown straps, steel buckles and a white medic badge on each flank, a brass and steel socket on the
upper back with a red power cable, and black boots with rounded claws. Glowing blue veins run under the skin.

Signature features:

1. **The grin and the eyes.** A hinged jaw with cream cone teeth and a pink mouth, and big glossy eyes with real
   eyelids (blinks, the squinting charged-up face, naps).
2. **Live wiring.** Flickering blue veins that flare while charging up or biting, and a cable from the back socket that
   the runtime runs to wherever the newt is plugged in (the coil, the plinth, the brim).

## Rebuild

```
python3.11 -m pip install bpy numpy          # built with bpy 5.0.1; 4.5 also works
python3.11 build_stormspire_lizard.py -- --out ../../public/assets/stormspire-lizard.glb
```

The last line printed is `LIZARD_BUILD_OK`; Blender can exit 0 after a traceback, so check for it. `out/build_report.json`
records triangles (by part), vertices, bones, clip channels and bytes. Review in `tests/lizard-lab.html` (Vite dev
server): `lab.view('show-front')`, `lab.show('cheer')`, `lab.frame(20)`, tower views `front`, `hopper`, `brim` and
`climber`, and `lab.size(390, 844)` for a phone.

## Budget

3,575 triangles in the one skinned mesh, of which about 3,420 are visible at once (the wrench, 84, shows only while
tinkering; the two z's, 72, only while napping). 37 bones, one material, one 256 x 144 atlas, vertex colours for the
baked ambient occlusion, no lights, about 310 KB. The runtime cable adds 144 triangles and one draw per newt. The
GLB is repacked with `KHR_mesh_quantization` (byte normals, colours and weights) and 16-bit rotation keys, and
animation channels that never leave the rest pose are dropped.

## Runtime contract (client/stormspire-lizards.js)

- Frame: -Z forward, +Y up, X the newt's right, origin on the ground under the belly, metres.
- Atlas: four 4 px palette rows at the bottom (Blender v), one per look (0 teal, 1 jade, 2 lagoon, 3 spare). u 0..96
  px is a skin ramp, then 6 px solid slots in the order of `SLOTS` in the builder (the runtime keeps the same list for
  its emissive bands). Rows 16..143, u 0..128 hold a tileable vein tile; `TEXCOORD_1` maps skin onto it and is -500
  where there are no veins. The runtime offsets `map` by -4 px per look and samples the tile in the shader.
- Bones: `Root` > `Hips` > `Spine` > `Head` > `Jaw`, `EyeL/R`, `LidL/R`, `CheekL/R`, `HatHard`; `Hips` > `Belly`,
  `Tail1..6`; `Spine` > `ArmUL/R` > `ArmLL/R` > `HandL/R` > `Wrench` (right); `Hips` > `LegUL/R` > `LegLL/R` > `FootL/R`;
  `Spine` > `Cable1` > `Cable2` > `CableTip`; `Root` > `Z1`, `Z2`. Lids shut by turning -1.75 rad about the newt's X;
  a positive pitch of `Jaw` in the clip specs opens the mouth (the builder's `jaw_open`).
- Clips: `idle` (6 s: breathing, looks round, grins, toe tap), `climb` (0.6 s trot, about 0.1 m per loop; the runtime
  sets its time scale from the climbing speed), `cheer` (1.6 s, once: charge up with eyes shut and cheeks puffed, then
  a hop with arms up and a grin), `nap` (4 s: belly down, hat over the eyes, snore, z's), `tinker` (2 s: two wrench
  taps), `bite` (1.8 s: rear back, lunge, chomp and a fizzing shake).
