# Standalone demo save store

`godot/demo_save_store.gd` is a `RefCounted` JSON storage utility. It has no game,
scene, script-loading or real player-save integration. The caller supplies an
explicit absolute directory and a payload validator. Empty paths, relative paths,
filesystem roots, existing file paths and invalid validators are rejected.

## Adapter contract

```gdscript
var store = preload("res://demo_save_store.gd").new()
store.configure(explicit_directory, validate_payload)
var loaded = store.load_progress()
# {status, data, revision, source, writable}
store.save_progress(progress_dictionary)
# Explicit user reset only:
store.reset_progress(default_progress_dictionary)
```

`configure`, `save_progress` and `reset_progress` return bool. The validator must
accept one Dictionary and return **strict bool true** for valid data. It receives
a deep copy so validation cannot mutate the stored payload. `revision` belongs
to the wrapper; the adapter need not add a revision to its payload.

Public properties are `directory`, `status`, `revision`, `writable`, and the
additional diagnostic `last_error`. `load_progress().source` is the absolute
selected candidate filename, or empty when no compatible data was selected.
Returned progress is copied so caller edits do not mutate cached store state.

| Status | Meaning |
|---|---|
| `missing` | Fresh directory; empty data, revision 0, writable |
| `ready` | Valid primary selected / transaction committed |
| `recovered` | Highest valid `.tmp` or `.bak` selected |
| `incompatible` | Primary schema/kind unsupported; writes blocked |
| `corrupt` | No compatible valid candidate; writes blocked |
| `reset_pending` | Interrupted explicit reset; writes/recovery blocked |
| `io_error` | Filesystem failure; inspect `last_error` and `writable` |
| `invalid_data` / `too_large` | Rejected proposed payload; existing data retained |
| `invalid_directory` / `invalid_validator` / `unconfigured` | Setup failure |
| `revision_exhausted` | Maximum exact JSON revision reached; explicit reset needed |

Successful configure initially reports `configured`; call load before applying
progress. Enable adapter restoration on missing/ready/recovered only. Unsupported
or corrupt saves require explicit reset, never an automatic save of defaults.

## File and transaction semantics

The primary wrapper is:

```json
{"schema":1,"kind":"bellworks-demo","revision":1,"progress":{}}
```

The caller's validator determines the progress fields. Independent storage checks
allow JSON-only data (no runtime objects, vectors, resources or scripts), finite
numbers, string dictionary keys and at most 32 nesting levels. Wrapper revision
must be a finite nonnegative integer no greater than 2^53−1. Read and write
wrappers are limited to **128 KiB of UTF-8 bytes**.

Load inspects `progress.json`, `.tmp` and `.bak`, choosing the highest compatible
valid revision. Equal revisions prefer primary, then tmp, then backup. An
unsupported primary blocks downgrade even if a compatible backup has a larger
revision. Every save rescans disk before incrementing the highest accepted revision.

Before overwriting a recovered temporary file, save preserves that newest valid
snapshot in `.bak` through a staging copy and rename. Invalid candidate bytes are
moved under `archives/corrupt-<timestamp>/` before overwrite. New data is written
and flushed to `.tmp`, then renamed over primary. A failed final rename leaves
the temporary candidate available for recovery. Errors are returned and printed
with the `DEMO_SAVE` prefix for the caller's normal log capture.

Explicit reset first stages validated default data and creates a durable
`progress.reset.pending` intent marker. It then moves **all three old recovery
candidates** to `archives/pre-reset-<timestamp>/`, installs revision 1 in primary,
stages and validates a matching reset-era `.bak`, and only then removes the intent
marker. Immediate corruption of the fresh primary therefore recovers writable
fresh progress. Backup installation failure retains `reset_pending`. Archives are
never recovery candidates. If interrupted, the
marker blocks loading old achievements; calling explicit reset again completes
a clean reset. No automatic recovery may bypass that marker. Failures before
reset intent is committed do not retire the original candidate files.

Use one serialized writer per directory. Sequential store instances refresh disk
revisions, but simultaneous processes are not protected by an operating-system
file lock. Archives are retained for diagnosis and are not automatically pruned.

## Isolated verification

```powershell
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --script res://demo_save_store_checks.gd
```

**61 checks pass**, zero failures, clean exit in **0.400s**. Fixtures are created
only under a uniquely named OS temporary directory; cleanup is restricted to that
exact directory. No `user://` files or real player state are accessed.

Coverage includes fresh saves, revision ordering, recovery from corrupt primary,
byte-preserving corrupt archives, incompatible-schema protection, explicit reset
and archive isolation, interrupted-reset blocking, malformed revisions, JSON and
UTF-8 limits, filesystem obstruction, sequential writers, and an injected partial
temporary write. That injected interruption preserves the newest recovered
revision in backup. A reset-intent rename failure also proves old progress bytes
remain intact.

The reset regression also corrupts the first fresh primary and asserts
`status == recovered`, `writable == true`, revision 1 and zero achievements, then
actually saves again. An obstructed reset-backup staging path retains the reset
marker and blocks loads until explicit retry succeeds.

## Validated implementation lessons

- Backing up only primary loses the newest progress if `.tmp` was the recovered
  winner and a subsequent write is interrupted. Back up the **selected** candidate.
- Reset must retire tmp and bak together with primary. Otherwise highest-revision
  recovery can restore achievements the player deliberately reset.
- A reset-intent marker closes the interruption window between retiring old
  candidates and installing fresh defaults. Do not treat that marker as corruption
  to ignore; keep the store blocked until explicit reset completes.
- Reset must seed a **fresh backup**, not merely retire old backups. Testing only
  that default values appear after corrupting primary misses an unwritable,
  unrecoverable save. Assert recovery status/writability and a subsequent save.
- Godot's copy call emits an engine error for a destination directory. Detect a
  backup-staging directory before copy and return the controlled reset-pending
  error while preserving the transaction marker.

Measured work: `logs/demo-save-store-timing.csv`.
