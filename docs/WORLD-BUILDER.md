# Orchard world-builder: one live world, two local perspectives

The current playable slice is **the 320 × 320 m Orchard Highlands**. The Hero's VR/desktop scene and the elevated native Godot window use the **same `World3D` and the same running simulation**. The second window is a controller and camera, not a copy of the map. A tree planted from above visibly grows for 2.4 seconds in front of the Hero; a worker's tree felling, path carving, bridge construction, and skeleton patrol all happen in the scene the Hero can walk through. Chopping an authored orchard tree with Orchard's Edge changes the strategic ledger immediately.

This is **same-PC asymmetric play**. One person can wear the Vive Pro 2 while another uses the mouse and keyboard in the builder window. A networked second machine, remote invitation codes, a separate settlement screen, and a seamless merge of all existing zones are not implemented. The Orchard itself is one broad continuous zone; existing portals remain travel between other zones.

## Playing

From **Brann's Forge Launcher**, choose **World Builder — develop the orchard**, select **VR headset** for a Hero in VR or **Monitor / projector** for a desktop rehearsal, then start. The launcher handles SteamVR initialization as on the normal VR path. On an already-running normal game, press **F9** in the game's desktop mirror to open the builder without restarting; F9 in the builder closes it. The Hero can travel to Orchard Highlands through the Pinewood route. Launching the World Builder role starts the Hero in the orchard so both players can try it immediately.

The builder window uses `1`–`5` for tools, `6` to hire, left-click to act, two clicks to lay a path, `WASD` to pan, right-drag to orbit, the wheel to zoom, `F` to follow the Hero, `F11` to fullscreen, and `Esc` to cancel a half-drawn path or close the window. The window's 30/60 fps and 50/65/100% render controls affect **only its secondary viewport**. It starts at 30 fps / 65%, stops drawing while minimized, and drops to 20 fps / 50% if the live VR frame rate stays below 72 fps for two seconds after warmup. That protects VR priority but is not a substitute for headset measurement.

| Action | Cost and result |
| --- | --- |
| Mark timber | Point near one of the ~399 actual scenic trees or an interactive lumber tree. A helper walks to it, chops, carries a visible log home, then adds lumber to the settlement stockpile. A felled tree stays a stump. |
| Carve path | Two points, 3–36 m apart. Costs one aether per started 7 m. A walkable-width earth ribbon and an authored waymarker appear; trees and colliders in its corridor are cleared. |
| Build bridge | Three stockpiled lumber at the marked Windfall Brook crossing. The authored stone-and-timber bridge has tagged deck/rail collision and can be crossed in first person. The shallow brook remains wadeable. |
| Grow grove | Three aether. Three harvestable trees grow visibly; up to 24 groves. |
| Muster bones | Four aether. A violet warning gives the Hero 1.7 seconds, then three improved Mossward skeletons appear in the same world. Their deaths remove the units from the strategic state. At most eight patrol groups (24 skeletons) coexist. Cannot be placed within 7 m of the Hero. |
| Hire helper | Two delivered lumber, up to five workers. Independent workers pick up marked tree jobs. |

Aether starts at 12, regenerates slowly to 20, and is shared between paths, groves and encounters. Lumber only becomes spendable when a worker reaches the stockpile, or when the Hero fells a scenic tree. Orchard's Edge takes three blade strikes at roughly the same height to fell one of those trees. This settlement stockpile is currently separate from the Hero's crafting pouch; merging the two economies needs an explicit balancing decision.

## State and lifecycle

`godot/world_builder_runtime.gd` owns the authoritative world state and is constructed during **every ordinary launch**, including launches without the builder window. `godot/world_builder_view.gd` only issues actions and renders that `World3D`. The persisted bounded ledger is `user://world_builder_v1.json` (on this PC, under Godot's `app_userdata/Brann's Forge VR`). It contains grove/path/bridge placements, felled and marked tree addresses, workers, aether/lumber, timber in transit, and surviving patrol slots. It writes through a temporary file and atomic rename, autosaves regenerating aether about every 15 seconds, and saves at every discrete action. An invalid/oversized file is left untouched and blocks replacement; inspect the game log before recovery. Offline checks use an isolated temporary path and never read or write the player's settlement.

The initial forest is still authored in batched `MultiMesh` chunks. Each tree placement has an address. Clearing a tree hides only its corresponding near/far mesh instances and disables its trunk shape; it does not rebuild the 320 m forest. Paths are one mesh per segment. The river is one mesh. Authored waymarkers are capped at 24 instances even if the path ledger reaches 96 segments. Workers have Opus-authored idle/walk/chop clips; at most five are active. The stockpile has three primitive collision proxies. The imported bridge's deck and parapet colliders are gameplay-tagged `floor`/`solid`, so the Hero's existing locomotion query can cross it.

The compact builder layout follows the Opus 5.5 UI commission's scene-first palette, readable status, feedback and camera controls. The full spec in `assets/worldbuilder/orchard_kit/BUILDER-UI.md` sketches further route splines, richer ghosts, costs at the cursor and Director follow; those are future design directions, not a claim that every control in the spec is live.

## Assets and rebuilds

- Playable bridge: `godot/assets/worldbuilder/orchard_bridge.glb`; editable source, deterministic builder and review image: `assets/worldbuilder/orchard_bridge/`. This is the previously reviewed Opus bridge from the orchard 2D-to-3D study.
- Playable worker, stockpile and waymarker: `godot/assets/worldbuilder/{worker,stockpile,waymarker}.glb`. The full Opus 5.5 commission, editable `.blend`, deterministic builder, validation script, textures, reports and review renders are in `assets/worldbuilder/orchard_kit/`.
- Rebuild the kit from its source directory with `blender --background --factory-startup --python build_orchard_kit.py` and then `blender --background --factory-startup --python validate_kit.py`. Review the renders/import inventory before copying the three new GLBs into `godot/assets/worldbuilder/`; do not replace the approved playable files silently.

The Claude child environment was cleaned of Anthropic/API overrides, and `claude auth status` verified `fauxgrady@gmail.com`, `authMethod: claude.ai`, an active Pro subscription and explicit `claude-opus-5-5` metadata. The isolated commission stayed in ignored `work/opus-worldbuilder-20260928/`; measured CLI wall time was 699.21 s. Codex reviewed and integrated the assets; no Claude-generated game code was merged.

## Verification and limits

Run from the project root:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_checks.gd -- --world-builder-check
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_visual_check.gd -- --world-builder --world-builder-preview
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_stress_check.gd -- --world-builder --world-builder-preview
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File launcher/launcher.ps1 -Validate
```

The named result `WORLD_BUILDER_RESULT {"failures":[]}` verifies same-scene dual camera, timber delivery, authored forest clearing, Hero axe changes, grove growth, path/bridge collision, active and defeated skeleton patrols, a save/load round trip, and builder window lifecycle. Review `outputs/world-builder-live.png`, `world-builder-ground.png` and `world-builder-camp.png` for the overhead map, walkable crossing and work site. The graphical stress check held **24 authored skeletons plus the tactical viewport at the 120 fps desktop cap** in 12.1 seconds on this PC, with 30 fps / 65% tactical settings. That is a useful catastrophic-regression check, **not an HMD frame-time or stereo-performance measurement**. Playtest in the Vive Pro 2 before raising population caps.

Current limitations: helpers walk directly to tree coordinates instead of using navmesh pathfinding and can pass through obstacles; a harvested scenic tree disappears into a stump rather than playing a full falling/ragdoll sequence; bridges are at one surveyed crossing, not freeform spanning; river water is shallow and has no current or wetness effects; paths clear trees but not every pre-existing rock or ruin; patrols are a bounded encounter tool rather than army formations. A forest fire does not yet burn its individual authored trees into settlement state. These are concrete next extensions of the shared-world model, not separate mode-specific simulations.
