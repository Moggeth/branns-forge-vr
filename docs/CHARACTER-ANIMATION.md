# Character animation and physical remains

Implemented September 13, 2026. This supersedes the skeleton-only pilot where the
user expanded authorization to animation plus real physical death pieces. No new
minotaur was added: its NPC/enemy role remains undecided. Multiplayer and broader
asset-generation work remain deferred.

## Modules and extension boundary

actor_animation.gd builds named rigid joints from the existing visual meshes,
a body visual root, AnimationPlayer idle/walk/attack clips and per-species
PROFILES. Gameplay/collision stays on the actor root. Pose sampling reads actual
travel distance or the authoritative combat_progress value. Clips are sampled
explicitly with paused playback so a second clock cannot drift from combat.
There is no AnimationTree yet: three controlled clips do not require a blending
graph. Future skinned rigs can implement the same pose/state contract.

The current body grouping uses authored part positions in world_zones.gd and
workshop_scene.gd. New proportions should supply explicit part assignments or
adapt this grouping; arbitrary imported creatures are not automatically rigged.
Enemy data/AI has not been completely rewritten into a universal definition
framework. PROFILES and named joints are the narrow first reusable boundary.
Character forward is +Z; camera/aim remains -Z. The rat facing mismatch was also
corrected while adding its gait. Brann's existing gaze/beard controls remain intact.

adventure_runtime._step_attack owns wind-up/strike/recovery and the damage-once
flag. Timing values are snapshotted when an attack starts. Death wins over attack;
respawn resets timing and visual poses. Out-of-range enemies abandon old attacks.
Hit recoil does not imply gameplay stagger. No root motion, full-body IK or
terrain foot placement has been introduced.

physical_remains.gd reparents actual visible piece nodes into rigid bodies at
unchanged world transforms, with simple fitted box colliders. Head details remain
one head piece. This is disassembly physics, not a connected joint ragdoll. Body
mass is bounded; collision bits 1/8 keep interaction with the world and remains.
An inactive actor keeps templates to make a fresh rig when it respawns. Template
nodes are freed on shutdown. Held bodies freeze and disable collision; normal
release restores real physics instead of entering the old kinematic throw list.
Player-thrown debris can deal bounded impact damage with per-body cooldown. Dead
actors are checked before loot/debris, preventing duplicate deaths/rewards.

Lifetime: 90 s for loose bodies, cap 120, protected while held/holstered. Release
refreshes lifetime. Old unprotected bodies are removed first. All remains are
session-only; no resource credit is awarded for repeatedly picking them up.
Permanent crafting drops remain separate. Sleeping bodies and inactive zones
limit simulation work. Sound is a local short synthesized clack with six-voice
and global cadence limits, controlled by the existing Effects volume setting.

## Iteration and observability

Native/service tuning has seven enemy.* keys and 37 total values. The offline lab
uses godot/tuning_schema.json, generated from service/tuning.js; a service test
checks exact schema consistency. Refresh it with:
node -e "require('fs').writeFileSync('godot/tuning_schema.json',JSON.stringify(require('./service/tuning').SCHEMA,null,2))"

The lab is started with Start Animation Lab.cmd (desktop) or Start Animation
Lab.ps1 -VR. It is offline and owns a recorded game process, so Stop Brann.cmd
remains the shutdown path. Finish active conversation/build work before switching.
Controls are native world buttons; B/Tab > Tuning edits local lab values. Joint
markers and forward/floor guides expose orientation mistakes. Gameplay damage is
not exercised by the lab's looping attack preview; integration tests cover it.

REMAINS logs record piece counts. Optional actor_animation.debug_states enables
state-transition logs without per-frame spam. Verify Brann.ps1 covers service,
audio mocks, GDScript parsing and native fixtures. ACTOR_CHECKS verifies articulation,
stopping gait, wind-up/strike timing, damage once, physical pose continuity,
death-once, dead-attack cancellation, pickup/release, floor collision, thrown
impact/cooldown, independent respawn and cleanup cap with held-item protection.

Actual wind-up and exploding-skeleton previews were rendered with:
--animation-lab --capture=<absolute png> [--lab-death]
The final complete check passed in 23.34 s; native integration took 22.14 s.
Preview renders are not evidence of sustained headset performance with a crowd.
Headset comfort, enemy character and debris load still benefit from playtesting.
