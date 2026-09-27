# Native adventure interaction contract

`godot/adventure_runtime.gd` owns native tools, bomb formation/throw physics,
harvesting, enemy combat, player health and death-cache presentation. `main.gd`
retains the live model importer, service bridge and OpenXR/desktop input.

## Controls and progression

Desktop: WASD movement, hold right mouse to look, Q/R snap turn, T floor
teleport, E pickup/drop, left click to strike/select. Number keys 1–8 choose
hammer, axe, pick, bomb glove, grapple, lantern, resonator and gauntlet. Hold
left mouse for at least 0.6 seconds with the bomb glove, then release to throw.
F cycles destinations; G travels; U hands in the next workshop offering.
Physical boards provide these tools, upgrades and destinations in VR. H is
the optional legacy five-tail favour exchange, V retries the voice companion.

VR: squeeze grip to pick up a nearby item; release naturally drops or throws
it. An empty squeeze forms a freely replenishing bomb in 0.6 seconds. Releasing
before readiness cancels it. Held weapons use physical swept-tip strikes or
trigger attacks. Knuckles squeeze uses separate press/release thresholds
(0.6 / 0.25) to avoid chatter. Linear and angular velocities come from XRPose,
transformed from tracker space through the player rig; finite-difference hand
motion is the fallback. Bombs use Godot rigid-body collision and gravity.

Each tool has a named procedural silhouette. Generated equipment still imports
real validated GLB models while playing. Its JavaScript runs only in the service
QuickJS sandbox; no generated engine scripts are imported. Metadata haptic
profiles configure formation/readiness/release/impact amplitudes, seconds and
frequency within bounded ranges. Runtime diagnostics send actual interaction
phase, controller tracking, equipment, zone, targets and health to Brann.

Tier 1 basics are free. Tier 2 costs three lumber plus three stone, or three
rat tails. Tier 3 requires three iron and three haunted bones. Tier 4 requires
the Ember Warden's single core and permanently lights the forge. Existing
owned tools can be selected anywhere; first issuing an unlocked tool and
upgrades happen with Brann. Creative travel through portals is always allowed.

Axes harvest marked timber, picks harvest ore/crystal, lantern/resonator magic
harvests enchanted nodes, and hand pickup collects apples and dropped enemy
materials. Picking apples also restores 15 health. Harvesting takes one action
and yields at most five materials; renewable nodes return after 35 seconds.
Bombs and resonators open barriers. Grapple anchors use an instant comfort
teleport with collision-checked floor arrival. Teleport never drags the camera.

## Consequences and encounters

Enemies move slowly and telegraph close attacks for 1.2 seconds. Skeletons
have 66 health, wisps 44, golems 110 and the Ember Warden 440. The Warden also
marks a ground circle for two seconds before an avoidable eruption; its core
is exposed for three seconds afterwards, doubling incoming damage. Basic
bombs deal 45 enemy damage and 65% of that to the player within their radius.
Bombs detonate shortly after impact or after a 2.6-second flight fuse.

At zero health the service moves carried resources into a glowing satchel,
returns the player to Brann and restores health. Tools and permanent tiers
remain. Another death merges the old satchel's contents and relocates it.
Grip or select the satchel nearby to recover. The native client owns health
and combat simulation; the service persists resources/milestones and validates
idempotent gathering/recovery requests. Offline service failures leave nodes
collectable and report that progress has not been saved.

## Verification and recovery

Use `--headless --xr-mode off` for desktop parser/runtime checks. Omitting
`--xr-mode off` on this machine triggered an unavailable-headset OpenXR modal
and stalled a parse check for over ten seconds; the explicit flag returned
the parse result in 0.3 seconds. Do not retry headset initialization for code
checks. Actual tracked Knuckles throws, physical haptic feel and headset
comfort still require the user's hardware playtest.

`--runtime-check` and `--capture=... --capture-zone=<id>` disable all service
requests so existing voice companion tabs cannot start a paid session from a
visual diagnostic. Captures honor the scene's camera metadata and hide HUD.
They log desktop FPS/draw counts, which are not headset performance claims.

`--adventure-smoke --service=http://127.0.0.1:8788` is for the isolated service
integration harness only. It exercises actual scene/resource/physical-release
code, crafting and all four tiers, boss loot, self damage, merged death-cache
recovery, anchor arrival and generated abilities in a remote zone. The harness
also retains the late-loaded offline GLB/JavaScript fixture legacy test. No
paid generation or live voice is part of verification. Runtime game events and
uncaught errors remain captured by Godot's configured `user://logs/game.log`.
