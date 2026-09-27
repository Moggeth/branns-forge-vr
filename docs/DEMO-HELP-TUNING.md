# Standalone demo help and tuning

The demo uses the existing palm menu, contextual stand feedback and notices. No
second menu or settings system is created. Root integration owns the demo-only tab
and persistent save/reset actions.

## Root hooks

Create `godot/demo_help.gd`, add it as a child and call `setup(game)`. Use `rows()`
for six entries: Ring & bells, Copper Kite, Lullaby garden, Cinderloop, Visit archive
and Tune tools. Route their `demo:*` actions to `act(action)`, which accepts either
the full action or stripped key and returns whether it handled the action. It
returns false for save/reset, leaving those two rows available for root integration.

The four help notices have at most three lines and fewer than 210 characters.
Desktop/VR ring and cargo controls are distinguished, including A/X fling and the
physical VR bloom lever. Lullaby says Prepare in archive, wait for Ready, then Enter
Experiment; Cinderloop says Prepare and take from its stand near Brann. Nearby ring
or wand stands receive a small pulse through the existing bounded feedback pool.
Visit archive calls the existing museum enter action. Tune tools opens the existing
playful slider group. Nothing is prepared, published, granted or reset by a help
button.

Root should display `game.demo_session.status_text()` and handle `demo:save` and
`demo:reset`, including its two-step reset confirmation. This helper does not own
save state or reset confirmation.

## Offline slider fix

Inspection found the old `tuning_runtime.setup()` only assigned `game`, leaving its
schema empty until a service response arrived. In a standalone demo no response
arrives, so the previous local commit loop silently skipped every slider key.

Setup now loads `res://tuning_schema.json` before any slider is built. A connected
service still replaces that metadata through ordinary authoritative ingestion.
Demo/lab revisions start at zero. Local commits validate the entire batch against
the loaded schema: known keys, actual finite numbers, current bounds and integer
rules. Strings, booleans, NaN/infinity, out-of-range values, unknown fields and stale
revisions are rejected without partial changes, undo entries or save calls.

A valid edit or undo updates values first, increments revision, rebuilds the
existing menu, then calls `game.demo_session.save_now()` if an adapter exists.
Successful saves say so; failed saves keep session values and show adapter status.
Without an adapter the notice explicitly says session-only. No-op edits and empty
undo do not create saves. Undo retains at most twenty snapshots. The normal service
commit path is unchanged and local demo edits do not issue service requests.

The adapter owns validating/restoring values. On restore/reset it should clear
`tuning.local_undo` and `tuning.dragging`, and advance/reset the local revision so a
stale slider release cannot reapply the prior session. This integration detail was
sent directly to the adapter owner. Runtime overrides and undo history should not
be persisted as tuned values.

The original tuning runtime was backed up before edits to
`work/demo-tuning-backup-20260921-074602/tuning_runtime.gd`.

## Offline verification

`godot/demo_tuning_checks.gd` runs with the real `--playful-demo` flag and a mocked
adapter, never loading the main scene or touching player/demo files. It exercises
actual slider release, packaged bounds, atomic rejection, undo, twenty-entry cap,
saved values visible to the adapter, save failure, no-adapter fallback, zero service
calls and all six help actions. It also checks compact text and mode-specific input.

Run the portable Godot engine with `--headless --audio-driver Dummy --xr-mode off
--path godot --script res://demo_tuning_checks.gd --log-file <absolute-path>
-- --playful-demo`.

Latest result: `DEMO_TUNING_RESULT []`, 0.208 seconds. Existing native tuning tests
also passed in 0.297 seconds; all eight service tuning contract tests passed in
0.120 seconds. Actual persistence/reload and rendered palm layout are validated by
the coordinator with the real adapter. Timings are in
`logs/playful-feedback-timing.csv`.

Recovery lesson: local/offline editors must load their validation schema before
rendering or accepting edits. Schema parity checks alone do not detect missing
setup ingestion; keep the real offline slider-release test.
