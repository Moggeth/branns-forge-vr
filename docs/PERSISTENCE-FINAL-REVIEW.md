# Combined demo persistence edge review

The review used only disposable synthetic state under unique `TEMP` directories,
without native activity setup, resident-process restarts, normal player saves or
service calls. The accepted 08:58:58 distribution was not changed.

Two defects were reproduced and then fixed with coordinator authorization:

1. Optional activity validators compared `schema` to integer 1 before checking
   its type. JSON arrays, dictionaries and strings therefore produced GDScript
   operand errors. Echo, Lantern, Festival and Bankshot now first require a finite
   integer schema. The demo adapter applies the same guard to its payload schema
   and legacy Bellworks/cargo schemas before their existing validators run.
   The bounded store also type-checks envelope schema and kind before comparing
   them, so malformed outer JSON cannot raise the same error before validation.
   Malformed types remain corrupt; valid future schema values and foreign game
   identifiers remain incompatible and protected from automatic overwrite.
2. Retained activity records were populated on restore but not refreshed after a
   successful save. After reset, earning/saving a medal, detaching the module and
   saving unrelated cargo progress could overwrite that medal with the stale
   fresh record. `_remember_optional()` now refreshes Bankshot and registry records
   after a committed save or validated restore. Capturing state and failed saves
   do not promote uncommitted or invalid data into the retained record.

The initial isolated reproduction is in
`work/persistence-review-20260921-090315/audit.gd` and
`logs/persistence-final-audit.log`. It also confirmed restart preserves earned
Echo/Lantern records and a reset of an interrupted real module run clears its
transient state. The reproduction exposed six operand errors despite a zero
process exit code: always scan Godot diagnostic logs for `SCRIPT ERROR`, rather
than treating exit status alone as proof of success.

The focused regression `godot/persistence_edge_checks.gd` runs with:
`--headless --audio-driver Dummy --xr-mode off --path godot --script
res://persistence_edge_checks.gd --log-file <absolute-log-path>
-- --demo-session-check`.

Result: **136 checks passed**, no runtime errors, 0.565 seconds engine invocation
(0.137 seconds test body). Coverage includes malformed schema types in all six
records and the parent payload, direct optional validators, all four optional
records detached after saving, failed transaction and invalid snapshot retention,
read-only capture, explicit reset while modules are absent, malformed outer
envelopes and a malformed-only primary that safely blocks writes. The first 119
focused checks passed in 0.480 seconds before envelope coverage was added. No unchanged
happy-path suite was rerun for these fixes. Log: `logs/persistence-edge-check.log`.

Backups of the six changed production files are in
`work/persistence-audit-fix-backup-20260921-090401/`. Module edits are localized to
schema guards; the Festival start behavior was changed separately by its owner.
Measured timings are in `logs/playful-feedback-timing.csv`.

Isolation inspection confirmed that all five native activity setup methods derive
normal persistence from `not diagnostic_offline and not smoke`, the demo flag sets
`diagnostic_offline` before setup, and the explicit demo adapter initializes after
the native modules. Relay's packaged garden publishing uses Living's diagnostic
branch; normal polling/requests remain guarded. No normal-save or service-call
leak was found in these inspected paths.
