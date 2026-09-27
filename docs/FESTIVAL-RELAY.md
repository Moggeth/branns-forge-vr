# Festival Relay

An optional tour of three existing physical activities. The relay board is at Bellworks local `(2.5, 1.55, 7.8)`, facing inward. Visit lands on the existing clear fair arrival `(120, 0, 70)`. Visiting never starts a run.

Choose **Practice** for no displayed clock, or **Personal Best** for an elapsed clock with no deadline or failure timer. Starting an already-running relay does nothing; **Restart** explicitly starts over in the current mode. **Abandon** clears the run. Both preserve medals and best times.

1. **Ring:** make three fresh, valid Sunskipper strikes on any visible Bellworks bell. Repeated notes count. This works during the existing moving-gold trial and after the ordinary fair reward has been earned. Existing fair progress is untouched.
2. **Cargo:** settle the three matching parcels and pull the bloom lever for a new delivery. A delivery completed before this leg cannot count. If the existing cargo is already ready or blooming, **NEXT** explicitly resets those parcels once; the board and completion notice say so. An unfinished arrangement remains in place. Repeated NEXT does not erase an in-progress delivery.
3. **Garden:** hold the starter glow pebble within 1.8m of SUN, then grip the starter handbell near SONG and trigger/click to ring it. The two actions may also be performed in the opposite order. The relay requires newly presented held light and freshly emitted sound after this leg begins. Existing bud and chorus completion is preserved and cannot silently satisfy the leg.

**NEXT** travels to the current task. Completion never teleports the player. Held tools, garden objects, cargo lever grips, and Firecraft grips must be released before relay travel. Cargo and garden have compact relay wayfinding posts with NEXT, RETURN TO RELAY BOARD and ABANDON; the posts are hidden and their hit areas disabled when the relay is idle. Cargo post: local `(-4.5, 1.65, -4.4)`. Garden post: local `(3.5, 1.55, 6.5)`, facing inward and parented to the garden's own root for automatic retirement.

The timed clock includes travel and preparation. The optional medal records finishing all three activities; there is no bonus for speed, and practice earns the same medal.

## Integration

`godot/festival_relay.gd` exposes:

- `setup(game)`, `tick(delta)` and `act(action)`; actions are `visit`, `practice`, `timed`, `restart`, `abandon`, `next`. World buttons route through `festival:`.
- `progress_snapshot()`, static `fresh_state()`, static `_valid(value)` and `restore_progress(value) -> bool` for durable achievements only.
- Read-only-by-convention transient fields `mode` (`idle`, `running`, `complete`), `stage` (0 ring, 1 cargo, 2 garden), `timed`, `elapsed`, `ring_hits`, `cargo_armed`, `light_done`, `sound_done`.
- Public `board`, `label`, `cargo_post`, `garden_post` for inspection and separate visual decoration.

Setup connects the existing fair's `bell_struck(index)` signal. That signal is emitted only after real collision, speed, cooldown and launch-lane checks, before the fair's already-ready shortcut. Cargo baseline is recorded once on entering its leg; an unready arrangement must be observed before a newer `state.rounds` can complete it.

For garden preparation, NEXT reads the canonical packaged `res://living_unfinished_lullaby.json` only when neither active nor wanted package exists. It uses the existing `living.publish` lifecycle. Pending publication prevents duplicate requests; generation checks discard stale asynchronous completion after restart/abandon. A later NEXT waits for an active garden before safe travel. Existing packages and objectives are never replaced, reset or removed by the relay.

Garden sensing reads existing component held ownership and stimulus records. A held light already presented when the leg binds must leave/re-enter or be released/regripped. Sound must belong to this active garden, be emitted after the stage's component-clock baseline, have canonical handbell strength 6, originate within 0.35m of the currently held handbell, and be within 1.8m of SONG. The finale's strength-4 sound and foreign/old sounds cannot count. Retirement or reload cannot reuse stale root identity. No native component/schema additions or arbitrary scripts are introduced.

## Persistence and diagnosis

Normal play saves only `{schema:1, revision, medal, completions, timedCompletions, bestSeconds}` to `user://festival_relay.json`. `revision` is bounded to 100,000,000, counts to 1,000,000, and finite best seconds to 604,800. A medal exists iff at least one completion exists; positive best seconds exist iff there is a timed completion. Strict validation rejects unknown/transient fields and inconsistent values. The normal writer validates a flushed temporary file, preserves the prior valid primary as `.bak`, then renames the temporary file into place. Startup selects the highest valid revision among primary, `.tmp`, and `.bak`.

Diagnostic and smoke setup disable normal-save access. The separate demo adapter may persist these same achievements in its explicitly enabled demo namespace; it never restores a running relay, stage, elapsed timer, hand ownership or world poses. Old demo saves without a relay field remain valid through the adapter. Save failure is reported on the board. Runtime startup prints `FESTIVAL_RELAY_READY`.

Run the focused native check from the project directory:

```powershell
./tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://festival_relay_checks.gd --quit-after 300
```

The suite covers fresh versus pre-existing actions, actual Living grip and trigger paths, completed gardens, cargo preparation idempotence, delayed publication, held-object travel guards, post visibility/collision/lifetime, strict persistence, interrupted-save recovery and transient reset. Save fixtures use unique OS TEMP directories and are removed afterward. It does not access normal user saves. The coordinator additionally owns the full-process walkthrough using real Sunskipper flight, magnetic forces, cargo lever input and garden controls.

Keep `--xr-mode off` in headless checks: a headless display alone does not disable project OpenXR startup. Hidden Node3D controls still retain physics hit areas; relay post visibility explicitly changes their collision layers too. Posts must be parented to the garden root and disabled when the package is inactive, because the Living deactivator only owns declared entity colliders.

Measured step timings are in `logs/playful-encounters-timing.csv`.
