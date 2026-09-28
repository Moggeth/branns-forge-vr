# Orchard work-site art source

This is the reviewed Opus 5.5 source commission for the live orchard builder. `orchard_kit.blend` contains the worker, stockpile, and waymarker; `build_orchard_kit.py` recreates the GLBs, `.blend`, texture maps, reports, and review renders in this folder. `validate_kit.py` reimports the results into a fresh Blender process. The approved playable GLBs are separately committed under `godot/assets/worldbuilder/`.

From this directory, run:

```powershell
blender --background --factory-startup --python build_orchard_kit.py
blender --background --factory-startup --python validate_kit.py
```

The imported worker is grounded at Y=0, faces +Z, and contains `Worker_Idle`, `Worker_Walk` and `Worker_Chop` clips. The game positions and animates it independently of the asset source. The companion [handoff](HANDOFF.md) records sockets, sizes, collision guidance, performance and visual review; [builder UI spec](BUILDER-UI.md) is design guidance, not a complete implementation checklist. After rebuilding, compare `inventory.json` and the review images, import the GLBs through Godot, run the world-builder checks and visually inspect the results before replacing the approved binaries.
