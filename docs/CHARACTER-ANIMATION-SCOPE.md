# Character animation: small foundation, expressive results

Proposal, September 13, 2026. This document scopes work; it does not implement
animation or change the running game. Multiplayer and general art tooling are
parked in DEFERRED-IDEAS.md.

## First playable result

One existing skeleton should visibly walk, anticipate an attack, strike, recover,
react to a hit and fall apart. Keep its current simple silhouette, basic chase
behavior, combat balance and rewards. Review it in VR before expanding the cast.
Idle breathing/settling is a small seventh pose, not a separate behavior system.

The intended improvement is readable weight and intention: a raised sword warns
of danger, a committed strike creates a dodge opportunity, recovery shows when
the enemy is vulnerable. These poses should communicate existing gameplay first;
new stagger, weak-point or attack-combo mechanics require a separate decision.

## Current code and focused changes

- world_zones.gd builds skeleton/wisp/golem/boss meshes mostly as flat children.
  Introduce named joint pivots and a visual root for the skeleton first, keeping
  the existing meshes parented with their world transforms preserved.
- adventure_runtime.gd owns chase, attack_at/rest_until, health and drops. Extract
  its attack timing into explicit phases with one authoritative clock: wind-up,
  strike and recovery. Preserve the current timings initially. Animation reads
  this phase/progress; it must not create a second damage clock.
- main.gd handles rats separately. Leave that path alone for the skeleton pilot;
  migrate rats only when their animation work starts.
- Brann already has separate head/beard pivots, gaze and speech animation. Preserve
  those; a later NPC profile can add gestures using the same layering principles.
- Death currently hides the enemy promptly. Disable gameplay interaction and
  resolve rewards once immediately, but keep a detached visual alive briefly for
  the death animation. Its cleanup must not award loot a second time.

## Rigging and playback choice

Start with rigid Node3D joint hierarchies in Godot: hips/body, head, shoulders,
elbows, hips/knees and equipment sockets. This is a simple rig even without
skinned meshes. Rotating solid bone/stone pieces suits our style and avoids
requiring weight painting before the first improvement.

Author pose clips with Godot AnimationPlayer; use AnimationTree where blending
idle and locomotion warrants it. Keep one writer per transform: clips drive joint
poses, cosmetic sway/recoil use dedicated additive child pivots. The combat
simulation supplies attack phase and progress rather than being driven by a
blending graph's incidental transitions. Prototype the graph narrowly; a custom
general animation editor is out of scope.

Use Blender armatures and exported animation clips when a character needs actual
deformation, especially a fleshy minotaur. A skinned renderer can consume the same
behavior state/event contract without rewriting health, attacks or drops.
Geometry Nodes are useful for authoring proportions, horns, armor and variants;
do not make runtime locomotion dependent on evaluating a Blender node graph.
Generated geometry must become an exported game asset. Check compatibility with
the existing Blender 2.93 worker before introducing newer Blender authoring tools.

## Small reusable contract

Enemy definition: id, visual scene/factory, rig family, authored forward axis,
collider dimensions, movement/turn parameters, existing combat values, attack
timings, animation profile, equipment sockets and loot table. New enemies select
a profile and assets rather than adding another sprawling type-specific branch.
Allow bounded special behavior hooks when a later enemy actually needs one.

Animation input: state, state age/progress, measured planar velocity, facing,
grounded status and hit direction. Events: attack started/cancelled, hit, death.
Death takes priority over everything; movement cannot overwrite attack/death.
Decide explicitly whether each attack can be interrupted. A purely visual flinch
does not cancel damage or create a gameplay stagger implicitly.

Movement owns the collision root. Animate a child visual root; start with in-place
clips, not root motion. Derive gait phase from actual distance travelled so a
slowed enemy takes slower steps and a stationary enemy stops walking. No camera
shake, player knockback or moving collision hull from cosmetic body bob.

Coordinates: metres, Y up, character visual forward +Z. Camera/aim forward remains
-Z. Declare import correction once at the visual root; do not scatter 90/180-degree
patches across AI and animation. Validate left/right limbs and tool socket axes.

## Character identities and order

1. Skeleton: loose, clattery joints; slightly uneven steps; clear sword wind-up;
   sharp strike and exposed recovery; directional recoil and short bone collapse.
2. Rat: four-legged scurry in short bursts, body compression before movement,
   nose/ear/tail life and a readable bite. Avoid adding an aggressive feet swarm.
3. Golem: heavy weight shifts, deliberate foot plants, held anticipation and a
   decisive impact. Existing golem and foundry boss may share the rig family but
   retain distinct pacing. Dust/sound attach to impacts, not every frame.
4. Minotaur: a later deliberate addition. Broad chest, head/horn gestures and a
   shoulder-led stride. First decide friendly NPC versus enemy; do not assume
   charging attacks or build a new combat system merely to animate him.

Share behavioral vocabulary across characters, not identical limb anatomy or the
same walk cycle. Prefer a biped and quadruped family over a universal rig.

## Iteration tools

Add a small native animation test area with one selected enemy, state playback,
pause/slow motion, a turntable, floor grid, forward arrow, joint/socket markers
and optional collision overlays. Inspect near-hand scale and front/side/rear views.
Keep this developer view separate from the adventure's normal player flow.

Expose a focused Enemy Feel tuning group: stride length, body bob, turn speed,
wind-up, recovery and recoil strength. Profiles carry per-species defaults.
Attack timing sliders update the authoritative gameplay timeline and its visual
sampling together. Log profile revision and state transitions in debug mode;
avoid per-frame log spam. Missing clips should fall back safely and log once.

## Acceptance and scope boundaries

Pilot acceptance: skeleton faces the player from all directions; feet do not
continue walking when stopped; all attack damage occurs in the visible strike
window; slowing playback does not duplicate hits; death mid-attack cancels future
damage and awards loot once; returning/resetting the zone resets the visual rig.
Pick a frame-time budget from measured current headset baseline before expanding
to crowds. Compare the same scene with animation on/off on this PC in stereo.
Pause animation for inactive zones; later add distance-based update rates only
if measurement warrants it. Test repeated spawning/death for orphaned visuals.

First checkpoint includes the skeleton, minimal profile/animation adapter,
small preview harness and focused checks. It excludes new enemy types, full-body
IK, procedural terrain foot placement, full ragdolls, motion capture, multiplayer,
new renderer, global art replacement and an elaborate asset generator. A simple
authored collapse is enough initially. Expand to the rat only after the skeleton
feels good; use that second rig to discover which abstractions really need reuse.

## Sources

- Godot AnimationTree blends clips and supports state-machine playback:
  https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html
- Blender armatures define bone hierarchies for rigging:
  https://developer.blender.org/docs/features/animation/armatures/

## Implementation follow-up

September 13: the user authorized animation and expanded death to real physical
pieces. See CHARACTER-ANIMATION.md for the delivered implementation and limits.
The first foundation now covers existing skeletons, rats, golems and wisps; the
minotaur remains a future role/design decision. The original proposal above is
retained as design context, not a claim that every future abstraction is built.
