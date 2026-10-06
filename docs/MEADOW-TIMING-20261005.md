# Meadow refill timing check

Initially prepared against `b62720d9da72bd0e7a7029124411b480d9dbd2f8` as a
local-only proposal. The initial verification below preceded publication approval.

## Reproduction and scope

[Main run 37313160088](https://github.com/Moggeth/branns-forge-vr/actions/runs/37313160088)
passed 179/180 required suites. The sole failure was a walking meadow refill of
8.319 ms against the existing 7.5 ms limit (`FILL_BUDGET_MS + 6`). Meadow source
and its test were byte-identical to the preceding green main. PR57's own CI
passed all 180 suites. This supports timing sensitivity; it does not identify
whether that particular interruption was scheduling, GC or another cause.

The fix changes tests only. Seven independent meadows are each settled at the
original camera position, then measured on their first 2.5 m walking step.
Six of seven must stay below the unchanged 7.5 ms limit. Two slow measurements
fail, even if five are fast. All samples, the second-slowest and the maximum are
reported. This explicitly tolerates one outlier; it is not a worst-frame or
physical-device performance guarantee.

Existing geometry, density, distance, draw-call, phone/XR tier, convergence,
terrain response, clearances, shader and disposal assertions remain. Every
timed sample must advance the fill counter exactly once and retain four draws
and a populated bounded grass mesh. Fresh fixtures prevent measuring no-ops or
repeatedly warmed destination cells. Temporary sample resources are disposed.

## Fault-injection verification

`node tests/meadow-timing-guard.mjs` runs the actual meadow suite in three child
processes. Its test-only ESM loader inserts real 20 ms pauses inside walking
refills, before their elapsed time is recorded. It transforms the module in
memory and never writes runtime files. The loader fails if its instrumentation
point changes. This regression is included in required CI.

| Scenario | Baseline | Candidate | Intended result |
| --- | --- | --- | --- |
| No injection, 10 runs each | 10 pass | 10 pass | Pass |
| One interrupted refill, 3 runs each | 3 fail | 3 pass | Candidate tolerates one interruption |
| Two slow refills, 3 runs each | 3 fail | 3 fail | Reject repeated slowdown |
| Every sampled refill slow, 3 runs each | 3 fail | 3 fail | Reject sustained slowdown |

All 38 runs matched expectations in 14.398 seconds on this Windows Node
24.14.0 executor. Baseline ordinary refills were 0.117–0.145 ms; candidate
ordinary samples were 0.055–0.280 ms. Injected slow samples measured at least
20 ms. The baseline fails on its first measured slow refill, before it could
observe later injections; the candidate's end-to-end guard verifies all seven
sustained injections and that only the intended performance assertion fails.

Raw comparison, per-run logs, required build and aggregate CI output are under
ignored `logs/meadow-timing/`. `npm run build:check` passed; all **181/181 required
suites passed in 128.7 seconds**, including the new fault-injection guard.
At initial preparation, Linux GitHub execution was unverified because
remote CI was deliberately not run. The nine existing non-blocking legacy
suites are outside this fix and were not reclassified or rerun locally.

## Review handoff

Main and the PR57 Claude branch did not advance during preparation. No open PR
was present at the initial check; the final check found the unrelated Phoenix
art PR58. No competing meadow timing fix was identified. The visible Claude
UI showed its project list; remote session activity cannot be proven idle.
Recheck ownership and main before publishing. A successful main CI rerun would
automatically deploy the pending welcome-screen change, so it is not a harmless
way to validate this local proposal while publication is on hold.

## Authorized integration - 2026-10-06

Mitch authorized merging the performance-test fix. Fresh ownership checks found
main at `0a256d1da71b4e9b76fed23efae5720b5d63ec35`, with no equivalent meadow
change. Open Claude PRs 58, 59 and 60 concern Phoenix, Emberdew and Wyrmspout;
none changes the meadow test or runtime. Those PRs are outside this fix.
The isolated patch rebased cleanly onto current main, retaining all new required
suites. Publication uses exact-head PR CI and the existing automatic main CI /
deployment workflow; it does not change runtime code or workflow protections.

Rebased local verification: **184/184 required suites passed in 105.4 seconds**
on Windows Node 24.14.0. `npm run build:check` and the production `npm run build`
both passed (existing large-bundle warning only). The patch-note guard reports
no game files changed; runtime paths have an empty diff against current main.
Fresh logs are in ignored `logs/meadow-merge/`. GitHub's Node 22/Linux result
will be recorded on the PR before merge.
