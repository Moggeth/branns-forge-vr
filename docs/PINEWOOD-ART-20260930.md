# Pinewood Ruins authored art — 2026-09-30

Sonnet 5.5 built a new Pinewood kit: a moss-covered broken stone arch and ruined walls, three kinds of conifer, fallen timber, rubble, undergrowth and a textured dirt route. The game keeps its three harvestable apple/lumber trees, two Mossward enemies, chop barrier and portal route. The prior primitive arch and dressing remain a fallback when the manifest is absent.

Compare the [previous ground view](../assets/pinewood-ruins-sonnet/previews/before_pinewood_ground.png) and [previous RTS view](../assets/pinewood-ruins-sonnet/previews/before_pinewood_rts.png) with the [actual-game ground view](../assets/pinewood-ruins-sonnet/previews/game_ground.png) and [actual-game RTS view](../assets/pinewood-ruins-sonnet/previews/game_rts.png). The [Sonnet ground](../assets/pinewood-ruins-sonnet/previews/pinewood_ground.png) and [Sonnet RTS](../assets/pinewood-ruins-sonnet/previews/pinewood_rts.png) renders are source-art references; the Godot captures show the playable result.

The source folder `assets/pinewood-ruins-sonnet/` has the editable Blend, deterministic Blender builder, nine reusable textured GLBs, source layout, preview renders and author handoff. `godot/assets/zone_art/pinewood_ruins/` holds the installed GLBs. `prepare_runtime_manifest.py` converts the source layout to the runtime manifest and adds conservative solids to the arch posts, walls and conifer trunks. Ground, foliage, small rubble and fallen logs remain walkable, protecting the combat route. The authored ground covers the full zone and the old flat surface remains collision-only. This removes a visible overlap seam without changing player grounding.

The installed kit has **9 GLBs, 97 placements, 3,756 unique triangles, 26 batched material holders and 38 simple collision shapes**. Structural, UV, embedded-texture and face-winding validation passed. The native route check passed ten protected player positions with three lumber and three apple resources plus the chop barrier. Whole-world actual-game captures measured **336 ground-eye / 420 RTS draw calls**, versus **322 / 414** before the art pass. These are desktop draw samples, not VR frame timings. The source builder rebuilds the kit in about 5.7 seconds.

Rebuild and verify from the repository root:

```powershell
& .\tools\blender-4.5.13-windows-x64\blender.exe -b -P assets/pinewood-ruins-sonnet/build_pinewood.py -- --out work/pinewood-rebuild
Copy-Item work/pinewood-rebuild/*.glb assets/pinewood-ruins-sonnet/source-glbs/
Copy-Item work/pinewood-rebuild/*.glb godot/assets/zone_art/pinewood_ruins/
Copy-Item work/pinewood-rebuild/placement_pinewood_ruins.json assets/pinewood-ruins-sonnet/
Copy-Item work/pinewood-rebuild/stats.json assets/pinewood-ruins-sonnet/
python assets/pinewood-ruins-sonnet/prepare_runtime_manifest.py
& .\scripts\Verify-ZoneArt.ps1 -Zones pinewood_ruins -Render
```

The first Godot review revealed a square seam from layering the new ground over the original visible floor. Lowering the edge exposed an irregular but still sharp color contour. Hiding only the old floor's visual was cleaner; its collision and all gameplay remain. The next headset pass should check stone scale and natural route comfort. Relaunch the game to load the new kit.
