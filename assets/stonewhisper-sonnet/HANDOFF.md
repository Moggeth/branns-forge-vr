# Stonewhisper Pick - handoff

Files: `build_stonewhisper_pick.py` (deterministic builder), `stonewhisper_pick.blend` (editable), `stonewhisper_pick.glb` (self-contained, textures embedded), `preview_01..06_*.png`, `build_stats.json`.

## Rebuild
```
C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe --background --python build_stonewhisper_pick.py
```
Add `-- --no-render` to skip previews. Outputs land beside the script. Seeded, so output is reproducible.

## Design
Curved, downswept twin-point steel pick (blued steel, slight belly droop, tips taper to points facing outward on -X/+X), octagonal socket eye with brass rims and a short finial spike, ash haft with brass langets (side straps) below the head, banded leather grip wrap (y 0.10-0.34), flared brass pommel. A faceted glowing "resonance" crystal is set into each face of the eye, with small crystal rune studs along both arms.
Nothing articulated: the head is a rigid mining head on purpose.

## Dimensions (Godot axes, +Y handle; metres)
- Total length: -0.045 .. 0.718 = 0.763 m (pommel below y=0; grip origin at y=0)
- Head span: 0.64 m (x = +/-0.32); head centre y=0.62; tips at y=0.535
- Shaft diameter ~3.7-4.3 cm; grip wrap ~4.2-4.6 cm (oval, slightly wider on X)
- Head thickness (Z in Godot) ~8.5 cm at the eye

## Triangles: 2,720 total
BrassTrim 556, GripWrap 1172, Shaft 500, PickHead 200, ResonanceCrystal 200, HeadSocket 92.

## Materials (5 families)
Steel_Blued (128px embedded tex, metallic), Wood_Ash (128px tex), Leather_Wrap (64px tex), Brass_Trim (metallic), Resonance_Crystal (emissive blue, strength 0.9 - it is a separate mesh/material so the game can drive emission for the charge visual; the glTF carries emissive factor).

## Named markers (empties under root `StonewhisperPick`)
| Name | Godot position | Note |
|---|---|---|
| Grip | (0, 0.0, 0.22 in Blender Z = Godot y 0.22) | arrows; centre of leather wrap |
| PickTipLeft | (-0.32, 0.535, 0) | rotated to point -X |
| PickTipRight | (+0.32, 0.535, 0) | rotated to point +X |
| ChargeGlow | (0, 0.62, 0) | centre of the head eye |
| HitCentre | (0, 0.56, 0) | approx impact centre of the head |

Blender is Z-up; the exporter converts to Y-up, so Blender (x,y,z) becomes Godot (x,z,-y). Verify empties appear as Node3D in the Godot import (they should, via the GLB).

## Known limits / not verified
- Not imported into Godot or tested in-game; only checked in Blender previews (EEVEE) and via the GLB export succeeding.
- Wear is baked only as light scratch glints in the steel texture; no normal maps.
- Crystal reads pale-blue under Blender's AgX tone-mapping; tune `emit_strength` in the builder if the game's glow needs to be stronger.
- Preview lights/floor/camera are not exported (export uses selection of the weapon only).
