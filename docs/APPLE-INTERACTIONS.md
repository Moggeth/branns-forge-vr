# Orchard apple interactions

Playable apple trees expose up to six individually hittable apples. An attached apple uses a lightweight static sphere and a spring wobble; a hit at 2.7 m/s or faster detaches it into a rigid body with momentum, friction and bounce. Bolts, thrown tools, melee swings, hand strikes and explosions share the same impact function in `godot/apple_runtime.gd`. Visible fruit is not also baked into the playable tree mesh.

Grip an attached or fallen apple to carry it. In VR, bring the held apple near the headset's mouth position and hold it there for three short bites. The final bite restores 40 HP, capped at 100. Desktop Hero uses three left clicks while holding the apple. Consumed apples regrow after 65 seconds. This is session state; a normal world load starts with fruit on the trees.

Tuning constants at the top of `godot/apple_runtime.gd`: `HEAL`, `DETACH_SPEED`, `GRAB_REACH`, `MOUTH_REACH`, `REGROW_SECONDS`. The per-tree fruit budget is in `godot/tree_kit.gd`. Tree fruit uses one MultiMesh per tree and only loose apples become active rigid bodies. Hidden zones freeze their loose fruit.

Focused check from the project root:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://apple_checks.gd
```

This runs against the real Orchard Highlands world and checks ray targeting, wobble, rigid detachment, grip, manual and near-mouth eating, regrowth, a flying Siegebird bolt, and thrown-object impact. Successful output is `APPLE_CHECK_RESULT` with an empty `failures` array. Follow with Godot `--editor --quit` and `-- --expedition-check` when changing tree generation or zone integration. Always pass `--xr-mode off` for headless diagnostics: omitting it can start SteamVR/OpenXR and stall engine teardown even after the test result prints. The previous run needed an interrupt after the assertions passed; the same check with `--xr-mode off` completed in about 2.8 seconds.
