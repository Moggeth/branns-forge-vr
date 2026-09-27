# Forge lantern comparison

Two independent answers to the same Asset Lab brief: a carryable lantern with
an authored grip, flame marker, moving hinged shutter, and tab. Both use the
same `godot/forge_lantern.gd` gameplay adapter so appearance and construction
can be compared without changing controls.

| Entry | Artist | Character | Installed GLB | Godot-imported bounds |
| --- | --- | --- | --- | --- |
| Cinderleaf | GPT-6 Sol | Open copper cage, patina, opal chamber, louvers | `godot/assets/forge_lantern/sol.glb` | 0.131 × 0.323 × 0.147 m |
| Anvilwatch | Claude Opus 5.5 | Hammered copper, anvil plinth, etched horn, sun door | `godot/assets/forge_lantern/opus.glb` | 0.259 × 0.414 × 0.259 m |

The earlier `assets/asset-lab/pilot` lantern is a **separate integration
prototype**. It was not submitted as the Sol entry. Claude was commissioned
with the personal `fauxgrady@gmail.com` Claude.ai Pro subscription, CLI model
`claude-opus-5-5`, isolated from Sol's source and the live checkout. The
session reported Opus 5.5 and no API key source.

Actual Godot comparison frames: [day](in-game-day.png) and
[darkened](in-game-night.png). The Sol and Opus folders also contain larger
closed/open artist renders for inspecting the geometry. Paired review angles:
[Sol front](sol/front.png) / [Opus front](opus/straight_front.png), and
[Sol three-quarter](sol/three_quarter.png) / [Opus three-quarter](opus/front.png).

Both accepted models have editable Blender sources and builders in their
respective folders here. The original GLBs are embedded, including their
procedural texture maps. `front.png` and `open.png` are artist renders, not
engine screenshots. No purchased texture or external mesh was used.

## Try them

Launch the current game in VR or desktop mode. The two named collection stands
are together on the **east edge of the Forge Yard**, beyond the usual gear
stands and before the waystones. Grip/E to carry one. With a free VR hand,
grip the brass shutter tab and pull; releasing leaves it in place. The held
hand's trigger, or desktop left click, toggles the shutter. The flame's one
shadowless light brightens as the shutter opens. Let go to set it down, or use
the named home to return it. The artwork does not become a light emitter until
the gameplay adapter is present.

Reproduce the in-game comparison from the repository root with graphical
Godot (a headless renderer cannot produce this capture):

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot -- --capture='C:/ABSOLUTE/PATH/day.png' --capture-lantern-pair
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot -- --capture='C:/ABSOLUTE/PATH/night.png' --capture-lantern-pair --capture-lantern-dark
```

Build from source with the bundled Blender. Both builders require an absolute
output directory and emit `model.glb`; Sol also emits three renders, Opus five
unless `--no-render` is supplied. Do not overwrite the installed GLBs until
validation and visual review pass.

```powershell
& tools/blender-4.5.13-windows-x64/blender.exe --background --factory-startup --python assets/asset-lab/lantern-comparison/sol/build.py -- --out 'C:/ABSOLUTE/PATH/sol-review'
& tools/blender-4.5.13-windows-x64/blender.exe --background --factory-startup --python assets/asset-lab/lantern-comparison/opus/build.py -- --out 'C:/ABSOLUTE/PATH/opus-review'
python scripts/asset_lab.py inspect assets/asset-lab/lantern-comparison/sol/asset.json godot/assets/forge_lantern/sol.glb
python scripts/asset_lab.py inspect assets/asset-lab/lantern-comparison/opus/asset.json godot/assets/forge_lantern/opus.glb
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://forge_lantern_checks.gd -- --expect-pair
```

The final inspections passed Khronos validation with zero errors and warnings,
then a disposable Godot import. Sol: 1,340 triangles, 50 meshes, 6 materials,
one embedded image, 120 KB. Opus: 8,544 triangles, 68 meshes, 7 materials,
two embedded images, 610 KB. Opus's BVH shutter sweep reported no intersecting
moving/static faces at 13 angles. The shared game check passed 53 assertions
for both variants, including simulated hand placement, shutter motion, light,
drop/settle on a collision table, and same-home return. These are functional
and desktop-render checks; actual Knuckles feel and headset frame time still
need a live playtest.

The first Opus inspect used a 25 cm X/Z envelope and failed at 25.9 cm. A
reviewed 27 cm allowance accepts the ornamented plinth without altering the
mesh. A rebuild from Opus source preserves the JSON scene description and
counts, but its GLB is not byte-identical to the commission's export: several
mesh buffers differ. Keep the installed approved binary when doing art review;
do not treat source rebuilds as hash-identical releases until this is resolved.

On Windows, Godot may exit with code zero after a script error. Require the
`FORGE_LANTERN_RESULT` marker with `failures: []` and scan logs for
`SCRIPT ERROR`. A headless OpenXR run has no tracked hands, so the regression
script creates simulated controller nodes for grip placement.
