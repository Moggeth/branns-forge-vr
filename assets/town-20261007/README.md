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

## Glass

Windows, lanterns and the gable roundels use `Glass` (warm) and `GlassOoze` (Grumblekeep green): diamond quarries of
glowing glass held in dark lead came. The client breathes their emissive intensity a few percent like candlelight.

## Budget notes

After the 2026-10-09 dressing pass the keep taverns are about 11.5k (D) and 12.3k (G) triangles and The Muddled Mug,
nearly twice the floor area, about 14.2k; the whole kit is about 3.1 MB.

Each piece stays well under 12k triangles and the whole kit under 2.5 MB. To get there the builder:
smooths small props (fewer split vertices), gives them one seamless planar UV, drops faces that no probe ray can
reach (buried ends, bottoms on floors, backs against walls; cloth is never culled), and ships base-colour maps at
256 px with normal, ORM and emission maps at half that. Ambient occlusion and weathering are baked into `COLOR_0`
by ray casting against the piece and the ground plane. The kit uses plain float attributes (no quantization or
Draco), so the client can merge its geometry with the bases kit's.

Textures, renders and the local .glb are regenerated and not committed.
