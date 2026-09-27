# The Unfinished Lullaby

Three small buds are sleeping in a quiet garden. One wants **light**, one wants
**warmth**, and one wants **a song**. Bring an appropriate source close to each
bud. The starter table lends a Glow Pebble, Warm Pebble and Handbell. Grip the
bell and trigger it near the sound bud; carrying a silent bell is not enough.

Each awakened bud opens two copper leaves and contributes one distinct wonder
to the chorus. When all three are awake, a copper vane rises and turns above a
golden light. Repeating the same wonder cannot substitute for the other two.
The objective and earned garden state persist through the existing Living
Workshop save system.

The puzzle checks sensed **outcomes**, not the identity of the starter objects.
A nearby light, heat or sound stimulus from another supported Living invention
can solve it. It is a small example of an invention changing how a place works.

## Optional package, not a new game subsystem

The complete playable definition is the single JSON object
`godot/living_unfinished_lullaby.json`, with ID `living-unfinished-lullaby`,
version 1. It uses 26 entities, three dynamic starter objects and five rules,
with no dependencies, executable scripts, new native components, new endpoints
or paid calls. The native script alongside it is a verification harness only;
the game never needs to load that script to play the package.

The region origin is `(120, 0, -90)` and the world spawn is `(120, 0, -84)`.
Entity positions are relative to the region origin. The 20 x 18 metre floor is
clear of Bellworks, Copper Kite Cargo and the Open-Hand Test Garden. The only
portal in this package is the garden's **Back to Brann** gate, which uses the
existing safe-travel destination `(9, 0, 2)`. It adds no separate Forge gate.

## Activate and change through the existing lifecycle

After the optional manifest is included in the museum catalogue, request it
from the Hall of Inventions experiment console or through Brann's existing
`publish_living_package` capability. The service operation is the existing
`POST /api/vr/living/publish` with `{package, requestId}`; `package` is the exact
JSON file object. Publication is a requested deployment, not evidence of a
running scene: wait for the matching native **applied** acknowledgement before
travelling to the garden. Root game integration provides the garden visit
control; the native safe-travel helper must check the actual landing floor.

To change the installed garden, author the next consecutive version under the
same package ID and publish it normally. Sensor ranges, required stimulus
strengths, source shapes, colours, materials and bounded celebration actions
are data. Existing immutable versions remain available for rollback. A held
starter object or a visitor inside the region defers replacement; let go and
use the return gate first. New component types would still require a native
update, but this complete puzzle needs none.

Completion is persistent for the version. There is no hidden reset script.
For a fresh independent puzzle, publish an intentional copy under a new package
ID and matching scope target; do not delete the player's saved state. Removal
uses the normal rollback-to-zero lifecycle and preserves history.

## Exact sensing and ownership boundaries

- Light, heat and sound emitters produce bounded transient stimuli. Sensors
  inspect those stimuli by world distance and strength, including stimuli from
  other active packages. The included native test solves a fresh garden with
  three foreign emitters whose IDs are unrelated to the starter tools.
- Continuous emitter lookup, direct heat transfer, rule targets, objectives and
  links remain package-local. Cross-package completion happens because the
  garden's own sensor perceives a nearby stimulus; its rules never rewrite the
  foreign source.
- Light and sound sensing is radial, not occlusion-aware. A visibly lit native
  object, an ordinary non-Living torch, an external microphone or arbitrary
  player speech is not automatically a supported stimulus. A creator should
  use the registered Living emitter/emit capabilities.
- Each bud watches its own `sensed` transition with a one-count objective.
  Only its first `objective_complete` contributes to the three-count chorus.
  The final receiver changes are guarded by that chorus completion. Repeated
  pulses, trigger clicks and revisiting a completed bud do not grant extra counts.
- The Handbell has a trigger and a rule that emits `sound`; it has no continuous
  emitter. The Glow and Warm Pebbles emit regularly. Warmth is low and all
  relevant materials use nonflammable stone, crystal or iron.

## Verification

Read-only service contract validation:

```text
node scripts/check-living-lullaby.cjs
```

Isolated native construction and semantic checks:

```text
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://living_lullaby_checks.gd
```

The native harness passes 28 assertions: bounded inert staging, normal activation,
idle/inspection non-completion, matching sensory outcomes, unique-bud counting,
physical bell grip and held-trigger activation, motion/light reward, JSON state
round trip, three genuine foreign-package solutions, local mutation boundaries,
spawn floor/capsule clearance and complete removal. It uses an isolated scene
and in-memory snapshots; it never opens actual player saves, publishes a package
or contacts a service. Root integration owns live deployment and graphical QA.

One verification lesson: rule actions run after entity updates within a frame.
After a completion rule sets a receiver's power, allow the next simulation tick
before asserting that the motor mesh has visibly rotated. The first test checked
that consequence too early; a following tick proves the real effect.

Measured work lives in `logs/playful-encounters-timing.csv`.
