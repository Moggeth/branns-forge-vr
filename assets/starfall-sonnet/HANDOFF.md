# Starfall Ridge art source

This folder contains the editable Starfall Ridge environment kit and its integration contract. Claude Sonnet 5.5 produced the Blender builder in an isolated commission on 2026-09-30. The subscription session limit interrupted the commission before it ran or wrote a handoff. Codex inspected the actual `claude-sonnet-5-5` session metadata, repaired three builder faults, generated the assets, and integrated them into Godot. This is a reviewed partial commission, not a claim that the Sonnet session completed normally.

The builder is `build_starfall.py` (Blender 4.5.13); `starfall_ridge.blend` is editable. `placement.json` contains 294 zone-local placements of 29 named GLBs. The installed runtime files are in `godot/assets/zone_art/starfall_ridge/`. Textures are generated in `textures/` and embedded in the exported GLBs. Nine studio previews and four before/after in-game captures are in `previews/`. `stats.json` reports per-asset bounds, materials and triangles.

To regenerate from the repo root:

```powershell
& tools/blender-4.5.13-windows-x64/blender.exe -b --factory-startup -P assets/starfall-sonnet/build_starfall.py
```

The builder imports `sf_collision.py` and adds 89 opt-in physical placements to the manifest after export. Copy its 29 GLBs and `placement.json` to `godot/assets/zone_art/starfall_ridge/`, then run the Godot editor import. Keep the existing ore, bomb barrier, grapple anchors, enemies, portals and flat floor collider in `WorldExpeditions`/`WorldZones`; the GLBs are the presentation layer. Large cliffs, boulders, ruins, waystones and meteor rock get simple proxies. Crystals, paving, loose scree, low grass and the ground skin have no art-derived collider. The observatory proxy leaves its front doorway open.

The art source is 35,862 unique triangles and 161,596 triangles across all placements, in six material families. The installed kit batches into 84 render holders with 93 simple collider shapes. The world-space art is 66 × 66 m, centered on the zone's existing 56 × 56 m gameplay floor. The visual ground relief is intentionally shallow on the walking route and rises at the margins. It is **not** a new physics terrain: crater depression and edge micro-relief remain visual. A future landscape-system integration should align visual elevation and collision fully if those areas become traversable.

`godot/starfall_art_checks.gd` validates art presence, physical meteor, corridor clearance, mineable ore clearance, three grapple anchors and the bomb breach. `godot/portal_visual_checks.gd` validates all portal approaches. The final VR stereo frame time and close-range headset composition still need an actual headset playtest.

The failed first Blender run was important: removing an exported object left a null view-layer proxy in the next selection loop, so `bpy.ops.object.select_all` is now used. More seriously, assigning image color space **after** `pixels.foreach_set` cleared the images to black in Blender 4.5.13; the builder sets color space first and calls `img.update()` before save. The ground grid's original winding faced downward after Godot→Blender axis conversion; its vertices are now ordered upward. Blender returned process exit 0 even after the first Python traceback, so treat the `done` log line and output validation as the success signal, not exit code alone.
