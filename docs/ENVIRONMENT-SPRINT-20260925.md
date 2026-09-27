# Environment sprint — 25 September 2026

The game now has a filled distant landscape, a reusable tree kit and a first set of better foreground landmarks. The goal was to make the zones feel larger while preserving the simple style, physical harvesting, and a low render cost. These changes load from the Godot source on the next normal game launch; previously exported packs remain snapshots.

## Installed

- `godot/horizon.gd` builds one collision-free mesh per core zone (12 zones), with hills, treelines, quarry mesas, misty fen silhouettes, distant floating islands and foundry peaks. `adventure_runtime.gd` follows the game's environment colour and `weather_runtime.gd` refreshes the tint during outdoor day/night changes. The horizon is excluded from local snow/rain surface overlays.
- `godot/tree_kit.gd` and `godot/tree_adapter.gd` replace the old primitive apple and pine trees through `WorldZones.tree()`. Eight lumber trees retain their axe/notch/respawn contract. Orchard Highlands has five reachable hanging apple resource clusters instead of five crates. Gloamfen uses the fen/deadwood variants. Decorative canopies have no collision; trunks keep simple physical proxies. Wind and painted leaf cards remain off by default pending headset review.
- `godot/landmark_kit.gd` adds batched quarry mesas, Crystal Hollow cave/crystal forms, Ember Foundry basalt/gate forms, and visual-only undersides to the existing Cloudbreak islands. The Cloudbreak bridges/new platforms and Pinewood arch from the isolated design were deliberately not installed because they would alter traversal or intersect a tree.

All three kits came from separate Claude Opus 5.5 commissions under the verified personal Claude Pro CLI sign-in. Their prompts, source references, runnable test projects, captures, measurements and handoffs are in `work/claude-environment-sprint-20260925/{horizon,trees,landmarks}/`. A fourth Opus 5.5 commission independently reviewed the integrated source and seven captures; its findings are in `work/claude-environment-sprint-20260925/review/HANDOFF.md`. The generated foliage study and processed atlas are retained in the tree lane; the live trees use shaped opaque meshes because they looked better than alpha leaf cards in the A/B capture. No Anthropic API billing was used.

The review led to immediate placement fixes: the orchard's choppable tree no longer blocks its central path, non-harvestable timber no longer advertises apple pickups, Gloamfen's mushroom stems and fen trees leave the boardwalk corridor clear, and Cloudbreak's arrival instruction now sits in front of its first grapple pole with darker text. Distant horizon tint continues following the world clock outside the five weather-covered core zones. The resulting Orchard, Gloamfen and Cloudbreak captures are `audit-fixed-*.png` in the sprint folder; the final Cloudbreak title placement is `audit-fixed-cloudbreak_keep-v2.png` (a subsequent off-axis trial was rejected). Import, expedition, weather, fairy, guardian, and isolated quest checks passed after integration. Use `node scripts/check-quests.cjs` for the quest fixture; a direct `--quest-check` refuses a live service by design.

## Measured desktop evidence

The isolated horizon adds exactly **one draw call per zone** and 2,938–7,000 triangles; its render test captured 19 angles. The tree kit uses 466 triangles for a far apple and 3,168 for a near choppable apple; distant mixed groves can be merged into one draw call. Installed Orchard Highlands dropped from 249 to 154 draw calls at the same 1280×800 native capture view after the tree swap, with the horizon already present in both. Gloamfen changed from 171 to 175. The landmark kit typically adds one or two visible draw calls per installed zone. These are desktop Mobile-renderer numbers on the RTX 3080 Ti, **not headset frame-time measurements**.

The installed source passed Godot 4.7.2 import and `--expedition-check` (`EXPEDITION_RESULT []`, 17 total destinations, 12 reachable core zones). The expedition check now also verifies all 12 horizon meshes, the eight timber chop contracts and five reachable orchard apple resources. `--weather-game-check` passed with `WEATHER_GAME_CHECK_RESULT []`; the fairy check passed 75 checks, and `--guardian-check` passed. Native Mobile-renderer captures were inspected at `work/claude-environment-sprint-20260925/integrated-*.png` and `landmarks-integrated-*.png`.

## Start, inspect, recover

Use `Start Brann Desktop.cmd` or `Start Brann VR.cmd` as usual; close the old game first so it reloads source. `Stop Brann.cmd` ends the managed processes. For a quick source check from the project root:

```powershell
& '.\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --path godot --editor --quit
& '.\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --quit-after 4000 -- --expedition-check
& '.\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --quit-after 3500 -- --weather-game-check
```

Native startup, runtime and weather logs remain under `logs/`. The specific prior source files are preserved in `backups/environment-sprint-20260925/`; remove the three new kit files and restore those backups to reverse this sprint. The isolated lane handoffs document how to rebuild each asset and run its capture harness. This project is not currently a Git repository, so there is no sprint commit or upstream push.

## Next checks

Play in the headset for real frame time, canopy/LOD comfort and axe contact on the new trunks. Test the hanging apples with Knuckles grip. The quarry's existing nearby rock ring still hides some distant mesas; changing that boundary needs a traversal pass. The tree shader does not currently accumulate settled snow on the canopy, though the existing ground weather system is intact. Weather is currently configured for five core outdoor zones; the newer outer zones keep the correct horizon tint but do not yet receive rain or snow. The weather overlay's whole-scene scan is an existing stereo performance concern that needs a headset measurement before changing the weather system. The deferred Cloudbreak bridges and Pinewood arch should only be added after their collision routes are checked in the full scene.
