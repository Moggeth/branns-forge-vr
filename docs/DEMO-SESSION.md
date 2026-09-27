# Persistent Bellworks demo

The standalone demo can retain progress locally when started with both
`--playful-demo` and `--demo-persistent`. It remains offline and diagnostic:
the ordinary adventure, quest, workshop and Living Workshop save files stay
disabled. Its separate namespace is `user://BellworksDemo`.

The demo keeps Bellworks trial progress and the earned ring appearance, the
Copper Gardener trophy and completed-round count, local tuning settings,
whether the two optional inventions are enabled, and their earned objectives.
When available, Bankshot's optional schema-1 field also keeps its partial round,
medal, best completed score and replay count. Older saves without that field
remain valid and receive fresh, unearned Bankshot progress.
Festival Relay adds an independent optional field for its medal, completed
practice/timed totals, and best completed time. An unfinished relay never resumes
or counts as a completion; its timer, stage and current actions stay in memory.
An archived invention keeps its completed outcomes; reactivating it restores
those outcomes. Parcels, starter objects and the Cinderloop ring begin at their
safe authored positions. Held objects, flight, body velocities, fuel and heat
are not resumed.

Changes autosave after about one second of quiet. Explicit local tuning commits
and normal game shutdown also request a save. The status text distinguishes
pending, saved, recovered and failed saves. An incompatible or wholly corrupt
save blocks automatic overwriting and explains that an explicit demo reset is
needed. The lower-level store preserves recovery candidates and reset archives;
see `DEMO-SAVE-STORE.md`.

## Reset behavior

The parent demo menu owns the confirmation before calling `reset()`. A reset
first checks the clear Bellworks landing at `(120, 0, 70)`, and returns there
before removing the garden floor. If an invention is still loading or the
landing is obstructed, reset fails without clearing progression. The store
must also successfully preserve/reset its namespace before gameplay is cleared.

Successful reset retires only `living-unfinished-lullaby` and
`demo-ember-return`, clears their remembered outcomes, restores the three cargo
parcels, removes the two demo challenge rewards, restores default local tuning,
and clears stale slider edits and tuning undo history. It does not remove other
Living packages or clear their cached state. The two demo packages' internal
physics snapshots are discarded so reactivation cannot revive a thrown or held
object. If a storage reset is interrupted, the store's durable reset marker
blocks recovery of pre-reset rewards until explicit reset succeeds.

## Adapter contract

`godot/demo_session.gd` is a Node adapter with:

- `setup(game, directory)`: called by root only for the explicitly persistent,
  offline demo, after all gameplay modules have been set up.
- `tick(delta)`: samples meaningful progression and debounces changes.
- `save_now() -> bool`: saves a valid changed snapshot; unchanged snapshots
  return success without rewriting the file.
- `reset() -> bool`: performs the confirmed safe reset described above.
- `status_text() -> String`: concise user-facing status and recovery action.
- `enabled`: the adapter is configured for persistence, including a blocked save.
- `writable`: false when automatic saving is blocked by storage validation.

Root hooks normal close; the adapter deliberately has no late tree-teardown
save callback. Such a callback could run after package-owned dictionaries or
challenge nodes have been disposed.

The adapter loads `demo_save_store.gd` at setup and passes a strict payload
validator. The store owns wrapper revision and crash recovery. Payload schema 1
contains only `bellworks`, `cargo`, `tuning` and `packages` plus its schema marker.
Challenge dictionaries use exact field whitelists and their original modules'
validators. Tuning keys must exist in both the packaged schema and the local
default map; values must be actual finite numbers within declared ranges, and
integer settings must remain integral.
The additive optional `bankshot` field uses the challenge's strict validator;
it contains no throw or flight data. Reset clears this optional progress too.
The optional `festival` field uses `festival_relay.gd`'s strict validator and
contains exactly `schema`, `revision`, `medal`, `completions`, `timedCompletions`
and `bestSeconds`. Revision is an integer from 0 through 100000000; completion
counts are integers from 0 through 1000000 and timed completions cannot exceed
all completions. Medal is true exactly when completions are positive. Best time
is a finite number: zero without timed completions, otherwise positive and at
most 604800 seconds. No running timer or stage is accepted.

Original schema-1 saves and Bankshot-only saves remain valid. When the relay
module exists, missing Festival progress receives its honest fresh default.
When the module is absent, existing validated Festival data is retained across
unrelated saves. Explicit reset clears retained data even without that module,
so later availability cannot resurrect old rewards. With the module present,
restore/reset calls `restore_progress`, which aborts active runs safely. A
blocked reset leaves both achievements and the ongoing run unchanged.

Package saves are restricted to these exact version-1 definitions:

| Package | Saved outcomes | Reconstructed visuals |
|---|---|---|
| `living-unfinished-lullaby` | Sun/hearth/song completion, each 0 or 1 | Bud state, opened leaves, chorus total, raised turning copper vane and golden light |
| `demo-ember-return` | Lantern hits, 0 through 3 | Objective count/completion, impact lantern colour and light |

The package enabled flag is saved separately from outcomes. Manifests always
come from the packaged JSON files; a save cannot supply scripts, manifests,
arbitrary entity IDs or transforms. Known deterministic visuals are recomputed
from those canonical definitions once per activation, preventing repeated
position offsets. Live objectives completed before the adapter's first sample
are preserved rather than replaced with an older snapshot.

Only `user://BellworksDemo` is accepted for normal use. A diagnostic fixture may
instead live below the OS `TEMP` directory when the process has
`--demo-persistence-check=<phase>` or `--demo-session-check`. The guard rejects
the temp root itself and ordinary adventure-save paths. Merely being in offline
mode does not permit arbitrary save destinations.

## Independent verification

```text
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://demo_session_checks.gd --quit-after 300 -- --demo-session-check
```

The 35 checks use a dedicated OS-temp fixture, lightweight game doubles, the
actual challenge validators, actual package component scenes and the actual
save store. They verify debounce/no repeated writes, strict payload boundaries,
reward and tuning restoration, archived outcome retention, canonical manifests,
partial/final garden reconstruction, Cinderloop state with fresh physical pose,
safe reset, retention of unrelated state, incompatible-save blocking and explicit
recovery. They also verify the canonical `user://BellworksDemo` path guards
using string operations only, without reading or writing that real namespace.

Root's separate full-process fixture lifecycle tests cover the real main scene,
fresh process resumes, genuine puzzle completion, menu reset and storage
recovery. No test claims that headless checks establish headset comfort.

Festival migration and persistence checks:

```text
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://festival_session_checks.gd --quit-after 300 -- --demo-session-check
```

These 41 checks use only a unique OS-temp fixture and the actual relay snapshot,
validator and restore methods. They cover old payloads, medal/best preservation,
unfinished-run exclusion and unchanged-save suppression, invalid types/finite
bounds, absent-module round trips, successful reset and obstructed reset. The
original 35 adapter checks and 11 Bankshot migration checks remain regression
coverage. Festival timing is in `logs/festival-session-timing.csv`.

Lessons recorded during implementation:

- The Living component builder requires a `Node3D` parent. An initial test
  double inherited only `Node`, causing a runtime type failure; use a matching
  `Node3D` double. Bound standalone runners with `--quit-after` so a script
  exception cannot leave an endless headless test process.
- Use OS-temp fixtures rather than the OneDrive workspace for atomic replacement
  tests, matching the verified store fast path and avoiding sync-related rename
  interference.
- Propagate the store's status, write permission and actual revision after a
  failed save; a newly incompatible on-disk primary must stop autosave instead
  of being treated as a temporary I/O retry.
- For JSON fixtures, insert new keys using `dictionary["key"]`: GDScript dot
  insertion may create a `StringName` key, which the JSON-only store correctly
  rejects. After a JSON round trip, compare with JSON-normalized expected data
  when a missing gameplay module cannot normalize numeric fields back to ints;
  strict Dictionary equality distinguishes those numeric types.

Timing records are in `logs/playful-encounters-timing.csv`.
