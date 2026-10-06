# Wyrmspout III (2026-10-06)

The Wyrmspout reforged alongside Weapon Inspect: a jade-scaled wyrm's head (scowling brows, swept ivory horns,
crimson frills, a toothy hinged jaw), a glass tank of liquid fire that really sloshes, and indicators the wyrm wears
on its own body instead of a dial.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy
python3.11 build_wyrmspout_v3.py -- --out ../../public/assets/wyrmspout.glb
python3.11 build_wyrmspout_v3.py -- --render out/review                    # review renders (out/review is ignored)
python3.11 build_wyrmspout_v3.py -- --render out/review --firing           # jaw open with a mock stream
python3.11 build_wyrmspout_v3.py -- --render out/review --closed           # the Wyrm's Eye shut
python3.11 build_wyrmspout_v3.py -- --render out/review --views head,fins  # just some views
```

Do not run the script from a folder that holds a file named `inspect.py`; it would replace Python's own module.
`tools/` (gitignored) holds the in-game capture script.

## Runtime contract

glTF frame is -Z forward, +Y up, metres, with `GripAnchor` at the origin (the centre of the hand).

- `Muzzle`: the spout tip. Projectiles and the stream start here.
- `Jaw`: hinge empty. `rotation.x` negative opens the mouth. `Head` nudges back on a Gout.
- `FuelLiquid`: a closed volume filling the glass, origin at the tank centre, axis along the barrel (local Z).
  client/wyrmspout-liquid.js clips it per draw against a sloshing surface; nothing scales it.
- `EyeGauge`: the Wyrm's Eye on the tank's rear cap, facing the player.
  - `Eye_Pupil`: `scale.x` is the pupil width (about 2.4 round and full, 0.3 a dry slit).
  - `Eye_LidUpper` / `Eye_LidLower`: shells on a sphere behind the eye. Their exported rotation is open
    (rolled back 26°); multiplying it toward 0 slides them shut over the dome.
  - `Eye_Glow`: the light behind the pupil.
- `FinVein_1..3`: the glowing veins up the three dorsal fins. `scale.z` 0..1 grows the light from the root.
- `NostrilFlame_L` / `NostrilFlame_R`: little flames in the nostrils, scaled 0..1.
- `EmberCore`: the pilot ember in the throat.
- `HeatVent_L1..3`, `HeatVent_R1..3`: marker empties on the cheek gills for the heat glow (client/weapon-readiness.js).

Materials are named for client/wyrmspout-look.js, which patches the shared template once (`WyrmHide` and
`ScaleSteel` get scales, `Brass`/`DarkBrass` a hammered break-up, `TankGlass` a fresnel edge, the glow materials a
slow breathing wave, and `LiquidFire` is replaced by the liquid shader). Copies share those materials, so the runtime
moves nodes and drives the liquid through per-draw uniforms; it never clones or edits a material.

Static parts are merged per material within each moving part: 37 meshes, about 10,600 triangles, no textures,
about 440 KB.

## The indicators (client/asset-pose.js `animateWyrmspout`)

| What | Shows |
| --- | --- |
| Liquid level | The fuel left; it drops live while spraying and sloshes with every move |
| Pupil | Round when full, a slit when nearly dry; it squints while spraying |
| Eyelids | Shut while the tank refills, opening over the last third; a blink every few seconds |
| Fin veins | Gout recharging, one fin per third; they breathe when it is ready |
| Nostril flames | Gout ready; the Gout blows them out |
| Cheek gills | Heat (the shared readiness glow) |
