# Enemy surface contact

Emberwing previously stopped at an enemy's interaction collider, then inferred a headshot from proximity to the animated head. Combat now shares `enemy_projectile_contact.gd`: the nearest visible enemy triangle competes with the nearest real world obstruction.

Emberwing and Siegebird use the same skeleton damage policy: an ordinary skeleton's actual skull hit kills; individual body hits remain nonlethal. Named guardians retain their stronger health and headshot multiplier. Fairy darts retain their own small normal/critical damage. Embedded arrows follow the struck surface, including moving bones and detached death remains.

The query covers skeletons, rats, golems, wisps, bosses, ghosts and awakened trees. Animated rigid pieces use current transforms; weighted guardian meshes use their posed skin. Missing bones and hidden armour are excluded. Walls win when nearer. Interaction prompts, grabbing and locomotion retain their broad colliders. Shared queries also serve VR tool sweeps, desktop melee contact, fairy projectiles, chakrams and declarative returning projectiles.

## Performance and limits

Cached topology, conservative actor/mesh bounds and per-frame skin baking avoid building heavyweight triangle physics bodies. Weak references periodically prune destroyed resources. Gameplay zones and alive/visible state restrict candidates. Primitive meshes support both indexed and unindexed triangles.

Measured headless checks: 1,000 warmed sweeps in an installed scene with 32 enemies and seven rats took 95.209–120.187 ms across two runs. Three authored guardian fixtures measured cached queries at 0.385–0.416 ms each. These are CPU query measurements, not headset framerate certification. Many simultaneous close skinned actors still deserve profiling. Shader-only displacement, alpha cutouts and visual microdetail do not change CPU triangles. Area spells retain deliberate radius semantics; free rigid-body movement still uses physics colliders.

## Verification and recovery

- Actual Emberwing flight: 42 assertions cover broad-box misses, bone gaps, fatal skull contact, nonfatal rib contact, moving embeds, wall precedence and installed enemy families; 8.702–10.176 s.
- Existing archery runner: 39 checks pass, including wall embedding and surface movement.
- Weighted guardian contact runner: all variants pass; 0.679 s.
- Fairy runner: 79 checks pass; 9.161 s.
- Service integration passes in 74.393 s; service unit tests also pass.

An additional returning-projectile lifecycle test failed at `living_projectile_checks.gd:118` because the fixture no longer held the recalled ring. Repeating with the original HEAD version of `living_projectiles.gd` reproduced the identical missing dictionary key and 20 s timeout. This is an existing fixture/lifecycle issue, not claimed as passing or corrected here; its minimal fake game follows the unchanged raw-ray fallback.

Run the actual-game fixture using bundled Godot with `--headless --xr-mode off --audio-driver Dummy --path godot --script res://arrow_surface_checks.gd -- --world-builder-check`. Use `--script res://enemy_projectile_contact_checks.gd` for the resolver fixture, and `--script res://skeleton_projectile_contact_checks.gd -- --world-builder-check` for guardian skins. Existing bow checks run through Main's `-- --phoenix-bow-check` flag. Fairy checks use `--script res://fairy_checks.gd -- --weapon-inspection --experimental-fuel-combat`.

Inspect explicit failures and script-error output, not exit code alone. Logs and measured work durations are under ignored `logs/`. Relaunch normally to load; live games, SteamVR and saves were preserved. No headset playtest was performed.
