# Back town kit (Workshop, Stores, cottages, well, lanterns)

`build_backtown.py` builds the back town that sits behind each keep, through its pass, and writes `backtown_kit.glb`
here. It reuses the town kit's helpers (`../town-20261007/build_town.py`, which in turn uses the home bases kit), so the
material names, packed `COLOR_0`, origin-centred pieces facing three.js +Z and anchor empties all match.

    pip install bpy==4.5.*
    python3 build_backtown.py                 # backtown_kit.glb, textures/, build_report.json
    cp backtown_kit.glb ../../multiplayer/public/assets/
    python3 render_backtown.py                # Cycles views in renders/

## Pieces and anchors (three.js coordinates: x right, y up, z toward the front)

| Node | What it is | Anchors |
|---|---|---|
| `D_Workshop`, `G_Workshop` | Open-fronted smithy, 6 x 5: furnace with its stack through the roof, anvil, quench trough, ore bin, bar rack, wall tools, anvil sign. | `*_Workshop_Anvil` (0.4, 0.96, 1.3), `*_Workshop_Furnace` (-1.3, 0.65, -0.45), `*_Workshop_Rack` |
| `D_Stores`, `G_Stores` | Storehouse, 5 x 3.5, wide double doors standing open, barrels and crates out front. | `*_Stores_Door` (0, 0, 1.75) |
| `D_Cottage`, `D_CottageB` (and `G_`) | Two cottages, 4.5 x 4. | none |
| `D_Well`, `G_Well` | Roofed well, r 1. | none |
| `D_Lantern`, `G_Lantern` | Lantern post with an arm. | `*_Lantern_Light` (0, 2.15, 0.55) |

Footprints for collision live in `multiplayer/shared/home-workshop.js` (`BACK_TOWN_SOLIDS`); where each piece stands
is in `multiplayer/shared/keep-sites.js` (`BACK_TOWN`). The view is `multiplayer/client/back-town-view.js`.
