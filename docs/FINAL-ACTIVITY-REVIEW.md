# Cross-activity cancellation review

Review scope: mid-flight travel/abandon, retries after rewards, tool switching,
receiver lifetime and progress leakage. Disposable diagnostic state only; no
normal save access or resident game restart.

## Confirmed and fixed: a pre-start throw counted in a new Festival run

`festival_relay.gd::_start` formerly reset relay counters but left an outbound
Sunskipper active. Starting/restarting a run before that ring reached a Bellworks
bell allowed `_bell_struck` to count the old release as a fresh strike. The
disposable reproduction used real release and swept collision and reported:
`before_run_throw=2 after_hit_throw=2 new_releases=0 relay_hits=1`.

The minimal correction retires a flying or returning ring through its existing
`_home()` method before starting the run. An already held ring remains held.
No receiver protocol, combat rule, travel behavior or reward schema changed.

```text
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://festival_flight_checks.gd --quit-after 600
```

The 10 focused checks cover real pre-start/restart flights, an actual triggered
recall, held-ring preservation, and genuine new releases scoring after the
reset. All pass. The existing 47 Festival checks also pass after the change.

## Other findings

- Current canonical Sunskipper rejects an Echo-owned hand. An initial inspected
  version omitted that system, but root's integrated version and the disposable
  ownership check confirmed `echo_busy=true`, `ring_busy=false`; no extra fix
  was needed.
- Lantern retry/abandon clears the pending throw ID; its existing receiver only
  consumes its own three target bodies. Completed rewards remain separate from
  active rounds. Bankshot similarly clears its current/scored IDs on replay.
- Sunskipper clears remote flights after large travel and weak-reference cleanup
  removes freed/queued receivers. Cargo reset first asks the wand to release the
  specific body, then restores its pose and motion.

Only the reproduced Festival defect warranted a production change in this
review. Source inspection is narrower evidence than headset testing; root owns
the final GPU/package review. The accepted earlier ZIP was untouched.

The original disposable reproduction remains under
`work/cross-activity-review/reproduce.gd`; its old-flight observation now reports
zero after the fix. Timings are in `logs/cross-activity-review-timing.csv`.

Review tooling lesson: on Windows, pass `rg` a real directory with a `-g` glob;
do not pass `godot/living*.gd` as a literal file path. Locate the actual runtime
filename before reading it (`living_runtime.gd` in this project).
