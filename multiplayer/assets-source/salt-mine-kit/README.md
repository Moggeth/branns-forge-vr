# Brinedeep salt-mine kit (2026-10-16, uplift and Carvers' Chapel)

Nineteen static props for the Brinedeep, an old, cheerful salt mine dug into a mountain: pink and white rock salt
(halite) that glows warm from inside like a salt lamp, chunky dark oiled timber, iron straps and rivets, brass and
lantern light. Ten mine pieces, plus nine for the Carvers' Chapel, a chamber carved from salt in homage to Wieliczka's
chapel. Built by `build_salt_mine_kit.py` (Blender 4.5 as a Python module), exported to `public/assets/salt-mine-kit.glb`.

## Pieces

Top-level nodes, one static mesh each, each at its own origin, front facing +Z, +Y up, metres, no node transforms.
The ten mine pieces keep their names, origins, footprints and contract constants from the first version.

| Node | Tris | What it is | Origin |
| --- | ---: | --- | --- |
| `MinePortal` | 6,138 | Timbered adit for a 3.8 x 3.5 m opening. It has two posts, a heavy lintel with iron L-brackets, knee braces, a hanging signboard and a lantern hook on the right (+X) post. Behind the frame, a 1.5 m reveal is cut in bedded salt, one colour per stratum. The collar is courses of squared salt slabs (pink, rose, coral, milk white) stepping back from the opening, with ragged outer ends, boulders at the feet and hopper crystals sprouting from the joints | floor centre of the opening, +Z out of the mountain |
| `TimberSet` | 1,076 | Tunnel set for a 3.4 x 3.1 m tunnel: two posts, a cap beam, lagging wedges, head shims, iron head plates, iron foot bands, cap-end straps and crust at the feet. A miner's tally (four and a slash) is scratched into the right post | floor centre |
| `RailStraight` | 640 | 2.0 m of track along Z: four chamfered sleepers with end grain, iron tie plates and spikes, two I-profile rails with polished running tops, rusty webs and a fishplate at the +Z joint. Gauge 0.6 m between rail heads, rail top at y = 0.20 | centre, on the floor |
| `MineCart` | 4,996 | Tapered, planked tub with iron bands, corner irons and rivets, and a brass plate with a rose crystal on each end. Four flanged wheels with spoke ribs and brass hub caps, sills, buffers with coupling rings and grab handles. Heaped with salt chunks, crystals and a hopper crystal on top. Length is along Z | floor centre. Its wheels sit on `RailStraight` rails when both origins coincide |
| `Lantern` | 1,110 | Hanging brass miner's lantern, 0.51 m tall (unchanged) | top of the hanging ring |
| `SaltCluster` | 3,138 | Showpiece halite cluster about 1.2 m tall on a faceted rock base: a big hopper cube with an intergrown corner-up cube, a stair growth stepping off its flank, a deep-rose tower, a coral column, a ring of cubes and a sugary white crust round the foot | base centre on the floor |
| `SaltClusterSmall` | 558 | 0.41 m scatter version | base centre on the floor |
| `FiredampVent` | 1,364 | 1.2 m crusted rock mound with a dark fissure (unchanged apart from the crystal upgrade) | floor centre |
| `RubblePile` | 1,302 | Heap of salt-rock chunks and gravel with a broken spar. Someone's pick is stuck in the top of the fall; its handle reaches y = 1.24 | floor centre |
| `BrineRim` | 2,824 | 2.2 m evaporite rim with salt-flat ridges, crust plates and waterline cubes. A carved toy boat has beached on the crust | water-level centre |
| `StatueBrann` | 8,172 | Brann, the forge's namesake, carved in salt: a stout, grinning dwarf smith with a big beard in two banded braids, an apron with a pocket, one fist on his hip and a sledge resting on his left shoulder (rose crystal head). He stands on a squared plinth (1.4 x 1.12 m, 0.62 m tall) with base moulding, cornice and a carved crystal panel. A little Saltback stowaway waves up at him from the plinth's front-right corner. 2.71 m overall | plinth base centre, faces +Z |
| `StatueCrab` | 7,072 | A Saltback hermit crab carved in salt, both claws up in a cheery wave, big eyes, a grin and a shell of real crystals, on a 1.42 x 0.92 m plinth 0.22 m tall. 1.22 m overall | base centre, faces +Z |
| `StatueGoat` | 7,392 | A stocky mountain goat carved in salt, horns swept back, licking a coral salt block that sits on a squared post at its chin. Body along X with the head at +X, so the profile faces the viewer. Plinth 1.84 x 0.8 m, 0.2 m tall. 1.35 m overall | base centre, faces +Z |
| `SaltChandelier` | 7,346 | Wieliczka-style chandelier: brass hook and iron chain, a brass crown and column threaded with graduated crystals, three brass tiers (radius 0.42, 0.85 and 0.55 m) hung with strings of cubic drops, long pendants and festoons. Six candle cups with `LanternGlow` flames and upright crystals on the wide tier, and a long glowing finial. Glow mask 0.9 to 1. 1.83 m wide, 1.95 m tall | the top of the hook ring; it hangs down along -Y |
| `ChapelRelief` | 5,600 | Relief panel, 2.6 x 1.7 m and 0.25 m deep. Two miners (one swinging a pick, one pushing a cart heaped with crystals), the forge's hammer striking an anvil inside a starburst, and a Saltback with its claws up. Behind them are mountains, with a tiny goat on the right peak. A moulded frame has crystal rosettes at the corners. Raised parts are paler and glow more | bottom centre of its back face: z = 0 is the wall plane, it projects toward +Z |
| `CarversBench` | 2,880 | The carvers' bench (in place of an altar): a cream salt slab on two pedestal ends with a footrest and a front apron set with diamonds. On top: four salt-block candles with `LanternGlow` flames, three chisels, a mallet, a half-carved bust of Brann with its chips, and lunch (a brass plate with a salted pretzel, and a tin mug). 1.8 x 0.74 m, top at 0.86 m | floor centre, faces +Z |
| `SaltSpire` | 2,520 | Floor stalagmite of salt in rimstone ledges, rose at the foot to milk white at the tip, with crystals round the base. 1.54 m | base centre on the floor |
| `Stalactites` | 2,600 | Seven salt icicles with drip nodes hanging from a roof boss. The longest is 1.23 m, and the tips glow most | top centre, where it meets the roof (y = 0 is the roof plane) |
| `SaltDrapery` | 2,950 | Flowstone curtain hanging from the roof: folded, thin and glowing, rose at the roof and milky toward the scalloped drip edge. 2.0 m wide, 1.61 m tall, 0.44 m deep | top centre (y = 0 is the roof plane) |

Anchors (also in `out/build_report.json` under `anchors`):

- Lantern hook in `MinePortal` space: **(2.10, 2.494, 0.664)** (unchanged). Put the `Lantern` origin there.
- `SaltChandelier` candle flames (y about -0.855, ring radius 0.85) and `CarversBench` candle flames, at the centre of
  each flame. These are for an optional flicker or a single shared light; the kit itself has no lights.

Easter eggs: the tally on every `TimberSet`, the pick in `RubblePile`, the toy boat on `BrineRim`, the Saltback
stowaway on Brann's plinth, the goat on the relief's mountain, and the half-carved Brann bust and salted pretzel on
`CarversBench`.

## Materials and attributes

Six shared materials: `Timber`, `Iron`, `Brass`, `SaltRock` (rock, rubble, crust), `SaltCrystal` (crystals) and
`LanternGlow`. All base colour factors are white. The colour comes from:

- `COLOR_0`: the authored colour with baked ambient occlusion multiplied in, in linear space. It is authored per face
  corner, so worn timber chamfers, polished rail tops and stratum faces keep their own tone without softening normals. It is stored as uint16 on
  Timber/Iron/Brass (dark tones, no banding) and uint8 on the salt and glow primitives. The build fails if a
  primitive's COLOR_0 comes out mostly white.
- `TEXCOORD_0`: Timber only, wood-grain tile coordinates (u along the grain on every beam, plank and wedge) for the one
  shared 512 px JPEG `SaltMineTimber`, at one texel density (1.1 m per tile). End caps carry concentric UVs, so the
  grain stripes read as growth rings. The grain is near-white and multiplies over the vertex colour. On other
  primitives, TEXCOORD_0 points at the same accessor as TEXCOORD_1, because only Timber samples a texture.
- `TEXCOORD_1.x`: the **salt-lamp glow mask**, from 0 to 1, on `SaltCrystal` and `SaltRock`. It is 1 on hopper
  recesses and terrace risers (the glowing core), about 0.5–0.9 on crystal faces (deep-rose crystals higher),
  0.12–0.6 on rock (milky veins higher) and 0.15–0.3 on crust. It is 0 in the vent fissure and on every other
  material. `TEXCOORD_1.y` = 0. Suggested runtime: `emissive += saltColour * warmTint * mask * glowStrength`, where
  `warmTint` is about (1.0, 0.55, 0.38).
- `LanternGlow` exports `emissiveFactor` (1.0, 0.62, 0.28) at strength 1. The whole globe is the glowing part, so
  scale it up at night or swap in your own emissive.

Crystals, rock lining, collar slabs, rubble and crust are flat-shaded facets. Each larger crystal face is an inset
frame round a slightly sunken core: milky, low glow at the rim and bevels, clearer and brighter at the core. Hopper
faces step down to a fully glowing floor. Timber and metal use chamfered edges with weighted normals. The statues and
formations are sculpted as signed-distance fields (smooth unions and carves), meshed with surface nets, relaxed and
decimated. They are smooth shaded, and their glow mask comes from a baked thickness, so braids, claws, horns, icicle tips
and the drapery's edge shine through like a salt lamp. Geometry is repacked with `KHR_mesh_quantization`: int8
normals, integer colours and UVs, float positions.

## Budget

69,678 triangles for the whole kit (build limit 80,000) and 2,494,760 bytes (limit 2.4 MiB). The instanced pieces stay
under their caps: TimberSet 1,076 of 1,500, RailStraight 640 of 640, SaltClusterSmall 558 of 700. The statues are under
9k each, the chandelier is under 7.5k, the relief under 6k and the other chapel pieces under 3k. Per-piece triangles,
vertices, materials, bounding boxes, colour ranges and the maximum glow mask are in `out/build_report.json` (tracked).

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy pillow
python3.11 build_salt_mine_kit.py -- --out ../../public/assets/salt-mine-kit.glb
python3.11 build_salt_mine_kit.py -- --out out/salt-mine-kit.glb --render out/review   # Cycles review images
```

The last line printed is `SALT_MINE_KIT_OK`. The build is deterministic (seeded RNG and hash noise). `--pieces A,B`
builds a subset (iteration only; the full-kit material check is skipped), and `--only name,...`, `--samples N` and
`--view x,y,z` control the renders. Don't run it from a folder that holds a file named `inspect.py`.

`out/review/` (gitignored) holds a warm-studio three-quarter view of each piece, front views of `MinePortal`,
`SaltCluster`, `MineCart` and the chapel pieces, `lineup.png` with the mine pieces, `scene-glow.png` and
`chapel-glow.png`. `scene-glow.png` is a dark assembled scene: the portal with the lantern on its hook, rails, the cart
on the track, clusters, the vent and the brine pool. `chapel-glow.png` is the chapel in the dark, lit by the chandelier,
the candles and one lantern. In both, the mask drives the preview glow. Renders are source review only. They don't establish in-game, mobile or
headset quality.
