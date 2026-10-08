# Stormspire lizard crew: the Voltnewt, level 2 production pass (2026-10-07)

Mitch: "Please make sure the lizards get a graphical and animation uplift - they're so cute and I love them", with the
concept sheet "03 · VOLTNEWT" as the target, then a production pass (geometry, materials and textures, rigging and
animation, physics and interactions, lighting and VFX, performance). A chunky teal newt about 0.6 m nose to tail
(shown at 1.2x in game): darker teal spots, a cream belly, throat and jaw, rounded orange spikes down the back and a
thick tail that rises and curls over into a hook. Big amber eyes high on a broad head and a wide grin full of cream
cone teeth. Work gear: a yellow hard hat with a blue bolt, a stitched yellow leather chest plate with brown straps,
steel buckles and a rimmed medic badge on each flank, a brass and steel socket on the upper back with a red power
cable, and glossy black boots with rounded claws. Glowing blue veins run under the skin.

Signature features:

1. **The faces.** A hinged jaw with big, blunt cream cone teeth (seven above, five below), glossy painted eyes tucked
   under the hard-hat brim, and the sheet's squint: each upper lid is a hemisphere whose edge runs through the eye's
   sides and over the top of the iris with a dark lash line on top only (no goggle ring), over a fixed skin socket so
   a blink never shows the back of the eye; when the lids shut a dark curved closed-eye line lands across each eye,
   with the cheeks puffed by the Cheek bones. The snout is a broad quarter ellipse with two nostrils.
2. **Live wiring.** Flickering blue veins that flare while charging up or biting, spark bursts, and a cable from the
   back socket that the runtime runs to wherever the newt is plugged in (the coil, the plinth, the brim).

## Rebuild

```
python3.11 -m pip install bpy numpy          # built with bpy 5.0.1; 4.5 also works
python3.11 build_stormspire_lizard.py -- --out ../../public/assets/stormspire-lizard.glb
```

The system `python3` needs Pillow (the builder pipes the textures through it to encode JPEGs; bpy's Python has
none). The last line printed is `LIZARD_BUILD_OK`; Blender can exit 0 after a traceback, so check for it.
`out/build_report.json` records triangles (by part), vertices, bones, clip channels, texture bytes and total bytes;
`--dump-textures` also writes the three JPEGs to `out/`. The build is deterministic (same bytes every run).
Review in `tests/lizard-lab.html` (Vite dev server): `lab.view('show-face')`, `lab.show('cheer')`, `lab.frame(20)`,
tower views `front`, `hopper`, `hopper-side`, `brim`, `climber` and `climber-close`, and `lab.size(390, 844)` for a
phone. `lab.solo(k)` and `lab.orbit(az, el, d, y, dz)` give clean turnarounds of one newt, `lab.near(who, off, aim)` a
camera in a crew newt's own frame, and `lab.feet()` every crew boot's height above the surface it stands on. In-game captures: `tests/stormreel-review.mjs` (first person, `PHONE=1`, `VIEW=god`).

## Budget

About 5,200 triangles in the one skinned mesh (see `out/build_report.json`), of which about 5,050 are visible at
once (the wrench, 84, shows only while tinkering; the two z's, 72, only while napping). The 2026-10-07 finishing pass
spent its extra triangles on the snout, teeth, lids and claws and paid for part of it with flat bevelled badge rims
and buckles. 37 bones, one material, one draw call per newt plus its cable (144
triangles) and one spark cloud per tower (64 points). Textures: three 512 x 512 JPEGs (base colour 55 KB, normal
114 KB, metallic-roughness 68 KB), mip-mapped, shared by every newt; about 1 MB of GPU memory each with mips.
Vertex colours carry data (ambient occlusion, glow, skin mask). No lights. About 560 KB on disk. The GLB is repacked
with `KHR_mesh_quantization` (byte normals, colours and weights) and 16-bit rotation keys, and animation channels that
never leave the rest pose are dropped.

## Texture set

All three maps share one UV layout (Blender pixels, origin bottom left; see `REGIONS` in the builder): the body loft
(x along it, y round it, seam under the belly), head, jaw, arm and leg (left painted, right mirrored onto the same
texels), lid, eye (polar, pupil at the centre), spikes (base to tip), chest plate and hard hat (top-down), and 16 px
solid cells for the small gear (`SLOTS`: colour, roughness, metalness). Skin is painted per texel from the rest-pose
surface point with 3D noise, so it has no seams: a back-to-belly ramp, mottling, clustered spots and speckles,
transverse belly scales and small domed pebbles (in the normal map). The metallic-roughness map is glTF standard
(G roughness, B metalness) with a vein mask in R.

## Runtime contract (client/stormspire-lizards.js)

- Frame: -Z forward, +Y up, X the newt's right, origin on the ground under the belly, metres.
- `COLOR_0`: R = baked ambient occlusion, G = self-glow (eyes, catch-lights, z's, badge), B = skin mask. The runtime
  multiplies the base colour by R, shifts the hue of skin texels per crew member (jade, teal, lagoon), adds a warm rim
  and lights the vein mask (metallic-roughness R) as flickering blue electricity, faded to an even fizz at distance.
- Bones: `Root` > `Hips` > `Spine` > `Head` > `Jaw`, `EyeL/R`, `LidL/R`, `CheekL/R`, `HatHard`; `Hips` > `Belly`,
  `Tail1..6`; `Spine` > `ArmUL/R` > `ArmLL/R` > `HandL/R` > `Wrench` (right); `Hips` > `LegUL/R` > `LegLL/R` > `FootL/R`;
  `Spine` > `Cable1` > `Cable2` > `CableTip`; `Root` > `Z1`, `Z2`. Lids shut by turning -1.75 rad about the newt's X;
  a positive pitch of `Jaw` in the clip specs opens the mouth (the builder's `jaw_open`). The runtime's tracked points
  (boot soles, mouth, wrench head) are rest-pose model coordinates listed in `POINTS`.
- Clips: `idle` (6 s: breathing, looks round, grins, toe tap), `climb` (0.6 s trot, about 0.1 m per loop; the runtime
  sets its time scale from the climbing speed), `cheer` (1.6 s, once: charge up with eyes shut and cheeks puffed, then
  a hop with arms up and a grin), `nap` (4 s: belly down, hat over the eyes, snore, z's), `tinker` (2 s: two wrench
  taps), `bite` (1.8 s: rear back, lunge, chomp and a fizzing, squinting shake).
- Procedural layers (runtime): limb hugging (the napping lounger's limbs fold down either side of the brim pipe
  before the IK plants them), blinks, look-at, springs (tail follow-through in three cascaded stages, hat wobble,
  belly and cheek jiggle, cable sway) driven by the measured acceleration of the head and hips, and two-bone IK that
  plants each boot on the analytic tower surfaces (octagonal stone and courses plus the coil wire for the climber, the
  hopper bowl's lathe profile for the keeper, the torus brim for the napper) while keeping the clip's foot lift.
