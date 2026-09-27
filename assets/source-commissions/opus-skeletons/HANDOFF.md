# Skeleton Guardians — handoff

Three shield-bearing skeletons for Brann's Forge: **Mossward** (Pinewood Ruins), **Prismwatch** (Crystal Hollow) and **Cinderkeep** (Ember Foundry). Each one comes with source, assets, stealable shield logic and a local check. The authored source is inside `work/opus-skeletons/`. The coordinator installed and integrated the GLBs and a patched copy of the logic in `godot/guardians/` after this original artist handoff.

## Integration update (2026-09-25)
The live scene now attaches all three variants, routes grip/trigger/damage/movement through this module, and imports the authored GLBs. Coordinator fixes in the installed logic are synced back to `logic/skeleton_guardians.gd`: imported mesh ownership, dropped-shield pickup metadata, tug cancellation on grip release and template cleanup. `godot/guardian_checks.gd` tests the actual game scene, including physical pickup and release, frontal guard, theft, death drop, duplicate prevention and ghost fire exclusivity. `GUARDIAN_RESULT []` and `SIEGEBIRD_RESULT []` pass. Close-up scene captures are in `outputs/skeleton-guardians/`. VR grip feel and frame time are not yet measured on a headset.

## Layout
```
builder/build_guardian.py         one reproducible Blender 4.5.13 builder for all three
assets/<variant>/<variant>.blend  editable source scene (character + standalone shield beside it)
assets/<variant>/<variant>_guardian.glb   character: exactly 7 top-level MeshInstance3D groups
assets/<variant>/<variant>_shield.glb     standalone shield prop, origin at the central grip
assets/<variant>/manifest.json    asset manifest (pivots, tris, materials, grips, tip, broad-phase box)
assets/<variant>/renders/         front, side, back, hero, shield_rear PNGs
logic/skeleton_guardians.gd       game logic module (Godot 4.7.2 GDScript)
check/run_check.gd                headless Godot import/geometry/contract + logic smoke test
check/check_report.json           last check output
project.godot                     local check project only (Blender import disabled)
```
Rebuild: `../../tools/blender-4.5.13-windows-x64/blender.exe -b --factory-startup --python builder/build_guardian.py -- all` (add `--no-render` to skip renders).
Check: `../../tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --path . --import`, then `... --headless --path . -s check/run_check.gd` gives **CHECK PASSED** (last run).

## Counts (from the check report)
| Variant | Height | Character tris (incl. shield) | Materials | Shield prop tris | Shield open edges |
|---|---|---|---|---|---|
| Mossward | 1.62 m | 16,052 | 15 | 3,744 | 0 |
| Prismwatch | 1.64 m | 13,944 | 12 | 1,388 | 0 |
| Cinderkeep | 1.57 m (stocky) | 16,700 | 13 | 4,044 | 0 |

Material counts are the unique materials across the 7 groups. They're all flat-colour PBR: no textures, 2 emissive (Prism glimmer and crystal, Cinder vents), 1 alpha-blended (Prism crystal). None of the GLBs have cameras, lights or external textures.

## Contract notes
- **Axes:** +Y up, +Z forward, toes at y=0. The heights above were checked in Godot.
- **Groups:** `Head` (pivot at neck), `Torso` (pivot at lumbar), `LeftArm`/`RightArm` (shoulders), `LeftLeg`/`RightLeg` (hips) and `Shield` (pivot at its central grip, left side at x≈-0.44, face toward +Z). Each group is one joined mesh made of separate bones: condyle knobs, individual vertebrae, open ribs, finger segments, toes. They should still read as bones once death turns them into rigid bodies. Exact pivots are in each `manifest.json`.
- **Shield prop:** origin = central grip, forward normal `(0,0,1)`, grip axis `(0,1,0)` (vertical bar).

| Shield | Rim grip (local) | Item tip | Broad-phase box center / size |
|---|---|---|---|
| Mossward kite | (0.245, 0.0, -0.005) | (0, 0.499, 0.086) | (0,-0.019,0.066) / (0.655, 1.037, 0.183) |
| Prismwatch hex | (0.267, 0.0, -0.005) | (0, 0.563, 0.090) | (0,0,0.086) / (0.776, 1.232, 0.225) |
| Cinderkeep door | (0.244, 0.0, -0.005) | (0, 0.478, 0.087) | (-0.018,0,0.064) / (0.744, 0.957, 0.177) |

Every shield is a closed solid with a thick metal rim (≈5–7 cm band, 9–13 cm deep including the studs). The back has a leather-wrapped central bar on two brackets and a curved rim grip near the leading edge. On Cinderkeep I departed from the reference sheet: its back is an iron core with a copper heat plate and straps, **no exposed wood** near the vents.

## Integrating the logic
`skeleton_guardians.gd` does the mechanics itself. The live game only needs these small hooks:

```gdscript
# where game systems are set up, after game.animation.setup(self):
guardians = preload("res://guardians/skeleton_guardians.gd").new()
add_child(guardians); guardians.asset_dir = "res://guardians/assets"; guardians.setup(self)
for e in scene.enemies:  # choose variant by zone
    if e.get_meta("enemy_type","")=="skeleton":
        guardians.attach(e, {"pinewood_ruins":"mossward","crystal_hollow":"prismwatch","ember_foundry":"cinderkeep"}.get(str(e.get_meta("zone","")),"mossward"))
# in _process, AFTER animation.tick(delta):
guardians.tick(delta)
```
1. `adventure_runtime.gd` `hurt_enemy`, right after the ghost branch and the `alive` check:
   `if game.guardians!=null: damage=game.guardians.filter_damage(enemy,damage,hand,damage_type)`
2. `adventure_runtime.gd` `take_damage`, first line after the guard clause:
   `if game.guardians!=null: amount=game.guardians.player_guard(amount,source)`
3. `item_interactions.gd` `trigger`, after `item` is validated:
   `if game.guardians!=null and game.guardians.trigger(hand,source): return true`
4. `melee_contact.gd` `handles()`: append `and not item.get_meta("guardian_shield",false)`. Bashes are then dealt only by the module, which stops double damage. Without this patch, a held shield would *also* strike via its tip raycast.
5. The grip handler (not in the contract copies): when an empty hand grips, call `if game.guardians.grip(hand): return` before the normal nearest-pickup search. This starts the rim tug; the player then pulls about 28 cm within 1.4 s to yank the shield.
6. Optional: multiply player locomotion by `guardians.movement_multiplier()` (0.85 while holding the Cinderkeep door). Enemy projectiles can call `guardians.deflect(point, velocity)`, which returns a reflected velocity, or `Vector3.ZERO` if the shot isn't blocked.

`attach()` replaces the placeholder `world_zones` skeleton meshes in the existing rig. It creates one piece per group, moves the rig joints to the authored pivots, and hangs the shield from `arm_l` **outside** `rig.homes`. That way `remains.shatter` and `animation.restore` never duplicate it.

### Rules implemented
- **Enemy guard:** a carried shield blocks hits from the front cone (by actor facing). Frontal hits are capped at 26 before the multiplier, so a fast swing is no longer an instant kill head-on:

  | | Physical | Projectile | Fire | Blast |
  |---|---|---|---|---|
  | Mossward | ×0.35 | ×0.5 | ×1 | ×0.7 |
  | Prismwatch | ×0.55 | ×0.15 | ×1 | ×0.8 |
  | Cinderkeep | ×0.25 | ×0.35 | ×0.5 | ×0.6 |

  Blocked damage wears down integrity (70 / 60 / 110). At 0 the shield cracks loose as a world item. Guardians raise and turn the shield toward the nearest player hand, drop the guard during their windup (the opening), and drop it completely while exposed. Mossward rattles its head nervously; Prismwatch tilts its head curiously.
- **Stealing:** you can yank the shield (grip the rim, then pull), break it off, or take it from the corpse after death. The same live mesh moves into one `RigidBody3D` item (`id guardian_shield_<variant>`, `kind weapon`, group `pickup`, box collider from the manifest).
- **No infinite copies:** there is one shield per guardian lineage. A respawned guardian only regrows its shield once the old item no longer exists. Unclaimed items despawn after 150 s; held or stowed ones never do.
- **Held shield:**
  - *Primary bash:* swing face-first above 1.8 m/s (1.5 for the door). Damage is 20 / 18 / 30 × speed factor, with cooldowns of 0.45 / 0.5 / 0.9 s.
  - *Throwing* deals 8–30 damage.
  - *Facing an attacker* reduces incoming damage to ×0.5 / ×0.6 / ×0.3.
  - Each item keeps its own cooldown and variant in its metas.
- **Secondary actions (trigger):**
  - **Rootbeat** (7 s cooldown): living non-ghost enemies within 3.4 m are slowed for 2.5 s; the player gets a 1.2 s guard via `shield_until`; expanding leaf ring and a low thump.
  - **Prism Chime** (8 s cooldown): skeletons, golems and the boss within 3.6 m have their attack cancelled into recovery and are slowed. Their weak spot is exposed for 3.5 s (2 s for the boss), taking ×1.5 damage (the boss's own ×2 also applies) and losing their shield guard. Restrained lavender ring and a three-partial chime.
  - **Bellows Bash** (6 s cooldown): 3.4 m cone, 28 **fire** damage, which includes ghosts; flame puffs and a whoosh.
  - **Ghosts** are only ever touched by Bellows Bash (fire). A bash that passes through a ghost shows "only fire harms ghosts".
- **Tooltip:** `use_instructions` is set on each item, and `item_interactions` already displays it. The text is also in `VARIANTS[v].controls`.
- **Sounds** are synthesized in code (no files), capped at 6 at once, and skipped when headless or offline.

## Animation notes (for the live rig)
- **Idle/walk:** the module overrides `arm_l` every frame (after `animation.tick`) so the walk swing doesn't flap a 1 m shield: the swing is scaled to 30%, plus the guard pose.
- **Shield raise:** `arm_l.x → -0.35 rad`, yaw toward the threat (clamped -0.6…0.35), slight roll inward. Blend rate is 4/s (2.5/s for Cinderkeep, which reads as heavy).
- **Suggested bash clip:** over 0–0.4 of the attack, pull the shield in (`arm_l.x +0.25`) with the torso twisted 0.15 rad; over 0.65–0.8, punch it forward (`arm_l.x -0.9`, body lean -0.12); recover by 1.0. Cinderkeep should use a 1.3× longer windup. The current contract clip only swings `arm_r`, and that still reads fine as a claw swipe behind the raised shield.

## Known limitations / honest caveats
- **Not tested in a headset.** I haven't tested VR performance, grip feel, or how the shields' weight feels. Everything was checked only with Blender renders and the headless Godot mock test, which runs the real `actor_animation.gd` against a mocked game. The live grips system wasn't available here, so hand orientation on the central grip and the freeze/release path (the item is in group `pickup`, not in `remains.bodies`) need a live check.
- **Hand fit:** the fist on the character's own shield wraps the grip bar approximately; up close, the fingers float a few mm off the bar on Cinderkeep.
- **Surface detail:** crystal facets and glimmer are simple geometry, and the moss is flat colour, not painted. This is deliberately stylized and has no textures.
- **Materials:** 12–15 per character is more than strictly needed. Bone, socket and bracket materials are already shared by name, so an atlas pass could cut this.
- **Guard facing:** frontal blocking uses the actor's facing plus the hand/camera position. It isn't a true shield-collider hit test.
- **Tuning:** the damage numbers are first-pass values.
