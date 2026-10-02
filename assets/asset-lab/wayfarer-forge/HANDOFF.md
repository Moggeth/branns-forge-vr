# Wayfarer's Forge — handoff

Replaces the shared world's plain purple cylinder. It works as the magical forge and power anchor.

## Rebuild
```
blender.exe --background --factory-startup --python-exit-code 2 --python build_forge.py -- --out <ABS_DIR>
```
The build is deterministic (fixed RNG seeds, numpy textures). A full build with three renders and an LOD check render takes about 2 s wall time on Blender 4.5.13. `--no-render` skips the renders. Measured figures are written to `report.json`.

## Deliverables
| File | Notes |
|---|---|
| `model.glb` | High detail: **9,052 tris**, **8 meshes / 8 primitives**, 8 materials, 4 embedded 256² PNGs, 546 KB |
| `lod.glb` | Same 8 materials and the same 5 sockets: **2,488 tris (27.5 %)**, 263 KB. Collapse-decimated copy of each high mesh |
| `source.blend` | `Art` (8 joined export meshes), `Art_Parts` (165 editable named parts, excluded from the view layer), `LOD`, `Sockets`, `Studio` (ground, sun, fill area light, camera; never exported) |
| `front.png`, `three_quarter.png`, `overhead.png` | EEVEE renders at 800×800 with the AgX transform |
| (overhead orientation) | Front step at the bottom of the image, as if looking down from in front. Godot −X/bellows on the right, matching the front view |
| `lod_three_quarter.png` | LOD silhouette check |
| `sockets/collision.json` | Socket positions plus 8 collision boxes, in Godot space |
| `textures/*.png` | Copies of the painted maps; the GLBs embed their own |

## Axes
glTF/Godot metres, **+Y up, front = -Z**, origin at the ground centre. The asset is authored in Blender Z-up with the front toward Blender +Y, and the exporter's Y-up conversion maps Blender (x,y,z) to Godot (x, z, -y).
Godot bounds: X −1.68…1.56, Y 0…3.06, Z −1.27…1.37. That fits inside 3.4 × 2.8 × 3.5. The main masses (hearth, chimney and anvil) stay inside about 1.2 m radius. The wheel, bellows and draw shafts are lighter outriggers.

## Sockets (Godot coordinates, identical in both GLBs)
| Empty | Position | Purpose |
|---|---|---|
| Ground | (0, 0, 0) | Origin |
| WorkPoint | (0.15, 0, −1.35) | Player stands here, facing +Z toward the anvil and hearth |
| EmberSource | (−0.30, 1.05, 0.12) | Centre of the coal bed, for the light/particle socket |
| CoreTarget | (−0.35, 1.27, 0.21) | Glowing arcane crystal in a copper ring, set into the chimney breast. Clear line of sight from the front, below the hood |
| SignAnchor | (0.40, 2.20, 0.45) | Front face of the hanging blank sign board, ready for a text/decal overlay |

## Materials (8) and textures (4)
- Forge_Stone, Hammered_Iron, Worn_Copper and Oiled_Wood each use an embedded procedural base-colour map: coursed stone with grimy mortar, hammered dimples with rust flecks, copper with verdigris, and planked grain. Metallic and roughness are scalar values.
- Saddle_Leather and Soot_Recess are flat colour. Soot is used for the ash pit, flue mouth, hood underside, cold coals and quench water.
- Hearth_Ember (orange, emissive strength 2.6) and Arcane_Core (violet, strength 3.0) use standard glTF emissive with `KHR_materials_emissive_strength`.
- All of these are plain Principled → glTF values. There are no Blender-only nodes and no external URIs. UVs are world-scale box projections per material, so texel density is consistent across parts.

## Creative decisions
- **Recognisable at FPS height:** a waist-high stone hearth with a glowing coal bed, an arched ash pit with a faint ember glow, and an iron smoke hood with a copper lip. The anvil sits side-on on a banded stump, so its horn/face/waist profile reads from the front, with a hammer on the face and tongs leaning against the stump. The front working face stays open. The front step and WorkPoint lead straight into it.
- **Magic, kept restrained:** the replaced purple cylinder becomes a violet crystal core in a copper ring with four claws. Six small runes surround it, and two glyph clusters flank the ash arch. Three rune studs sit on the chimney's copper band.
- **"Wayfarer":** a cart wheel leans on the quench barrel and a pair of draw shafts trail out the back, so it reads as a forge that travels.
- **Squat, asymmetric chimney:** three cobbled, jittered courses lean left and back. It has a copper band, an iron cap and a rain hat on legs. A wrought-iron sign bracket gives an off-centre silhouette.
- **Craft details:** a teardrop leather bellows on a timber stand with its nozzle into the hearth side, a lever handle, a leather apron on a peg, and a tool rail holding a flatter and tongs. Quoin stones and voussoirs are bevelled so they catch highlights against the dark recesses.
- **Overhead (RTS):** the square copper-rimmed hood, the round stone plinth, the wheel, the barrel, the bellows and the trailing shafts make a distinctive footprint. There is no canopy.

## Integration notes and limitations
- No lights, cameras or collision meshes are exported. The integrator should add the hearth light and particles at EmberSource, and a hit effect at CoreTarget.
- Emission is static. Pulse effects should drive the `Hearth_Ember` and `Arcane_Core` material emission at runtime.
- Collision boxes are axis-aligned approximations. The wheel and barrel share one box.
- The LOD is a 0.28 collapse decimation. Small parts like rivets and chains get crude, but the silhouette, colours and sockets hold up (see `lod_three_quarter.png`). For a cleaner LOD, rebuild it from a reduced parts list.
- There are no normal or roughness maps, to stay within the 4-image budget. Surface relief comes from geometry bevels and painted value.
- Box-projected UVs show visible texture seams on some angled faces, such as the hood slopes and the leaning stack courses.
- The rendered appearance has not been checked inside Godot yet. Run the project's normal asset import and visual review before installing it in `godot/`.
- The mortar grid on the plinth top is large and regular, so it reads as flagstones.
