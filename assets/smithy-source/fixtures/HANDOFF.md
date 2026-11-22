# Brann's Smithy: fixtures handoff

Rebuild with: `blender.exe -b --factory-startup --python output/build_fixtures.py`. To build only some assets, add job names, e.g. `-- build_door build_lamp`. The script uses Blender 4.5.13 and its bundled numpy, and needs no network access. `preview.py` imports the GLBs and renders `preview.png`. In that preview the door and plaque are scaled down for layout, so some parts look spread out. This only affects the preview. The GLBs are correct.

## Conventions
- Units are meters, Y is up, and the front faces +Z. In Blender I modeled with the front facing -Y; the glTF exporter converts it.
- All textures are made by code (FFT noise, Voronoi, wood grain, etched-copper knotwork, patina, rust, leather grain). They are 256 px colour maps plus normal maps, saved as JPEG inside each GLB. The working PNGs are in `_tex/`.
- Shared materials: `oak`, `oak_carved`, `walnut`, `copper` (etched and patinated), `copper_plain`, `iron`, `steel`, `brass`, `leather`, `rope`, `thread`, `enamel`, `text`, `stone`, and the glowing materials `teal_glow`, `bomb_glow`, `lamp_glass`, `fire`, `hot`.
- Small repeated parts (rivets, stitches, studs, coins, rings, straps, text) are merged into one mesh each. Each asset uses about 3–6 materials.
- Roughness is a fixed value on each material. Only the ground set has a separate roughness map.

## Assets
| File | Origin | Notes |
|---|---|---|
| bucket.glb | floor centre | Turned-stave oak pail (open). Radius .23 at the bottom and .29 at the top, height .30. Two iron hoops, copper ears. The iron bail handle with its walnut grip rests against the front side. Copper medallion on the front, coins inside. |
| lever.glb | bottom pivot (axle at y≈.03) | Iron base and arms. Copper grip .22 wide, centred at y=.5, with iron wraps and brass rivets. |
| pouch.glb | belt point | Leather body .30 wide, base −.23, gathered neck top .08. Rope drawstring with brass toggles, flap with stitches, buckle, belt loop and belt stub on the back (−Z). |
| gloves.glb | stand | Empties `gauntlet_L` and `gauntlet_R` sit at x=∓.14 / ±.14, y=.035 (wrist). The knuckle bar is at y=.30. Etched copper cuff with glowing teal bands and scrollwork. Glowing bomb core in a bezel with a fuse, brass canisters. Walnut and iron stand with copper cradles. |
| foundry_door.glb | floor centre | 2.9 wide × 2.8 tall × .16 deep. Two oak leaves with a 2 cm centre seam and carved raised panels. Steel diamond and horizontal straps with rivets, iron pull rings near the seam. Copper hex maker mark on the left leaf (brass anvil-and-hammer rune). |
| furniture_plaque.glb | panel centre | Writing face at x and y ±.5, flush at z=0. Total depth .075 (frame lip +.015 forward, back −.06). Charcoal enamel, copper corner bands, brass fasteners. The runtime supplies the active ledger, controls and item names on the clean face. |
| coal_billet.glb | centre | Uneven ingot .23 × .07 × .14 with glowing cracks (emission texture, strength 5). |
| armory_lamp.glb | chain anchor (top) | Chain, copper cap and 3 copper louvers, pear-shaped glass with a soft warm glow (strength 2), 6-bar iron cage, copper finial at −.55. |
| ground_path_{color,normal,roughness}.png | — | 512 px tiling flagstones with grass in the gaps. The normal map is OpenGL-style (+Y up). |
| mini_1…4.glb | plinth floor centre | All are .78 × .55 and no taller than .6. 1: basic hearth (stone, fire, copper hood, logs, kettle). 2: tinker workbench (gears, vise, shelf of jars, rope coil). 3: enchanted anvil on a stump with a teal rune circle and floating crystals. 4: active foundry (furnace, tilted crucible pouring molten metal, glowing ingot mould, gantry, anvil). |

## Known limits
- The minis are quick blockout-level scenes with the shared materials.
- The plaque is about 0.9 MB because of the text mesh. To make it smaller, bake the text into the face texture, or use the game's own text and hide `plaque_text`.
- I have not checked the files in an engine yet. In particular, check that the bomb core and teal glow aren't too strong in VR tone mapping.
