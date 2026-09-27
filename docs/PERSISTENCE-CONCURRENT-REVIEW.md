# Final bounded persistence review

The 09:49 review reused the prior 136 regression results. It did not rerun those
suites, change production code, touch normal saves, launch a resident game, or
alter the accepted 09:09:40 ZIP.

An isolated fixture made 791 nested wrong-type substitutions across the complete
demo payload and called the adapter validator. It produced no GDScript runtime
errors. This is additional exception-safety evidence, not a claim that every
substituted value must be invalid.

One previously uncovered defect was reproduced with **two live adapters sharing
one save directory**:

1. Session A earns and saves an Echo medal.
2. Session B loads that save and explicitly resets the demo. Disk medal is false.
3. Session A, which still holds its earlier in-memory achievements, changes an
   unrelated cargo field and saves. Disk medal becomes true again.

`demo_save_store.gd::save_progress()` reloads the disk revision before writing but
accepts the caller's stale complete payload. Reset also restarts the revision at
one; there is no reset-generation check or exclusive writer ownership. Existing
sequential-writer coverage verifies revision advancement, which does not detect
this stale-content resurrection.

This finding is conditional on overlapping sessions using the same namespace.
No corresponding failure was found in the ordinary single-session reset path.
A future repair could enforce exclusive namespace ownership or add a persistent
reset generation that stale adapters must match. A revision-only equality check
would be insufficient when a reset returns the revision to an earlier value.
The coordinator received the finding for integration judgment; no fix was made
as part of this review.

Reproducer: `work/final-persistence-burst-20260921-095123/review.gd`.
Log: `logs/final-persistence-burst.log`.
Run with the portable engine, `--headless --audio-driver Dummy --xr-mode off
--path godot --script <absolute-reproducer-path> --log-file <absolute-log-path>
-- --demo-session-check`. All state goes to a uniquely named
`brann-final-persistence-review-*` directory under `TEMP`.

The combined probe took 0.453 seconds wall-clock engine invocation, including
0.093 seconds inside the fixture. Relevant output:

```
NESTED_MUTATION_REVIEW calls=791
WRITER_B_RESET true disk_medal=false
STALE_WRITER_A_SAVE true disk_medal=true
```

Measured inspection and reporting time is recorded in
`logs/playful-feedback-timing.csv`.
