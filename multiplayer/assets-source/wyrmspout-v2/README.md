# Wyrmspout II (2026-10-04)

The Wyrmspout rebuilt as a sleek forged wyrm with a glass tank of liquid fire. It replaces the imported native
model, so `scripts/package-wyrmspout.py` is gone.

## Rebuild

```
python3.11 -m pip install bpy==4.5.* numpy
python3.11 build_wyrmspout_v2.py -- --out ../../public/assets/wyrmspout.glb
python3.11 build_wyrmspout_v2.py -- --render out/review            # review renders
python3.11 build_wyrmspout_v2.py -- --render out/review --firing   # jaw open with a mock stream (review only)
```

Do not run the script from a folder that holds a file named `inspect.py`; it would replace Python's own module.

## Runtime contract

glTF frame is -Z forward, +Y up, metres, with `GripAnchor` at the origin (the centre of the hand).

- `Muzzle`: the spout tip. Projectiles and the stream start here.
- `Jaw`: hinge empty. `rotation.x` negative opens the mouth (client/asset-pose.js `animateWyrmspout`).
- `FuelLiquid`: its origin sits on the tank floor, so `scale.y` is the fill (1 full, 0 empty).
- `Gauge_Needle`: on the rear cap, facing the player. `rotation.z` = 120° (empty) to -120° (full).
- `EmberCore`: the pilot ember in the throat. It grows while spraying.
- `HeatVent_L1..3`, `HeatVent_R1..3`, `Neck_Scales`: anchors for the readiness glow (client/weapon-readiness.js).

Meshes are merged per material within each moving part, giving 33 nodes and 4,122 triangles in about 190 KB
with no textures. Materials are shared with remote copies, so the runtime moves nodes and never edits materials.
