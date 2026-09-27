# Bankshot Bell presentation

`godot/bankshot_art.gd` adds a bounded garden presentation to the native Bankshot
challenge. Add the helper node and call `setup(game, game.bankshot_challenge)`
after the challenge creates its court, target and medal. Call `tick(delta)` with
the other playful helpers. Setup is idempotent. The helper reads the challenge's
public `court`, `target` and `medal` references; it does not change gameplay state.

The wall receives warm timber/brass trim, an amber enamel bounce diamond and two
angular bounce motifs. A two-tone rim makes the actual moving target recognizable;
it is parented to that target and follows all three stage positions. The reward
medal receives ribbons and a small engraved ricochet motif. Its visibility comes
from the challenge's medal, preserving the locked/earned state. Only the medal
decoration moves, with a gentle 0.15-radian yaw.

A shallow island, planted pots, stones and two faceted topiary silhouettes give
the court a grounded garden edge. Raised scenery avoids the central throwing
lane. The addition has no collision objects, lights, shadow casters or event-time
geometry allocations. Existing challenge geometry remains authoritative; the
decorative island is not additional traversable terrain.

The static scenery uses `WorkshopArt.bake`: 98 source pieces become 12 material
batches. Including the target rim and medal, the addition has 19 render meshes
and 3,752 triangles. `debug_snapshot()` exposes source parts, static batches,
render mesh count and the zero collision/light budget.

The existing Demo help still has six rows. Ring help suggests Bankshot as the
next challenge and explains the required wall bounce before hitting the target.
No additional menu entry or permanent text was added. The central diamond is an
ornament, not an exact aim point: tested bank shots contact the wall off-center,
and their ideal contact changes with the target stage.

## Offline checks

Use the portable engine with `--headless --audio-driver Dummy --xr-mode off
--path godot --script res://bankshot_art_checks.gd --log-file <absolute-path>`.
The standalone fixture uses only the agreed challenge reference contract, not
main, a service or a player save. It checks real tree counts, no shadows or
collisions/lights, material batching, bounds, clear raised-art lane, idempotence,
all three target positions, hidden/freed target and medal references, and 1,000
updates without growth. Result: `BANKSHOT_ART_RESULT []`, 0.294 seconds.

`demo_tuning_checks.gd -- --playful-demo` also passed in 0.207 seconds, retaining
six help rows and notices below the existing three-line/210-character bounds.
Logs are `logs/bankshot-art-check.log` and `logs/bankshot-help-check.log`; measured
work durations are in `logs/playful-feedback-timing.csv`.

This headless fixture verifies the art contract, not rendered appearance or the
complete native challenge. The coordinator owns integration and rendered review.
The existing help file was backed up to
`work/bankshot-art-backup-20260921-080958/demo_help.gd` before editing.

Coordination lesson: the challenge script did not yet exist during the first
read. Its owner's explicit public-reference/geometry contract was sufficient to
build an isolated art fixture; avoid repeatedly polling a file another agent is
still authoring. Use an absolute Godot log path to keep diagnostic output in the
project instead of resolving it relative to `user://`.
