# Brinedeep salt-mine curios (2026-10-16)

Easter-egg props for the Brinedeep salt mines, companion to `../salt-mine-kit` and built to its conventions. Built by
`build_salt_mine_curios.py` (Blender 4.5 as a Python module), exported to `public/assets/salt-mine-curios.glb`.
Cheerful, chunky and a bit goofy: brass and gold that gleams, salt that glows from inside, lantern and candle light.

## Pieces

Top-level nodes, one static mesh each, each at its own origin. Front faces +Z, +Y is up, units are metres, and no
node has a transform.

| Node | Tris | Size (x × y × z) | What it is | Origin |
| --- | ---: | --- | --- | --- |
| `CanaryCage` | 2,470 | 0.31 × 0.55 × 0.31 | Brass miner's birdcage: hanging ring, knob, 14 bars over a bell dome, three hoops, a framed door on the front with latch and hinge loops, a little bell on a chain, a wooden perch with brass collars, a water cup hooked on the bars, an engraved tray with sand and seed husks | the top of the hanging ring. The cage hangs along -Y |
| `Canary` | 788 | 0.08 × 0.14 × 0.17 | Bright lemon-yellow adult canary: a sleek, forward-leaning body with a distinct head and neck, blush cheeks, a small swept-back crest, long barred wings, a long notched tail, a stubby beak and catch-lit eyes, facing +Z | between its feet. The toes reach up to 14 mm below it to wrap round the perch |
| `CanaryKeeled` | 780 | 0.15 × 0.18 × 0.11 | The same bird keeled over on its back: belly up, stiff legs in the air, wings flopped out, X eyes. It lies across X with its head to +X | on the floor under the body's centre (y = 0 is where it rests) |
| `LunchPail` | 2,842 | 0.46 × 0.30 × 0.26 | Dented oval tin dinner pail with a red band and a folded-back wire bail. The lid is knocked ajar, and a big salted pretzel (its salt glows a little) sits on top. A pickle pokes out of the gap at the back right, and a red-and-white checked napkin hangs over the front rim. A blue-rimmed enamel mug of coffee stands beside it, with crumbs | floor level, between the pail and the mug (the pail's centre is at x = -0.062) |
| `Saltman` | 3,994 | 1.08 × 1.31 × 0.61 | Snowman of three rock-salt lumps, stepped along each lump's own cubic cleavage grid. Halite crystals are set into the lumps on the same grid, mostly buried, each showing a stepped hopper pit. It has pick-handle arms with iron ferrules and twig fingers (one waving), coal eyes, a coal smile and buttons, and a carrot nose. It wears a sack-cloth scarf with printed stripes and frayed tails, and a dented miner's hard hat tipped back with a lit candle in a brass bracket | base centre, facing +Z |
| `SaltShaker` | 5,758 | 0.92 × 1.83 × 1.39 | The Great Salt Shaker. A 0.5 m carved salt plinth (stepped slabs, framed panels, a glowing rose crystal set into the front, pale ones on the sides) holds a 1.33 m heirloom shaker. It has a fluted gold foot and a tall, gently waisted twelve-sided glass body packed with glowing salt in wavy white, blush and rose layers up to a wavy fill line, with clear pale-aqua glass above and vertical glass glints. A gold waist belt carries salt gems, and a chunky threaded brass collar holds a big domed cap pierced with 39 glowing holes in three rings, topped by a crown finial. A heap of glowing salt crystals has spilled at its foot | base centre of the plinth, facing +Z |
| `CrabCrown` | 1,228 | 0.17 × 0.11 × 0.19 | King Pinchy's gold crown: beaded band, five tapered spikes with ball tips, a red velvet cap with a gold button, a deep-pink salt gem in a gold bezel at the front, and two small gems | centre of the band's base, +Y up, gem at +Z |
| `SignCrabs` | 2,300 | 0.87 × 1.47 × 0.32 | Weathered post with a round cream board on top showing a brick-red crab (with googly eyes) under a red ring and slash, painted slightly proud. Below it hangs a crooked teal plank with **MIND THE / CRABS!** carved 9 mm deep, the letter floors painted yellow. Nails, and salt crust at the foot (kept above y = -0.03) | base of the post (the post is 6 cm behind the origin), facing +Z |
| `TallyBoard` | 818 | 0.91 × 0.72 × 0.22 | Plank nailed across a sawn-off beam stub. It carries a chalk crab doodle, chalk tallies (three gates of five plus two), a carved heart with **B.F.** inside, and a chalk stub on a string hanging from a nail | back centre of the bounding box (x and y centred). z = 0 is the wall plane, and it faces +Z |
| `ToolRack` | 2,916 | 1.44 × 1.31 × 0.30 | Wall rack: two cleats and a rail with iron plates and pegs. Two picks hang by their heads on paired pegs, a round-point shovel hangs by its D-grip, a coiled rope is bound on a peg, and a small brass lamp (`LanternGlow`) hangs from an iron hook | back-bottom-centre. z = 0 is the wall plane, and it faces +Z |

### Cage anchors (in `CanaryCage` space)

- **Perch point (0, -0.3782, 0)**: the top of the perch dowel. Put the `Canary` origin here.
- **Cage floor point (0, -0.476, 0)**: the sand surface in the middle of the tray. Put the `CanaryKeeled` origin here.

Both points are also printed by the build and written under `anchors` in the `--report` JSON. Gameplay: the canary
sings on the perch; when firedamp is about to blow, swap it for `CanaryKeeled` on the floor, then swap back when it
perks up.

## Materials and attributes

The kit's six shared materials (`Timber`, `Iron`, `Brass`, `SaltRock`, `SaltCrystal`, `LanternGlow`), so the client's
salt glow and lantern emissive apply unchanged, plus two new ones:

- `Painted`: plain vertex-coloured paint, food, cloth, coal, wax, chalk and the canary's beak, eyes and legs.
  Roughness 0.62.
- `Feather`: the canary's body, wings, tail and crest. Roughness 0.78. Don't add a white sheen: it washes out the yellow.

Every base colour factor is white. The colour comes from:

- `COLOR_0`: the authored colour with baked ambient occlusion multiplied in, in linear space. It is uint16 on
  Timber/Iron/Brass and uint8 elsewhere. Pieces on the floor bake against a ground plane, and wall pieces against a
  wall plane at z = 0.
- `TEXCOORD_0`: only on `Timber`, as wood-grain tile coordinates for the kit's shared 512 px `SaltMineTimber` grain
  (u along the grain; planar on the carved boards). The salt primitives carry a constant `TEXCOORD_0` so their
  texcoord sets stay contiguous. Every other primitive has none.
- `TEXCOORD_1.x`: the salt-lamp glow mask, 0 to 1, as in the kit. It is present only on `SaltRock`/`SaltCrystal`:
  1 on the shaker's cap holes, 0.8 to 0.95 on its salt fill, 0.95 on its gems, about 0.06 on its empty glass, and about 0.85 to 0.9 on the spilled crystals.
- `LanternGlow`: the candle flame on the Saltman's helmet and the lamp globe on the ToolRack. It exports
  `emissiveFactor` (1.0, 0.62, 0.28).

Repacked with `KHR_mesh_quantization` (int8 normals, integer colours and UVs, float positions), as in the kit.

## Budget

23,894 triangles and 946,260 bytes in total (limit 950,000 bytes). Per-piece caps, all asserted by the build: cage 2,500;
each canary 800; shaker 8,000; Saltman 4,000; every other piece 3,000.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy pillow
python3.11 build_salt_mine_curios.py -- --out ../../public/assets/salt-mine-curios.glb
python3.11 build_salt_mine_curios.py -- --out /tmp/c.glb --render /tmp/curios-review --samples 40   # Cycles review
```

The last line printed is `SALT_MINE_CURIOS_OK`. The build is deterministic (seeded RNG and hash noise). Options:

- `--pieces A,B` builds a subset (for iteration; the material check is skipped).
- `--only name,...` limits the renders.
- `--view x,y,z` overrides the camera direction.
- `--report path.json` writes the build report.
- `--sections` prints triangles per labelled section.

Nothing is written next to the script: the grain texture goes to a temp folder.

The carved lettering is built directly, with no boolean. Blender's built-in font (Bfont) is converted to filled glyph
outlines, those outlines are cut as holes into the board's front face, and the builder adds recessed letter floors
and walls.

Review renders (warm, dim cave nook; salt glow on; source review only, not in-game, mobile or headset proof):

- one per node
- `SignCrabs-front-3m` (legibility from about 3 m)
- `cage-canary` and `cage-keeled` (the anchors in use)
- `group`
