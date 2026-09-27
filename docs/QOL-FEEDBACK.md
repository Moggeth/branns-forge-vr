# Bomb and world feedback

`godot/interaction_feedback.gd` is a visual-only helper. It does not own input,
change health/inventory/collisions, make service requests, or restart anything.

## Root integration

Instantiate the helper after `adventure.setup(game)`, call `setup(game)`, and
call `tick(delta)` after `adventure.tick(delta)` each frame. Public `enabled`
controls all helper visuals. Captures are automatically disabled at setup.
Public `throw_arc_enabled` defaults to false; the root comfort/settings UI can
toggle it. No changes to controls are introduced by this helper.

Exact thrown-bomb countdowns use optional bomb metadata:

- `spawned_at = game.elapsed` when created.
- `fuse_at = game.elapsed + 2.6` when created.
- On first collision, `fuse_at = min(fuse_at, game.elapsed + 0.35)`.

Without those fields the helper observes creation and `detonating` state,
with approximately one frame of countdown uncertainty. It does not change the
fuse or claim a displayed throw prediction is authoritative.

## Visual feedback

- A forming hand bomb gets an amber progress ring and remaining formation time.
  Readiness changes both the color and wording to **READY · release to throw**.
- Thrown bombs display an armed fuse ring/countdown. Inside the actual
  3.2-meter blast radius this reads **MOVE BACK**, also using a warm warning
  color. The countdown shortens when impact starts the detonation delay.
- The optional dashed throw arc uses the current tracked hand velocity, or the
  desktop launch velocity, and gravity. Ray tests stop the arc at solid world
  geometry. It predicts up to 1.92 seconds; it is an estimate before release.
- Aimed interactive objects get mint or amber corner brackets plus a concrete
  action or missing-tool reason. Tool boards explain tier requirements. Markers
  are depth-tested; they do not reveal objects behind walls.
- Enemy close-attack windups show **STEP BACK** and remaining time, plus a
  ground ring corresponding to the 2.8-meter strike radius. The boss's exposed
  phase displays **CORE EXPOSED · DOUBLE DAMAGE**. Existing boss ground-eruption
  telegraphs remain owned by the adventure runtime.
- Successfully collected materials briefly float `+amount resource` and five
  small motes at the gathering location. The helper observes the native
  `collecting == true` / `visible true → false` transition; zone parent culling
  does not produce fake gathering effects. Failed service pickups remain visible
  and produce no reward animation.

Formation/fuse/enemy displays track the current frame. Aim work is limited to
20 updates per second and gathering observation to 12.5. Throw arcs are off by
default. Feedback does not add flashing effects, camera motion or extra audio.

## Verification hooks and limits

`describe_target(target, tool_id, distance)` returns the same read-only
compatibility description used by highlighting. `last_hint`, `gathered_count`,
and the `formations`/`flying` dictionaries support native integration assertions.
`gathered(position, resource, amount)` is also callable for a future explicit
event integration; do not call it as well as the existing automatic observation
for the same pickup.

The helper parses with:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script interaction_feedback.gd --check-only
```

The first parser check passed in **0.244 seconds**. No live service, voice,
generation or running user game was touched. Headset legibility and controller
motion remain physical playtest checks. Root integration verification exercises
the helper together with the game.

## Timing

Source inspection tool calls took 0.131 and 0.131 seconds. Authoring started at
2026-09-12 19:37:18.226 +10:00; completion elapsed time is recorded below.
Authoring and parser verification: 366.024 seconds inclusive.

Final integration alignment: pickup hints respect the root comfort menu's configurable reach, and aim overlays hide while that menu is open. The enemy attack_at field is a pending strike deadline; rest_until separately handles cooldown, so recovery does not create a false windup cue. Alignment parser check passed in 0.217 seconds.
