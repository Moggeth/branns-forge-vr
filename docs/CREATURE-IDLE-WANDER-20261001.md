# Idle creature movement — 2026-10-01

Awakened Ents and living skeletons take short seeded walks after 12–29 seconds of rest. Each destination is within three metres of the original home, and routes remain within a 4.5-metre validated save bound. An active target cancels the idle route immediately. Calm Ents keep their guardian attack and apple duties; a nearby hostile creature suspends their walk. Existing root displacement drives the Ent presentation and skeleton walk rig. The original tree remains the Ent body, so its mesh and collision travel together.

The Orchard uses the authoritative landscape navigation grid, rejecting blocked/wet destinations and cancelling a route on a terrain edit. Other zones sample ground and grade along the short route. Hidden zones do not acquire routes or move. Ent X/Z displacement and heading are optional fields in the existing bounded record; restore places the original tree at the saved location and conforms it to the current terrain. The record is saved at most every three seconds while moving or turning, without adding a new scene body.

Focused offline checks:

| Step | Outcome | Measured seconds |
| --- | --- | ---: |
| Initial source and guidance inspection | Found shared enemy movement, existing animation and navigation | 1.9 |
| First whole-scene parse/check | Failed: `World3D` inference in adventure runtime | 7.3 |
| Repaired expedition parse/check | `EXPEDITION_RESULT []` | 7.8 |
| Seeded planner, blocked/water route and record check | `CREATURE_IDLE_WANDER_RESULT` with no failures | 0.6 |
| First real-scene Ent check | Failed: test remained in hidden Forge zone | 9.9 |
| Repaired real-scene Ent/skeleton/animation/persistence check | `CREATURE_IDLE_WANDER_SCENE_RESULT` with no failures | 8.9 |
| Existing living skeleton structure/combat check | `SKELETON_COMBAT_RESULT []` | 8.0 |
| Existing Ent lifecycle check before fixture repair | Two heat/water fixture failures | 8.5 |
| Ent lifecycle check after active-zone repair | `WORLD_BUILDER_ENTS_RESULT {"failures":[]}` | 8.5 |

The old Ent lifecycle fixture called `heat_contacts.water` while the adventure was still in the Forge Yard. That method returns immediately when the requested zone differs from the current zone; its later heat fixture has the same active-zone guard. The fixture now travels to the Orchard before exercising heat/water, and the full lifecycle passes. For any real-scene Ent check, enter the Orchard before ticking the creature. A parse failure can still leave the main game running and flood the console; use `--quit-after` for parser-only checks and fix the first `SCRIPT ERROR` before repeating a scene run.

Commands (from the repository root, bundled Godot):

```powershell
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://creature_idle_wander_checks.gd
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://creature_idle_wander_scene_checks.gd
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_ents_checks.gd
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --quit-after 1 -- --skeleton-combat-check
```
