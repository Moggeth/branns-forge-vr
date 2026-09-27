# Living components, native capability version 1

The native engine is `godot/living_components.gd`. It builds inert package scenes, then activates only after the coordinator validates/stages them. `living_component_schema.gd` independently validates component settings, links, references, rules, finite numbers and budgets against the pinned `living_capabilities.json`. No incoming script is executed.

## Playable interactions

- Grip a movable object to hold it; release to drop/throw with measured hand velocity (12 m/s cap). Held packages report busy so version replacement waits.
- Grip a climbing surface, pull with your real hand, then release. Two climbing hands average their movement; movement uses the existing standing-capsule collision sweep. Excessive separation releases the grip. Rig motion is excluded from the following frame's hand delta.
- Grip a grapple, point at static geometry and squeeze trigger to attach. Hold trigger to reel along a visible tether. Tap again or release grip to detach. Top-face targets approach above their landing before descending, avoiding the ledge lip. Speed is bounded to 3 m/s by the schema.
- Point at a portal and trigger it. The coordinator checks real floor and standing-capsule clearance before travelling. Portal packages cannot acknowledge destination readiness themselves.
- Grip a cut/repair/grow tool, point at another package object, then trigger. Cutting reduces the object's size/integrity and produces a colliding offcut; repairing restores it; growth enlarges static geometry. These are stylised shape transformations, not arbitrary mesh Boolean cuts. Weak points multiply cutting/damage. Growth/moving static mechanisms wait if their proposed bounds would enclose the player.
- Maker recorder: grip, trigger, trace a motion, trigger again. A visible golden segment replays the recorded path; up to 128 samples persist.
- Maker joiner: grip, trigger two pieces belonging to its package. At least one must be movable. The result is a real Godot hinge joint, saved/restored with the package.
- Maker brush: grip, point at a package object, trigger to paint it climbable. The colour and climbing property persist.
- Receiver/trigger devices, fields and objectives advertise their controls in short in-world labels. Labels wrap to 450 pixels at 0.0028 world-unit pixel size; only the three nearest within five metres show, fading at the boundary and prioritising a held item. Held devices with a trigger component activate themselves rather than accidentally activating something beyond the player's hand.

## World rules

Every entity derives material defaults from wood, iron, crystal, cloth or stone; explicit material settings override individual properties. Temperature, wetness, ignition, hardness and conductivity participate in live simulation. Fire has a small geometric flame, flickering local light and integrity loss; sufficient water extinguishes it. Baseline enemies and ghost immunity are untouched.

Links connect package-local endpoints:

- **Energy:** bounded source power flows through conductivity/conductance to lamps, lifting doors and motors.
- **Fluid:** conserved volume transfers from a reservoir to another vessel/material at a limited rate. Vessel fill is visible through translucent walls; absorbent materials become wet. This is a volume graph, not a fluid particle simulation.
- **Signals:** named events traverse links with visited-node protection. Rules can transform them into further bounded events/actions. All feedback shares a 64-event/frame budget; overflow is dropped rather than perpetually draining headset time.
- **Tethers:** visible tension-only spring links apply equal/opposite forces to movable endpoints, capped at 50 N.
- **Hinges:** native physical joints connect bodies and optionally drive a modest motor.

Light, sound, heat, motion and named signals can be sensed. Emitters and transient sounds leave positions in creature memory. Creatures investigate those positions, follow the player, or flee; swept collision limits movement. Memory expires after 15 seconds without fresh perception. Sound propagation/light sensing is radius-based; this is not acoustic ray tracing or a full navigation mesh. Light perception currently does not model occlusion.

Gravity fields affect nearby package rigid bodies and use swept player descent while inside. They never change global project gravity. Visibility fields dim only package-owned props inside their bounds, preserving headset visibility and existing scene materials. Moving out restores original properties. These deliberately local semantics are important when combining experiments.

Objectives watch named outcomes and counts, not one prescribed tool. Completion updates the object's visual state and records a provenance event. Rules may alter heat, wetness, power, colour, position, scale, integrity, transformations or objectives. Embodiment profiles are applied by the coordinator, not this module.

## Persistence and lifecycle

`serialize(result)` exports bounded JSON state, transforms, colours, painted climbing surfaces, recorded gestures and maker-created hinges. `restore(result,state)` restores that version's state before activation. Session-local emitter/cooldown clocks are reset; remembered positions retain their identity with a fresh bounded memory window. Trigger/audio state is not replayed as if the player just acted.

`deactivate` releases owned hands/tethers, disables collisions, freezes bodies and frees joints. The package root's `tree_exiting` callback severs circular dictionary ownership; callers must actually free retired scene roots. This avoids material/resource leaks caused by `entry.owner -> result.entities -> entry`.

Bounds: 64 entities/16 dynamic bodies per package; central loader imposes total scene limits. At most 20 offcut bodies survive for 40 seconds, 64 sensory pulses persist briefly, and gesture samples cap at 128. Eight shared shadow-free point lights serve the nearest active material/device light requests within 18 metres; staging creates no per-entity native lights. Plain floor/wall geometry receives no labels or flame meshes. Rendering and VR comfort still require hardware testing; these budgets are not a frame-rate guarantee.

## Verification and fast paths

Standalone native test (no service, no paid API, no SteamVR):

```powershell
& '.\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --script res://living_component_runner.gd --quit-after 600
```

Require `LIVING_COMPONENT_RESULT []` and no `SCRIPT ERROR`, `ERROR` or leaked RID warning. The callable test is `await preload("res://living_component_checks.gd").run(game, failures)` for the coordinator's integration harness. Latest focused pass after bounded light pooling: **0.2722578 seconds**.

Checks exercise all demo scene construction, inert staging, heat/ignition/water, conserved liquid, conduction, gravity fields, sensory memory and actual creature movement, physical offcuts, repair/growth, weak-point multiplier, state round trip, measured throw velocity, held-version deferral, recorded movement, real grapple ray attachment, actual climbing displacement, native hinge connection, feedback bounds, rejected malformed config/NaN and clean deactivation.

Regenerate the pinned catalog when service primitives change, then run the parity test:

```javascript
const c = require('./service/living-workshop').catalog();
require('fs').writeFileSync('godot/living_capabilities.json', JSON.stringify({
  components:c.components, actions:c.actions, events:c.events,
  links:c.links, budgets:c.budgets
}, null, 2) + '\n');
```

## Recorded implementation lessons

- A large Windows shell command exceeded CreateProcess's command-line limit (`os error 206`). Use bounded `apply_patch` calls for source files; do not retry the long command.
- `signal` is a reserved GDScript keyword. The first parse caught it; use `signal_name` for local variables.
- Native dictionaries with mutual ownership retain materials after nodes disappear. The standalone runner initially reported 85 material/ObjectDB leaks; scene-root exit cleanup eliminated them.
- Collision-layer changes need a physics-frame boundary before ray tests. The first grapple test ran immediately after grabbing and hit stale collision state; waiting one physics frame exercised the intended held-body exclusion.
- Automatic material properties changed the wooden test lamp's conductivity to 0.05. Give conduction fixtures explicit conductivity 1 (or use iron); do not disable material semantics to satisfy an outdated assertion.
- An investigating creature stops within 0.8 m of its remembered destination. A movement assertion after it already arrived was invalid; reset its remembered target beyond that radius before testing movement.
- Headless sounds stay disabled; real sound emitters use a short local, pooled synthetic chime. No microphone, API or recording is involved.
- Coordinator saw one Vulkan capture heap crash; it did not reproduce in a subsequent normal-audio render. Per-entity lights were replaced with an eight-light pool as a budget improvement, but the isolated crash's cause is not established. Do not claim the light pool proves that crash fixed.
