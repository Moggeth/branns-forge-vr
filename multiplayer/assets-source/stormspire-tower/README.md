# Stormspire tower and Stormreel reel pack

The Stormreel's crystal-charged wizard tower and the cable-reel backpack that tethers a hero to it. Visual fidelity
level 2 with level 3 polish (normal maps, baked occlusion, charge-driven light, secondary motion); see
`docs/VISUAL-FIDELITY-LEVELS.md`. This builder replaces the tower and pack parts of `assets-source/stormreel`
(that builder still makes the crossbow until it moves to its own folder; its tower and pack outputs are retired).

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy pillow
python3.11 build_tower.py -- --part all --out out        # ~5 s; also --part tower | pack
cp out/stormspire.glb out/reel_pack.glb ../../public/assets/
```

The last line printed is `STORMSPIRE_BUILD_OK`; Blender can exit 0 after a traceback, so check for it. The build is
deterministic. `out/build_report.json` records triangles (per object), materials, primitives, bytes and node names;
`out/textures/` keeps the generated atlases for review (they are embedded in the GLBs; nothing else ships).

Review in context, not in isolation: `multiplayer/tests/stormspire-lab.html` (views front, hat, hopper, side, wear,
planted; `lab.walk(x, z)` moves the stand-in hero so the pack's sway can be checked, `lab.packInfo()` reports every
pack's motion nodes) and `multiplayer/tests/stormreel-review.mjs` (first person, phone, God camera).

## Design

Cheerful, Overwatch-ish fantasy: the tower is a wizard's lightning tower that a crew of Voltnewts (newts in hard hats,
`client/stormspire-lizards.js`) lives and works on.

- **Big shapes:** octagons throughout (crisp, faceted stone): a chunky plinth on the r 1.45 collider, one tall tapered
  octagonal shaft with seven proud block courses, a battered skirt and a corbelled crown, and a floppy, crooked indigo felt wizard hat whose tip droops back and to the right. The
  hat is the far silhouette: from the God camera the tower reads as a starry blue hat on a copper ring.
- **Medium shapes:** the copper torus brim on six blue ceramic insulators, the Tesla coil winding up the shaft, a
  glass charge column standing on brass brackets in front of the coil, a brass crystal hopper on a stone pedestal,
  red (+) and blue (-) ceramic bushings threaded between coil turns, brass shepherd's hooks on enamelled rosettes.
- **Small accents, only where the eye goes:** the gold lightning buckle on the hatband, gauge rings on the column,
  a stitched purple patch on the hat, a newt-sized arched door with a brass ring and a lamp (it sits below the first
  coil turn), a little wooden ladder from the grass to the deck, three round lit portholes under the crown.
- **The circuit reads by eye:** hopper -> feed pipe -> charge column -> lead up to the hatband -> capacitor crystal
  at the hat tip; the coil's bottom lead drops to a junction box on the deck, its top lead climbs to the brim; four
  copper earth straps run down the plinth to stakes in the grass.
- **Reel pack:** a pedlar's wooden backboard with a quilted leather pad and padded shoulder straps, an iron J-frame
  whose feet let it stand or lie, and a big cable drum with brass rims and lightning-bolt spokes. A crank turns with
  the drum, a ratchet pawl clicks over the teeth, the coiled cord to the crossbow leaves the brass slip-ring housing,
  a glass "live" lamp glows on top in the pack's colour, and the tower cable leaves through a ceramic fairlead.

## Surfaces

- Tower: one 1024 px trim-sheet atlas (`texlib.py`): carved stone courses, plinth stone (with a little moss), indigo
  felt with gold stars and moons and the patch, wood planks, copper (light patina), brass, iron, white/red/blue
  ceramic, gold. Base colour JPEG, normal JPEG (OpenGL), ORM JPEG at half size (R occlusion, G roughness, B metal).
- Pack: one 512 px atlas: board planks, stitched leather, brass, iron, copper, a near-white braided cable jacket and
  near-white ceramic (both tinted per pole at runtime through the `Cable` material), white ceramic, rubber, gold, wood.
- Strips span the full atlas width, so U tiles round the shaft (an integer number of repeats per revolution) and V maps
  inside the strip; tiled V (stone, felt) restarts the strip on inserted rings. Every strip carries 4 px of wrapped
  padding.
- Ambient occlusion (32 cosine-weighted BVH rays per vertex against the whole asset and the ground) and a ground-grime
  gradient are baked into `COLOR_0`.
- Glow parts are plain emissive materials: `Charge`, `Crystal`, `CrystalCore`, `Window`, `Lamp`. `Glass` is a thin
  blended material with a fresnel rim added at runtime (no transmission).

## Budgets (built)

| | Triangles | Materials (draws) | GLB |
|---|---|---|---|
| Tower | 14,170 (coil and brim 3.5k, hat 1.3k) | 8: Stormspire, Coil, Hat, Glass, Charge, Crystal, CrystalCore, Window | 0.92 MB |
| Pack | 5,502 | 3: PackAtlas, Cable (tinted), Lamp | 0.31 MB |

Normals are bytes and colours bytes (`KHR_mesh_quantization`), UV1 16-bit. No lights; no skinning; no transmission.

## Runtime contract

Frame: glTF -Z forward, +Y up, metres. Node names read by the runtime (keep them):

- **Tower** (origin on the ground at the tower centre): `CableTerminal` (1.34, 1.85, 0) and `CableTerminal_B`
  (-1.34, 1.85, 0), `PackHook` (1.25, 1.40, 0) and `PackHook_B` (-1.25, 1.40, 0) (all equal to `STORMSPIRE` in
  `shared/stormreel.js`), `TopLoad` (torus centre, y 5.35), `Capacitor` (hat-tip crystal; local +Y along the crystal)
  with the mesh `Capacitor_Crystal` (spun about its Y), `ChargeColumn` (column floor, local +Y up the column) with the
  mesh `ChargeColumn_Core` (scale Y = stored charge), `Hopper`, `Earth_0..3` (stake tips), `Window_Glow`.
- **Tower materials** the runtime patches (`client/stormspire-art.js`): `Coil` (TEXCOORD_1.x runs 0..0.96 along the
  coil and its leads, 1 on the brim with TEXCOORD_1.y the angle round it), `Hat` (stars found by colour), `Glass`,
  `Charge` (object-space Y along the core), `Crystal`, `CrystalCore`, `Window`.
- **Pack** (origin `PackAnchor` between the shoulder blades): `Sway` (everything below hangs from it; pivot at the
  carry handle), `HangPoint` (inside the carry handle; sits on the tower hook), `Reel` (spins about X;
  `stormreel-view.js` sets `rotation.x = -paidOut * 1.8`), `Reel_Windings` (radial scale = cable left on the drum),
  `Crank` and `CrankKnob`, `Pawl`, `CableExit` (~(0, -0.51, 0.30)), `CordAnchor`, `Lamp` and mesh `Lamp_Glow`,
  `ArcGap_A` and `ArcGap_B`. Material `Cable` is tinted per pole by `tintPack`.
- Lying down (planted crossbow) the pack rests on its straps with the origin ~0.17 m above the grass, as before.
  Upright on its frame feet the origin is 0.455 m above the grass.

## Lizard stage (unchanged)

`client/stormspire-lizards.js` (`TW`, `HOPPER`, `BRIM`, `courseBump`, `stoneApothem`) still matches: an octagonal
shaft, circumradius 0.95 -> 0.68 from y 0.85 to 5.0, faces centred every 45 degrees from +X; seven proud courses at
y0 + (y1 - y0) * (i + 1) / 8, 0.035 proud of the circumradius line (0.032 off the faces) over +-0.046, easing out by
+-0.064; coil 9 turns from y 1.2 to 4.65, 0.09 outside the circumradius, wire radius 0.032, phase pi/2 + 0.25; torus
brim radius 1.12, tube 0.14, at y 5.35 (the hat now sits inside the ring, so the whole top of the brim is free); the
hopper bowl keeps the HOPPER profile (rim r 0.40 at y 1.08, top 1.10) around (0, -1.62) in glTF; plinth deck at y 0.80.
The hopper crystals keep clear of the keeper's perch (0.382, 1.054, -1.60). The charge column now stands on brackets
0.27 out from the front face (it was 0.16, inside the coil), so the coil passes behind it.
