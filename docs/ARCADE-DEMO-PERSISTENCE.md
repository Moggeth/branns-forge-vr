# Echo Bells and Lantern Gallery demo saves

The existing `demo_session.gd` adapter accepts two additional **optional** members
of its schema-1 payload. Original payloads, Bankshot-only saves, Festival saves and
every combination of the four optional activity records remain valid. Initialize
`game.echo_bells` and `game.lantern_gallery` before `demo_session.setup(...)` so
restoration reaches their runtime instances. No new save directory or menu is
introduced; standalone progress stays under `user://BellworksDemo`.

| Payload member | Module | Durable fields |
| --- | --- | --- |
| `echoBells` | `game.echo_bells` | `schema`, `revision`, `medal`, `completions`, `bestLength`, `bestUnassistedLength` |
| `lanternGallery` | `game.lantern_gallery` | `schema`, `revision`, `medal`, `completions`, `bestShots` |

Both use schema 1, finite integer revision 0–100,000,000, integer completions
0–1,000,000, and a boolean medal exactly matching whether completions exceed zero.
Echo best lengths are 0, 2, 3, 4 or 5; first-listen best cannot exceed overall
best. A five-note phrase finishes the run and therefore requires the medal, and
the medal requires an overall best of five. Gallery best shots is zero before a
completion and a finite integer 6–1,000,000 afterward. Unknown or missing fields,
numeric strings, booleans in numeric fields, fractions and nonfinite values are
rejected by the modules' strict validators.

Festival and both new records share a small fixed registry in the adapter. Script
paths and module property names come only from that registry, never from save
data. Bundled scripts supply `fresh_state()`, `_valid()`, `progress_snapshot()`
and `restore_progress()`, keeping their rules authoritative. Bankshot's existing
special restore path is unchanged. An older payload gives present modules fresh
achievements. A loaded optional record survives unrelated saves when its module
property is absent; an explicit reset also clears that retained record, so it
cannot reappear when the module returns.

Only achievements and personal bests persist. The real modules' restore methods
abort unfinished melodies/rounds, release the Echo clapper, and clear gallery
throw state and motion. Active play that changes only transient state does not
rewrite the save. An unsafe reset leaves the current run and achievements intact;
an invalid snapshot cannot replace a valid file.

## Verification

Use the portable Godot engine with `--headless --audio-driver Dummy --xr-mode off
--path godot --script res://arcade_session_checks.gd --log-file <absolute-log-path>
-- --demo-session-check`. The fixture uses real arcade modules without their
scene setup, the real bounded JSON store, and a diagnostic fake game. All files
go to a uniquely named `brann-arcade-session-*` directory under `TEMP`; no normal
player saves, network calls or audio are involved.

- `arcade_session_checks.gd`: 100 checks passed, 0.485 seconds wall-clock engine
  invocation (0.078 seconds test body).
- Existing `festival_session_checks.gd`: 41 passed, 0.476 seconds.
- Existing `bankshot_session_checks.gd`: 11 passed, 0.385 seconds.

The 100 checks cover all 16 optional-field combinations, exact field validation,
bounds and cross-field invariants, real restore/reset transient clearing,
absent-module preservation, blocked reset, unchanged-save suppression and invalid
snapshot protection. Full rendered gameplay remains covered by the coordinator's
integration work rather than this persistence fixture.

Logs: `logs/arcade-session-check.log`,
`logs/festival_session_checks-arcade.log`, and
`logs/bankshot_session_checks-arcade.log`. Timings are appended to
`logs/playful-feedback-timing.csv`. Before editing, the adapter was backed up to
`work/arcade-session-backup-20260921-084446/demo_session.gd`.

The first new-fixture run had one assertion failure: it compared restored real
module dictionaries to raw parsed JSON dictionaries. Godot parses JSON numbers
as floats, while both real restore methods intentionally normalize integer fields.
The corrected assertion compares restored state to canonical integer records;
absent-module snapshots still compare to the raw parsed representation. This was
a fixture expectation error, not lost achievements (99 other checks passed).
