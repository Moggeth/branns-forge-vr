# Brinedeep salt-mine kit (2026-10-16)

Ten static props for the Brinedeep, an old, cheerful salt mine dug into a mountain: pink and white rock salt (halite)
that glows warm from inside like a salt lamp, chunky dark oiled timber, iron straps and rivets, brass and lantern light.
Built by `build_salt_mine_kit.py` (Blender 4.5 as a Python module), exported to `public/assets/salt-mine-kit.glb`.

## Pieces

Top-level nodes, one static mesh each, each at its own origin, front facing +Z, +Y up, metres, no node transforms.

| Node | Tris | What it is | Origin |
| --- | ---: | --- | --- |
| `MinePortal` | 5,016 | Timbered adit for a 3.8 x 3.5 m opening. It has two posts, a heavy lintel with iron L-brackets, knee braces, a hanging signboard (pick crossed over a salt crystal, no text) and a lantern hook on the right (+X) post. Salt crust sits on the timber feet. Behind the frame, a 1.5 m rock-salt reveal rolls out into a rough collar with boulders and sprouting crystals | floor centre of the opening, +Z out of the mountain |
| `TimberSet` | 716 | Tunnel set for a 3.4 x 3.1 m tunnel: two posts, a cap beam, lagging wedges, head shims, iron plates, crust at the feet | floor centre |
| `RailStraight` | 240 | 2.0 m of track along Z: four sleepers, two I-profile rails, spikes. Gauge 0.6 m between rail heads, rail top at y = 0.20 | centre, on the floor |
| `MineCart` | 3,508 | Tapered, planked tub with iron bands, corner irons and rivets. Four flanged wheels on axles, sills, buffers with coupling rings and grab handles, heaped with pink salt. Length is along Z | floor centre. Its wheels sit on `RailStraight` rails when both origins coincide |
| `Lantern` | 1,110 | Hanging brass miner's lantern: ring, vented cap, cage wires and hoop over a glowing globe, fuel font with a wick knob. 0.51 m tall | top of the hanging ring |
| `SaltCluster` | 1,754 | Showpiece halite cluster about 1.2 m tall (bbox top 1.197) on a faceted rock base: a big hopper cube with an intergrown corner-up cube, a deep-rose tower, a stepped stack and a ring of cubes | base centre on the floor |
| `SaltClusterSmall` | 326 | 0.41 m scatter version (hopper cube, child cube, three cubes, two grains) | base centre on the floor |
| `FiredampVent` | 1,364 | 1.2 m crusted rock mound, 0.35 m tall, with radial cracks, a faint sulphur stain and a dark fissure. The throat stays above y = 0 so terrain never plugs it. The gas is a runtime effect | floor centre |
| `RubblePile` | 1,156 | 1.4 m heap of cleavage-block salt-rock chunks (pink, white, grey) and gravel on a dust mound, with a broken support spar | floor centre |
| `BrineRim` | 2,780 | 2.2 m lumpy evaporite rim with polygonal salt-flat ridges, heaved crust plates and cubes grown at the waterline. The inside is open; the inner wall runs down to y = -0.16 so the water plane always meets it | water-level centre |

Anchor: the lantern hook's resting point in `MinePortal` space is **(2.10, 2.494, 0.664)**. Put the `Lantern` origin
there and its ring hangs on the hook (also in `out/build_report.json` under `anchors`).

## Materials and attributes

Six shared materials: `Timber`, `Iron`, `Brass`, `SaltRock` (rock, rubble, crust), `SaltCrystal` (crystals) and
`LanternGlow`. All base colour factors are white. The colour comes from:

- `COLOR_0`: the authored colour with baked ambient occlusion multiplied in, in linear space. It is stored as uint16 on
  Timber/Iron/Brass (dark tones, no banding) and uint8 on the salt and glow primitives. The build fails if a
  primitive's COLOR_0 comes out mostly white.
- `TEXCOORD_0`: Timber only, wood-grain tile coordinates (u along the grain) for the one shared 512 px JPEG
  `SaltMineTimber`. It is near-white grain that multiplies over the vertex colour. On other primitives it is a
  constant you can ignore.
- `TEXCOORD_1.x`: the **salt-lamp glow mask**, from 0 to 1, on `SaltCrystal` and `SaltRock`. It is 1 on hopper
  recesses and terrace risers (the glowing core), about 0.5–0.9 on crystal faces (deep-rose crystals higher),
  0.12–0.6 on rock (milky veins higher) and 0.15–0.3 on crust. It is 0 in the vent fissure and on every other
  material. `TEXCOORD_1.y` = 0. Suggested runtime: `emissive += saltColour * warmTint * mask * glowStrength`, where
  `warmTint` is about (1.0, 0.55, 0.38).
- `LanternGlow` exports `emissiveFactor` (1.0, 0.62, 0.28) at strength 1. The whole globe is the glowing part, so
  scale it up at night or swap in your own emissive.

Crystals, rock lining, rubble and crust are flat-shaded facets. Timber and metal use chamfered edges with weighted
normals, so they shade smoothly with bevels that catch the light. Geometry is repacked with `KHR_mesh_quantization`:
int8 normals, integer colours and UVs, float positions.

## Budget

17,970 triangles for the whole kit (limit 26,000), 1,027,616 bytes (limit 1.2 MB). The instanced pieces stay well
under their caps: TimberSet 716 of 900, RailStraight 240 of 300, SaltClusterSmall 326 of 500. Per-piece triangles,
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
`SaltCluster` and `MineCart`, `lineup.png` with every piece, and `scene-glow.png`. That last one is a dark assembled
scene: the portal with the lantern on its hook, rails, the cart on the track, clusters, the vent and the brine pool,
with the preview glow driven by the mask. Renders are source review only. They don't establish in-game, mobile or
headset quality.
