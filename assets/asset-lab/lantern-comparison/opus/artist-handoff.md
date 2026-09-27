# "Anvilwatch" forge lantern — Opus design handoff

> Archived artist handoff. Its `output/` paths refer to the isolated Claude
> commission. The maintained builder, source, spec, and previews now live
> beside this handoff; the installed GLB is
> `godot/assets/forge_lantern/opus.glb`. The later rebuild was not
> byte-identical, despite the deterministic-build claim below. See the parent
> comparison README for current commands and validation.

## Design
A squat, hammered-copper cage stands on a stepped **anvil plinth** (blackened-iron foot with little anvil-horn nubs). It has glowing **rune-horn panes** etched with an anvil-and-sparks glyph inside a burnt ring, copper cross-straps, brass-capped iron posts, and a hipped copper roof topped with a tiny **anvil finial**. Above that is a sturdy iron bail with an **oxblood-leather grip** between brass ferrules. The front is a hinged **brass sun-door** with an eight-ray emblem and a curled brass **thumb ring** on its free edge. Opening the door shows a tallow candle with a teardrop flame.

I authored everything from scratch. I did not open the other artist's work or the existing pilot builder/model.

## Files (all in `output/` unless noted)
- `../build.py`: deterministic standalone builder (fixed RNG seeds, no external inputs)
- `anvilwatch_lantern.blend`: editable Blender 4.5.13 source scene, with textures packed
- `model.glb`: self-contained, with two embedded PNGs
- `render_front_closed.png`, `render_side_closed.png`, `render_threequarter_closed.png`, `render_threequarter_open.png`, `render_front_open.png`
- `stats.json`: the builder's own measurements; `textures/*.png` are copies of the embedded bitmaps

## Build
```
tools/blender-4.5.13-windows-x64/blender.exe --background --factory-startup --python work/lantern-comparison/opus/build.py -- --out ABSOLUTE_DIR [--no-render]
```
A full build with 5 Eevee renders took about 3 s on this machine.

## Sockets (Godot space, metres, +Y up, front = +Z, closed pose)
| Node | Position | Notes |
|---|---|---|
| `Grip` | (0, 0.398, 0) | Centre of the leather wrap. The grip axis runs along X: 70 mm long, 30 mm diameter (33 mm at the ferrules). There is about 8 cm of finger clearance above the finial. The child `GripCollision-colonly` is a 90×36×36 mm box. |
| `Flame` | (0, 0.100, 0) | Emissive teardrop mesh node |
| `ShutterHinge` | (0.061, 0.127, 0.061) | Front-right corner, outboard of the post |
| `ShutterThumb` | local (-0.100, -0.010, 0.020) under the hinge; world closed (-0.039, 0.117, 0.081), open (0.096, 0.117, 0.157) | Child of `ShutterHinge`, sits at the thumb ring |

There is also `BodyCollision-colonly`, a 140×320×140 mm box centred at Y=0.16. Godot's `-colonly` import hint turns both collision boxes into collision-only shapes with no visible mesh.

## Shutter
- All the door geometry is parented under `ShutterHinge` (frame, horn pane, sun emblem, straps, barrel, thumb ring).
- It rotates about the hinge's local **+Y**: 0 is closed and **+1.72 rad** is open. The door swings outward toward +Z and ends slightly past perpendicular, alongside the right-hand side.

## Counts
- 8,520 triangles in the visible mesh, after the bevel modifiers are applied
- 66 visible mesh objects plus 2 collision boxes; the GLB contains 68 meshes
- 7 materials: HammeredCopper, BlackenedIron, SunBrass, RuneHorn, OxbloodLeather, TallowWax, Flame
- 2 images

All materials are opaque Principled BSDF. RuneHorn and Flame (and TallowWax, faintly) use emission; there is no alpha blending.

## Texture provenance
Both bitmaps are generated procedurally in pure Python inside `build.py`. They are 256×256 PNGs, packed into the .blend and embedded in the GLB. No external or AI-generated images were used.
- `T_Anvilwatch_Horn` (seed 1717): amber horn with fibre streaks, a burnt border, a rune ring and the anvil/sparks glyph. It is used for both base colour and emission.
- `T_Anvilwatch_HammeredCopper` (seed 4242): hammered dimples and verdigris-dark seams from a jittered cell pattern.

## Bounds (Godot)
- Closed: 0.172 X × 0.4145 Y × 0.1615 Z, foot at Y=0.000
- Open: 0.192 × 0.4145 × 0.242. The swung door stays inside the 0.25 m limit.

## Verification and clipping
- `build.py` checks the shutter sweep itself: it builds BVH trees of the moving assembly and all static visible meshes at 13 evenly spaced angles from 0 to 1.72 rad. **There are 0 overlapping face pairs at every angle.**
  - The first build had overlaps from an over-long diagonal pane strap; I fixed that.
  - The hinge barrel (r 5 mm) clears the corner post and rivet (≥6 mm), and the door stays 12 mm below the roof eave and 12 mm above the plinth.
- I parsed the GLB header and confirmed the four required node names are present, along with 2 `image/png` images.
- I reviewed the renders by eye in both the closed and open poses.
- Not verified: importing into Godot, and in-VR hand feel.

## Concerns
- The thumb ring sits about 20 mm proud of the door. A hand reaching around it from the side could brush the right post area when the door is fully open, which is fine for gameplay but worth checking in VR.
- There are many small separate mesh objects (66). If draw calls matter, join the static parts by material at import. Material batching already limits this to 7 materials.
- The copper box-projection UVs stretch slightly on the plinth sides.
