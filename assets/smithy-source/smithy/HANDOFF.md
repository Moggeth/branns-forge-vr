# Brann's Forge smithy kit: handoff

## Rebuild
```
& "C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe" -b --factory-startup --python output/build_smithy.py
```
A single deterministic builder (seeded) writes every `.glb`, the `textures/*.png` sources and `preview.png`, which shows a front view and an oblique view side by side. The preview includes three hall bays repeated along X. Set `SMITHY_NO_PREVIEW=1` to export only. The script needs only Blender and the numpy that ships with it.

## Axes / origin (all assets)
- Godot: Y up, **+Z faces the viewer/player**, origin on the floor (y=0) at the footprint centre. `sign.glb` is the one exception: it is centred on its own origin.
- Geometry is authored in Godot coordinates. The helper `g2b(x,y,z) -> Blender (x,-z,y)` converts them, and the exporter uses `export_yup`, so no rotation is needed after import.
- Scale is 1 unit = 1 m. Every asset has a root node, then mesh children joined per part, with `material_index` per material.

| File | Root node | Mesh nodes | Key measurements (m) |
|---|---|---|---|
| cradle.glb | Cradle | Cradle_Body, Cradle_Drawer (slides +Z), Cradle_Nameplate | W 1.55 (x ±0.775), D 0.72 (z ±0.36), top slab 0.84–0.89, oxblood bed top 0.91, low saddle rims ≤0.955, nameplate face z=0.38, y=0.80 |
| hall_bay.glb | HallBay | HallBay_Body, HallBay_Lamp (+ empty HallBay_LampLight_Socket at y 3.47) | x −3..3, z −3..3; posts 0.26 sq at (±2.85, ±2.85); tie/eave beam underside 3.30; ridge 5.45; lantern top ≈6.6; lamp bottom 3.18 |
| furnace.glb | Furnace | Furnace_Body, Furnace_Fire | 2.0 W × 1.25 D; mouth opening x ±0.38, y 0.94–1.36 (centre 1.15), front z 0.575; copper hood 1.60–2.55; chimney collar top **3.10** |
| anvil.glb | Anvil | Anvil_Body | stump r 0.36 × 0.80; face 0.90 (x ±0.45) × 0.45 (z), top **y 1.22**; horn to x +0.87 |
| dummy.glb | Dummy | Dummy_Body, Dummy_Target | 2.05 tall, base cross 1.1; chest 0.62 W, target disc r 0.20 at y 1.32, z 0.205 |
| bench.glb | Bench | Bench_Body | 1.55 × 0.85 × 0.95; shelf at 0.25; peg-joined legs |
| sign.glb | Sign | Sign_Body, Sign_LetterField | 1 × 1 × 0.08 centred on origin; lettering field 0.80², face at z 0.035. The game places the lettering decal or Label3D at z ≥ 0.037 |
| court_tile.glb | CourtTile | CourtTile_Body | 2 × 2, slabs top at y ≈0.03, mortar bed 0–0.01. Sink it 0.02 into the ground or snap it to a 2 m grid |

## Materials (shared names across files; Godot dedups on import)
`M_Oak_Worn`, `M_Oak_Carved` (darker carved and stained oak), `M_Iron_BlueBlack`, `M_Steel_Trim`, `M_Copper_Worked` (hammered, with patina in the hollows), `M_Bronze_Lamp`, `M_Oxblood_Lining`, `M_Slate_Roof` / `M_Slate_Roof_Band` (one darker course), `M_Stone_Blackened`, `M_Soot`, `M_Flagstone`, `M_Mortar`, `M_Straw_Stitched`, `M_Rope`, `M_Canvas_Target`, `M_Fire_Luminous` (emissive heat gradient: white-gold root to deep red tip, along U), `M_Coal_Embers` (emissive cracks), `M_Glass_Hearthlight`, `M_Slate_Field`.

Textures are procedural, tileable PNGs in `textures/` at 512² (colour plus `_n` normal map). They are also embedded in each glb. UVs use box projection at 1 m per tile (2 m for slate and flagstone) with a random offset per part, so neighbouring timbers don't repeat the same grain. `T_Flagstone` is a repeatable 2 m ground material on its own.

## Modularity
- **HallBay** repeats along X at a 6 m pitch. There are no walls on any side, so both x ends and both ±Z aisles are open. Posts and trusses sit 0.15 m inside each x end, so adjacent bays form **paired twin posts and trusses** at the joins, with no coincident faces. The eave beams, slate courses, ridge roll, rafters (0.75 m pitch) and ridge cresting (0.5 m pitch) all line up across the seam. There is no floor and no collision mesh; add collision in Godot for the posts only.
- Arched knee braces come down to y 2.75 within 0.7 m of each post. The clear headroom everywhere else is ≥3.30, and the lamp bottom is at 3.18.

## Motions / FX
- `Cradle_Drawer`: slide +Z up to 0.25 m.
- `HallBay_Lamp`: sway pivot at the chain top (0, 5.17, 0), ±3° slow pendulum.
- `Furnace_Fire`: `forge_fire.gd` (child of the furnace root) adds a warm OmniLight flicker (layered sine and noise, no shadows), flame-tongue breathing on `Furnace_Fire`, and 24 additive spark billboards that drift upward. The flames are five braided tongue pairs (twin counter-twisted cones), with an emissive back-glow card and a coal bed.
- `Dummy_Target`: a separate node so it can be swapped or "repaired", or given a hit wobble.

## Courtyard lighting, wayfinding, placement spec
- **Key**: a low warm sun (≈5600 K tinted to #FFCC99), 35–55° elevation, from the open aisle side. Ambient is a blue sky fill at about 0.5.
- **Hearth**: an OmniLight at the furnace mouth, colour #FF8C38, range 4–5 m, energy 2–3, flickering. This is the brightest point in the scene and the station anchor.
- **Bay lamps**: one per bay at the `HallBay_LampLight_Socket` marker. Use an OmniLight #FFA64D, range 5 m, energy 0.8, no shadows. Mobile budget: at most 4 lights reaching any surface, so lights in alternating bays can stay off when bays repeat.
- **Hierarchy**: stations read as copper and fire-lit; architecture as oak and slate; ground as neutral flag. Keep station props within 1–8 m sightlines, and keep display items on the cradle at 0.91 m with nothing above 0.955.
- **Wayfinding**: mount one `sign.glb` (scaled 0.5–0.6) per station on the eave beam (y ≈2.6–2.8, face +Z toward the aisle), or on a post at 1.7 m. The copper nameplate on the cradle and the hearth glow serve as secondary beacons.
- **Placement in one bay** (bay-local): furnace (−1.7, 0, −2.1) facing +Z; anvil (−0.9, 0, −0.3), 1.2–1.5 m in front of the mouth, horn +X; handoff bench (1.5, 0, −2.2); armoury cradle (1.4, 0, 0.9); dummy at an aisle edge (−2.2, 0, 1.6), with ≥1.5 m clear swing radius. Keep a 1.6 m walking aisle through x.

## Known limits
- **Open defect (hall_bay):** the common rafters (0.75 m pitch) sit about 0.1 m too high and show through the slate on the roof's top face, as `preview.png` shows. To fix, change the rafter centre offset `rise / 2 + 0.10` to `rise / 2 - 0.04` in `build_smithy.py` and rebuild. The underside view from the courtyard is correct.
- Geometry is generated, not hand-sculpted. Wear lives in the textures and bevels; there is no edge-mask AO bake or lightmap UV2. Set Godot import to generate UV2 for LightmapGI if you need it.
- File sizes are 0.4–4 MB, mostly embedded 512² PNGs that are duplicated per file. For production, import once and convert to a shared material library or ETC2/ASTC.
- The fire is opaque emissive, with no alpha flame shader; the flicker is driven from the script.
- The reference smithy's shell-trim and embellishment pack was not delivered because of the time limit. The `arc()`, `box()` and `rivet()` helpers in the builder are reusable for it.
- The preview's lighting comes from Blender EEVEE, not Godot Mobile, so expect lower contrast in-engine.
