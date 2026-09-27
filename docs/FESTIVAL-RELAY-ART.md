# Festival relay presentation and help

`godot/festival_relay_art.gd` uses `setup(game, game.festival_relay)` after the
relay creates its public `board`, then `tick(delta)` after the relay update.
The board's title, status, timer and buttons remain owned by the relay module.
This helper only reads its `mode` (`idle`, `running`, `complete`), zero-based
`stage` and `timed` flag. It never alters state, starts a run or saves progress.

The reserved shallow strip sits at board-local y 0.64–0.88, above the status and
below the title. Three small festival batons carry ring, cargo crate and flower
emblems. The current activity has a green backing; finished activities show check
marks. A small gently rotating rosette appears only for an actual completed run.
Idle clears the highlights and rosette, so merely visiting or abandoning does not
imply success. The helper draws no text or clock; practice cannot accidentally
display a decorative timer. Core instructions should name the current activity.

Static pieces are batched using the existing `WorkshopArt.bake`. Total cost is
17 mesh instances and 940 triangles, with no lights, collision nodes or shadow
casters. Tick updates only existing visibility and a bounded rosette rotation;
there are no event-time geometry allocations. All art inherits board visibility.
`debug_snapshot()` reports actual mesh count and the displayed mode/stage/timed
values for diagnostics.

Run `festival_relay_art_checks.gd` with the portable Godot engine using
`--headless --audio-driver Dummy --xr-mode off --path godot --script
res://festival_relay_art_checks.gd --log-file <absolute-log-path>`. Its standalone
fixture checks vertex bounds against the reserved strip, budgets, state-driven
stage emphasis, completion/idle behavior, no gameplay mutation, idempotence,
1,000 animation updates without growth and a freed/hidden board. Result:
`FESTIVAL_RELAY_ART_RESULT []`, 0.297 seconds. The coordinator owns full module
integration and rendered review; this fixture does not certify visual readability.

The Demo page keeps six entries. Festival relay replaces the separate Cinderloop
help row; Cinderloop remains available through the archive and its existing help
action remains compatible with callers. `demo:relay` calls
`game.festival_relay.act("visit")` only. Visiting never starts, restarts or abandons
a run. The three-line notice explains the explicit Practice/Timed choices, the
ring/cargo/Lullaby sequence and the board's Restart/Abandon controls.

`festival_relay_help_checks.gd` is an isolated fixture with a mock relay. It
verifies six compact rows, desktop/VR notice bounds, visit-only behavior, clear
start/exit choices and graceful handling of a missing optional relay. Result:
`FESTIVAL_RELAY_HELP_RESULT []`, 0.194 seconds. The existing
`demo_tuning_checks.gd -- --playful-demo` regression also passed, 0.193 seconds.
These tests load no main scene or real save adapter and make no network calls.

Before editing, `demo_help.gd` was backed up in
`work/relay-art-backup-20260921-082314/`.

Logs are `logs/festival-relay-art-check.log`,
`logs/festival_relay_help_checks-relay.log` and
`logs/demo_tuning_checks-relay.log`. Material-step timing is recorded in
`logs/playful-feedback-timing.csv`. An early read found the relay script still
unwritten, so implementation used the module owner's explicit reference and
reserved-layout contract, with a standalone fixture rather than loading main.
