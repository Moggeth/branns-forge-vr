# Orchard World Builder

Choose **World Builder** in the persistent launcher, select VR or Monitor / projector, then start normally. **F9** opens the strategic view during desktop play and switches the primary perspective while it is open. Both live perspectives remain visible in one presentation window. Its cameras render the Hero's actual Godot `World3D`: terrain, weather, enemies, trees, structures and avatar share one simulation. This is local asymmetric play on one PC; remote multiplayer is not implemented.

[Shared-world direction](RTS-SHARED-WORLD-DIRECTION.md) describes the next dependencies. [September 30 evidence](RTS-SHARED-WORLD-20260930.md) records the earlier sources; [October 1 physical/art/dual-view pass](STARFALL-PHYSICAL-RTS-20261001.md) records the current verification and limits.

## Controls and Mana

The original Opus 5.5 panel now has a Sonnet 5.5 refinement: an animated Tidal Glass Mana orb, horizontal category icons, readable wrapped card labels, cost/clock/gesture symbols and Lumber/Helpers icons. Seed is absent from the resource strip. Text draws at native resolution independently of the secondary 3D render scale.

- **F1–F4** select Land, Life, Construction and Encounters; **1–9** select a card in that palette.
- Click a point for radial spells or choose two endpoints / drag a line for linear spells. Successful casts retain the selected spell.
- **Right-click** or **Escape** cancels targeting. **F9** switches between the Hero and strategic primary view. **F11** toggles fullscreen.
- **WASD** pans, right/middle-drag orbits, wheel zooms. **F** finds/follows the Hero.
- Hover cards for cost, description, gesture, cooldown and failure reasons. Construction previews show the actual lumber cost. Every implemented spatial action has its own animated, terrain-conforming preview; these include Sundering's shoulders, forest corridors, exact prospective tree positions, the tree-ring planting band, meteor crater and damage radius. Invalid placement turns the preview red and reports the reason; rejected casts show a brief fading red message.
- Drag the inset by its header, resize with its lower-right corner, or press **Swap views** / **Focus Hero** / **Focus RTS**. Window size, position, fullscreen and inset layout persist in `user://world-builder-view.cfg`. The Hero primary view restores its FPS HUD and clears the RTS panel/header from the weapon view.

Mana starts at 12 and caps at 20; old `aether` saves migrate without resetting reserves. **Testing 4×** regeneration defaults to 0.22 Mana/second, against normal 0.055. The panel exposes both presets; tuning key: `worldbuilder.mana_regen_multiplier`. Failed placement spends nothing and starts no cooldown.

The strategic camera starts at **120 fps / 65% resolution**, with selectable 60 fps, 30 fps or uncapped redraws. It pauses while minimized and can reduce to 20 fps / 50% when VR remains below 72 fps after warmup. The secondary world view uses one shared-world SubViewport; the Hero picture reuses the existing root viewport texture and adds no third camera. During desktop RTS play the small Hero view can reduce its 3D scale to fit the inset; swapping or closing restores its original scale. Native UI stays crisp. The RTX 3080 Ti benchmark sustained about 120 fps at 1280×800 with both cameras active; this does not establish 4K or Vive Pro 2 performance.

| Palette | Shortcuts in order |
| --- | --- |
| Land / F1 | 1 Path; 2 Sunder; 3 Raise Earth; 4 Earthen Wall; 5 Starfall; 6 Crystal Fault |
| Life / F2 | 1 Grove; 2 Forest line; 3 Tree Ring; 4 Awaken Ent; 5 Mark Harvest; 6 Hire Helper; 7 Calm Ent; 8 Plant Magical Seed |
| Construction / F3 | 1 Bridge; 2 Ramp; 3 Stairs; 4 Boardwalk; 5 Outpost; 6 Tower; 7 Platform; 8 Gate; 9 Barricade |
| Encounters / F4 | 1 Skeleton Patrol; 2 Assemble Golem |

Outpost, Tower, Platform, Gate, Barricade and Assemble Golem are **unavailable future entries**. No resources are spent on them. Terrain spells use the persistent primitives in [terraforming](TERRAFORMING-SPELLS.md). Starfall leaves mineable material; no meteor creature emerges yet.

## Free construction and resources

Bridge, ramp, stairs and boardwalk support manual two-endpoint placement. Length, grade, water, support height, standing trees, existing structures and lumber are checked before commitment. Decks, rails and terrain-grounded supports have real collision; worker routes include decks and invalidate when another structure is added.

Maximum lengths: bridge 32 m, ramp/stairs 18 m, boardwalk 36 m. At most 32 free structures persist. The old three-lumber authored bridge at the marked brook crossing remains compatible; native construction controls use free placement.

Workers chop marked trees and carry timber home before crediting the settlement. Hire Helper costs two delivered lumber, with at most five workers. Hero-collected scenic logs and defeated Ents credit settlement timber once; Ent logs have an already-credited tag to prevent double gathering. The settlement stockpile and Hero pouch remain distinct inventories.

The Sonnet 5.5-authored renderer uses shared timber textures and one mesh with six material surfaces per structure; a maximum-length boardwalk has 6,924 triangles. [Construction checks and constraints](CONSTRUCTION-VERIFICATION.md).

## Ents and physical consequences

Awaken Ent costs three Mana. An existing tree becomes the creature, retaining its trunk, canopy, identity, species and size. The Sonnet visual layer fits a bark face and articulated branch/root limbs to that trunk. At most eight living Ents coexist; defeated records recycle within the bounded ledger.

Pine Ents are tougher. Calm Ent costs two Mana and grants a 90-second guardian interval. Calmed Apple Ents provide real edible fruit, restoring up to 40 health across its bites when carried near the face. Production reuses a bounded fruit entry at most once every 30 seconds.

Shared fire ignites an Ent and makes it more dangerous; it emits heat through the existing contact system. Shared water quenches it with a brief reignition guard. This does not persist burning/felling for every decorative forest tree.

Defeat yields credited timber, a grabbable physical log and magical seed. Grip/gather the seed to recover it into the bounded settlement pouch; **Life / 8**, then valid dry soil, plants a persistent, harvestable tree of the original species. Invalid placement retains the seed; capacity is eight.

Claimed seeds, planted trees and source defeat persist. Loose fruit/log/drop positions are session physics, not a saved physics replay. Newly grown fruit-tree interaction needs a further registration pass.

## Encounters

Skeleton Patrol costs four Mana and warns for 1.7 seconds before three real enemies rise. Objectives: keep defeats within 14 m of the warning; clear within 45 seconds; or defeat the middle captain last. Up to eight patrols / 24 skeletons coexist.

A successful clear in a new 24 m sector earns up to two Mana; varying the objective from the previous reward can also grant one lumber. Each sector pays once, capped at 40 rewards. Objective, timing, kill order and reward history survive JSON save/reload. Ordinary skeleton loot and quest XP remain repeatable under the existing rules; this is not a complete anti-farming system.

## State, sources and verification

`world_builder_runtime.gd` owns state even when the survey window is closed. `world_builder_view.gd` issues commands and renders that world. The bounded ledger is `user://world_builder_v1.json`, under Godot's `app_userdata/Brann's Forge VR`. It saves placements, terrain/ecology references, Mana/cooldowns, lumber, workers/jobs, Ents, claimed seeds, patrols and rewards. Writes use temporary-file replacement. Invalid files remain untouched and block overwrite. Offline fixtures use disposable state.

The forest remains chunk-instanced with addressed trees; clearing updates near/far instances and trunk collision without rebuilding the entire forest. Original worker/stockpile/waymarker/fixed bridge sources remain under `assets/worldbuilder/`. New editable UI/Ent/construction commissions and verified metadata are in `assets/source-commissions/rts-20260930/`; installed `godot/world_builder_*.gd` files include reviewed integration corrections.

Run from this repository:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_panel_checks.gd -- --world-builder-check
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_ents_checks.gd -- --world-builder-check
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_construction_live_checks.gd -- --world-builder-check
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_encounters_checks.gd
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_panel_checks.gd -- --panel-capture
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_art_review.gd
```

Native captures: `outputs/worldbuilder-panel/`, `outputs/worldbuilder-art/`. Reviews exercise installed art and runtime facing, but do not replace an in-world/HMD playtest.

Remaining limits: navigation uses terrain/deck-aware grid steering, not a complete scenery navmesh. Later terrain edits can bury/expose decks; routes reject inaccessible crossings but structures do not repair themselves. Free structures are straight and grade-limited. Supply outposts, component golems, purposeful weather-bottle quests, remote sessions and talents remain future work.
