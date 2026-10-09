# Town kit (taverns, quartermasters, gold mills)

`build_town.py` builds the town buildings for both sides plus the shared neutral tavern and writes `town_kit.glb`
here. It follows the home bases kit exactly (`../home-bases-20261004/build_bases.py`, whose texture, mesh, masonry
and colour-packing helpers it imports): same material names, packed `COLOR_0`, pieces at the origin facing three.js +Z,
moving parts as separate top-level nodes with their pivot at the origin, and child empties marking anchors.

    pip install bpy==4.5.*
    python3 build_town.py                     # town_kit.glb, textures/, build_report.json
    cp town_kit.glb ../../multiplayer/public/assets/
    python3 render_town.py all front34,side,back,top,inside,detail,counter 24 1200x800   # Cycles views in renders/

`python3 build_town.py D_Mill,G_Mill` rebuilds a subset (handy while iterating; the GLB then holds only those).

## Pieces and anchors (three.js coordinates: x right, y up, z toward the front)

| Node | What it is | Anchors (child empties) |
|---|---|---|
| `D_Tavern`, `G_Tavern` | Open-fronted hall, 8 x 6, walls at x = +-4 and z = -3 (0.4 thick, inside the footprint), corner posts r 0.2 at (+-3.8, 2.8), ridge 6.5. Bar along the back, two round tables, hearth in the left wall, raised plank floor (0.1). Dressing hugs the walls and beams: wagon-wheel chandelier, plate rails, notice board, a trophy over the hearth, drying herbs, a braided rug; outside a log pile by the chimney and climbers (D) or glowing toadstools (G). | `*_Tavern_Bar` (0, 1.1, -1.75), `*_Tavern_Hearth` (-3.8, 0.1, -0.8), `*_Tavern_Chimney` (top of the pot, where the client's smoke starts) |
| `N_Tavern` | "The Muddled Mug", 11 x 8, walls at x = +-5.5 and z = -4, posts at (+-5.3, 3.8), ridge 7.7, four tables, hearth in the right wall, the same dressing plus its legendary trout over the fire. | `N_Tavern_Bar` (0, 1.1, -2.55), `N_Tavern_Hearth` (5.3, 0.1, 0), `N_Tavern_Chimney` |
| `D_Quartermaster`, `G_Quartermaster` | Market stall on a 5 x 3.5 dais, counter front face z = +1.75, top 1.1; wares on three back shelves; striped awning; gold-coin sign on a mast. | `*_Quartermaster_Counter` (0, 1.1, 1.6) |
| `D_Mill`, `G_Mill` | Gold mill tower, r 2.6 at the foot to 2.0 at 6.9 m, cap and finial above (about 10 m overall); hopper, coin chute and brass tray, capstan bed; millstones behind an arched opening on the +x side. | `*_Mill_Hub` (0, 7.2, 2.3), `*_Mill_Hopper` (0, 1.4, 3.3), `*_Mill_Chute` (1.3, 0.5, 3.0), `*_Mill_Crank` (-2.0, 0, 3.0) |
| `D_MillSails`, `G_MillSails` | Four sails, 9 m across, in the local XY plane 0.5 m in front of the hub; spin about local Z. Place at `*_Mill_Hub`. | |
| `D_MillCrank`, `G_MillCrank` | Capstan: axle up local Y from the origin, spoked wheel 1.5 m across at 0.92 m, six handles to 1.2 m. Turns about local Y. Place at `*_Mill_Crank`. | |

## Round 2 (2026-10-09): walls, furniture, props, livery

- `Plaster` is now a calm warm limewash and `Cloth` a fine even weave (both generated here, replacing the bases kit's
  blotchy render and coarse cloth), so walls read clean and banners and cushions read in their own colours.
- `interior()`: a panelled wainscot (baseboard, two rows of panels, chair rail) round the side and back walls, painted
  cottage blue (D), toad green (G) or honey oak (N), and the timber frame showing on the inside (posts, wall plate,
  corner braces) clear of windows, the hearth and whatever hangs on the wall.
- `table_set()`: plank-top round tables with an iron or brass band on a turned pedestal, a high-backed settle against
  the side wall (so its back never hides the bar from the door) and three ladder-back chairs with tied-on cushions;
  `table_food()` puts bread and cheese or a lattice pie (G: glowing stew and a drumstick), tankards, a bottle and a
  candle on every table.
- `bar()`: a panelled back board with a carved crest (D sun, G skull and bones, N tankard), tankards hanging on hooks
  under the bottle shelf, corked and labelled bottles and stoneware flagons. `mug()` has a foot, a rolled lip and hoops.
- `flag()` is a heraldic banner: trim border, raised device (`emblem()`: D sun over an anvil, G skull and crossed bones,
  N foaming tankard), tasselled hem, a pole with finials and tasselled cords. `bunting()` pennants are creased, every
  third a swallowtail. The Quartermaster banner carries its side's device and the awning valance has tassels.

## Glass

Windows, lanterns and the gable roundels use `Glass` (warm) and `GlassOoze` (Grumblekeep green): diamond quarries of
glowing glass held in dark lead came. The client breathes their emissive intensity a few percent like candlelight.

## Budget notes

After the 2026-10-09 round 2 (furniture and livery) the keep taverns are about 15.9k (D) and 16.8k (G) triangles and
The Muddled Mug, nearly twice the floor area with four table sets, about 21.4k; the whole kit is about 3.86 MB (the
test ceiling is 4.5 MB). That is over the old 12k-per-piece aim: seating and table dressing are most of it (each
table set is about 1.5k). If a phone check shows the taverns cost too much, trim chairs first (two per table) and
then the hanging tankards, not the walls or banners.

To keep it that small the builder:
smooths small props (fewer split vertices), gives them one seamless planar UV, drops faces that no probe ray can
reach (buried ends, bottoms on floors, backs against walls; cloth is never culled), and ships base-colour maps at
256 px with normal, ORM and emission maps at half that. Ambient occlusion and weathering are baked into `COLOR_0`
by ray casting against the piece and the ground plane. The kit uses plain float attributes (no quantization or
Draco), so the client can merge its geometry with the bases kit's.

Textures, renders and the local .glb are regenerated and not committed.
