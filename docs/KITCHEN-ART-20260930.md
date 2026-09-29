# Enchanted Kitchen authored art — 2026-09-30

Sonnet 5.5 rebuilt the Kitchen as a textured timber hall with a stone hearth, carved worktops, herb shelves, glowing jars, hovering teacups, mouse holes and a central supper table. The existing rats, route, travel portal and floor collision remain. The previous primitive room is the fallback if the authored manifest is absent.

The [before ground view](../assets/enchanted-kitchen-sonnet/previews/before_kitchen_ground.png), [actual-game ground view](../assets/enchanted-kitchen-sonnet/previews/game_ground.png), [before RTS view](../assets/enchanted-kitchen-sonnet/previews/before_kitchen_rts.png) and [actual-game RTS view](../assets/enchanted-kitchen-sonnet/previews/game_rts.png) provide a matched comparison. The Blender [ground](../assets/enchanted-kitchen-sonnet/previews/preview_ground.png) and [elevated](../assets/enchanted-kitchen-sonnet/previews/preview_elevated.png) renders are reference images, not game captures.

The editable source is `assets/enchanted-kitchen-sonnet/kitchen.blend` and `build_kitchen.py`, with ten reusable individual GLBs under `source-glbs/`. Sonnet's `HANDOFF.md` and `stats.json` describe those pieces. The installed kit is one material-batched `kitchen_room.glb` and `placement.json` under `godot/assets/zone_art/enchanted_kitchen/`. `build_runtime_kitchen.py` deterministically compiles the marked layout meshes from the Blend. Rebuild with:

```powershell
& .\tools\blender-4.5.13-windows-x64\blender.exe -b -P assets/enchanted-kitchen-sonnet/build_runtime_kitchen.py -- assets/enchanted-kitchen-sonnet/kitchen.blend godot/assets/zone_art/enchanted_kitchen
& .\scripts\Verify-ZoneArt.ps1 -Zones enchanted_kitchen -Render
```

The source has 11,064 unique triangles and 44,296 triangles across 45 room placements. The compiled runtime room has 20 material meshes, 20 Godot holders and 873 KB of unique embedded texture data; it needs no authored collision proxies because the legacy wall, counter and table colliders stay in place. Structural and face-winding validation passed. The focused route check passed all six protected samples and preserved the combat floor. Whole-world review at 1200 × 750 measured **862 ground-eye / 868 RTS draw calls**, down from the pre-art **950 ground-eye** baseline. The first unbatched import cost 1,327 / 1,404, so the static compile was necessary. These are desktop scene comparisons, not headset frame-time results.

The roof, front portal transition, in-room text scale and rat combat spacing still warrant a live headset playtest. The windows are stylised luminous panes and the tea magic is visual dressing; the kitchen has no new crafting interaction in this pass. An existing game process must be relaunched to load the art.
