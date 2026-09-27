# Returning projectiles for Living Workshop

`returning_projectile` is a reusable version-1 declarative component. It extends
the existing grabbable entity and input lifecycle: grip / E takes the creation,
release / E throws it, and empty-hand trigger / click recalls that exact entity.
Desktop E can also take an aimed returning item within three metres. A held item
with its own `trigger` component retains that component's established action.

The offline example `godot/living_returning_demo.json` describes **Cinderloop**,
a palm-sized glowing wooden ring and its own practice lantern. An outbound impact
lights that lantern through ordinary bounded package rules. Three impacts complete
the lantern's objective. No enemy/combat behavior or service endpoint is added.

## Configuration

Add both `grabbable` and `returning_projectile` to an entity. Body dimensions may
not exceed one metre per axis, mass may not exceed 3kg, and physical hinge/tether
links are disallowed. Grapple, climbable, maker, portal, creature and field may not
share the projectile entity. Other ordinary static/package entities are unaffected.

| Property | Default | Allowed values |
|---|---|---|
| `speed` | 8 | 1–16 m/s; maximum hand throw speed and desktop aim speed |
| `gravity` | 1 | 0–9.8 m/s² |
| `returnSpeed` | 12 | 2–20 m/s |
| `returnAfter` | 3 | 0.2–8 seconds before automatic recall |
| `collision` | `return` | `return`, `bounce`, `stop` |
| `restitution` | 0.5 | 0–0.8; bounce velocity multiplier |
| `hitEvent` | `projectile_hit` | Existing catalog event or valid `signal:name` |
| `appearance` | `plain` | `plain`, `ember_ring`, `wood_ring` |

Ring appearance replaces only the entity's visible mesh with a low-poly torus;
the authored primitive remains its collider. Outbound movement uses swept centre
rays with at most 20ms substeps. It does not model the decorative rim as a hollow
collision shape. Recall is spectral and cannot be obstructed by scenery.

Events emitted on the projectile entity are `projectile_thrown`, `projectile_hit`,
`projectile_recalled`, `projectile_caught` and `projectile_home`. A configured
`hitEvent` is additionally emitted when distinct from `projectile_hit`. Hits include
position and speed and occur at most once per collider per throw. Existing rule
targets remain fixed, package-owned entity IDs. Collision does not grant authority
to mutate the struck world object or player.

## Ownership, replacement and recovery

The helper stores the exact entry, node and original hand. It creates no additional
projectile and cannot teleport the player. A physical grab by another free hand
cancels the original recall. An occupied hand is never overwritten: generic held
items, native toys, cargo, workshop systems and forming bombs all reserve their
hands. If recall finds that hand occupied, its own item returns home.

Only one loose returning item is associated with a hand; a subsequent throw
returns its prior loose item home. Automatic recovery also handles a lost hand,
a long player teleport, flight beyond 100m from home, a fall below -30m, and a
16-second absolute lifetime. Four bounces or a very slow bounce start recall.

Held-version deferral remains the coordinator's existing mechanism. Publishing
v2 while v1 is held retains v1. Releasing permits v2 to stage and replace it;
retirement clears all v1 flight references before freeing its scene. Old-version
recall cannot resurrect retired nodes. Saves record authored home for transient
flight, never a hand binding or flight velocity. Ordinary package state remains
version-specific. Runtime maker joints also reject returning entities.

## Integration

The component engine automatically builds and ticks `living_projectiles.gd`.
`living_runtime.gd` additionally exposes **`claims_trigger(hand)`**. Root input
integration must use that method for bomb suppression and trigger allowance,
including desktop bomb keyboard routing. Keep **`busy(hand)`** for actual grip
ownership and desktop E release behavior; loose recall must not pretend the hand
is holding something.

The new demo is deliberately separate from existing demo arrays. Add its object
to both service/native demo catalogs centrally, preserving the arrays' other work.
It is an ordinary existing `publish_living_package` payload and can arrive after
startup without restarting once the native capability is loaded. Initial authored
forge stand location is `(-3, 0.5, 7)`; adjust all demo entities together if central
layout verification finds a conflict.

Changed engine/service sources were backed up before edits under
`work/returning-backup-20260921-072632/`. The lane changes only component handling,
independent validation, a claims wrapper, the service catalog and pinned schema.
No main, native toy, cargo, or existing demo-array files were edited.

## Offline checks

```powershell
& 'C:/Program Files/nodejs/node.exe' --test service/returning-projectile-test.cjs service/living-workshop-test.cjs
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --script res://living_component_runner.gd --quit-after 600
```

Latest result: **17 Node tests and 41 focused native checks pass**, followed by
the preexisting component suite returning `LIVING_COMPONENT_RESULT []`. Process
times were **1.244s** and **0.300s** respectively, with no script or resource errors.

The focused service test creates an isolated registry under the operating system
temporary directory, publishes immutable v1/v2/removal through `LivingWorkshop`,
and passes its actual snapshots into the real native coordinator. The native
harness exercises sync, staging, activation, acknowledgements, held deferral,
replacement, collision responses, rules, catch identity, occupied-hand safety,
travel recovery, independent malformed-schema rejection and removal. No player
saves, live service state, microphone, generation worker or paid API is used.

This harness uses snapshot delivery rather than a second new HTTP transport;
existing Living HTTP publication/acknowledgement regression tests run alongside it.
Headset feel and final rendered layout remain separate central verification.

## Lessons for further primitives

Reuse existing held entries and coordinator retirement rather than introducing a
second inventory. Separate trigger reservation from actual hand ownership. Retire
flight state on scene disposal as well as normal deactivation. Flight dictionaries
store a stable node ID so cleanup still works after a node has been freed. New
movement primitives must reject incompatible physical links both in package
validation and later maker-created joints. Keep emitted effects inside existing
package-local rules and event budgets.

Measured work is recorded in `logs/living-projectile-timing.csv`.
