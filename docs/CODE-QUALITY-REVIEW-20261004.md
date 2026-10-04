# Browser code quality and robustness review — 2026-10-04

Reviewed Claude's integrated origin/main at `2d1d42a` in three parallel lanes: gameplay/state correctness, multiplayer/save recovery, and rendering/input/performance. Fixes are on `codex/robustness-20261004`. This is not a production deployment claim. The original checkout's three separate asset-browser/auth commits and unrelated Godot UID files were preserved.

## Confirmed findings

| Priority | Reproduction and impact | Change and regression evidence |
| --- | --- | --- |
| P1 | Kill a stumpling or Ent with arrows embedded in its torso; an immediate checkpoint retains dangling targets and fails to reload (`Invalid embed`). | Remove remaining dead-actor attachments after transferring supported attachments to physical remains. Eight lifecycle cases cover four enemy families and arrow/melee final blows; skeleton/golem attachments survive on their remains. |
| P1 | Disconnect/rejoin while holding ore; saved inventory and dropped pickup both represent the same material. | Account for held ore during reconciliation. Tests exercise repeated reconnects, inventory 999, and empty/almost-full/full 256-pickup capacity. |
| P1 — mitigated | Resume/import a multiplayer save with a full pickup pool. New peer IDs strand materials under obsolete player IDs; the first autosave can overwrite the recoverable original. Reproduced loss of 75 carried mithril. | Preserve the original checkpoint as a distinct inventory-recovery save before publishing/autosaving. Warn that supplies remain in that copy, not the new pack. Stop promotion with an actionable error if backup storage fails. Six tests cover import/resume, full save index, repeated autosave, secret scrubbing, storage failure and normal-capacity/solo behavior. **Direct restoration of original player ownership/inventory remains unresolved.** |
| P2 | RTC data channel closes while signaling and the room host remain online; local peer removal strands the guest, since retry_world does not replace an online host. | Request the existing WebSocket relay and retain membership during recovery. Synthetic host/guest transport tests verify resumed packets and no recovery after deliberate peer removal. |
| P2 | Break/hide a skeleton shield or hide the actor after applying a missing-part mask; teardown skips hidden nodes and leaks private geometry. | Reset masks regardless of visibility. Tests use shipped geometry, verify exactly-once disposal, restore templates and protect borrowed buffers. Reproduction retained three shield buffers (2,253 vertices / 5,946 indices). |
| P2 | Keep Timberline aim stationary while terrain rises/sinks without changing edit count; forecast remains stale (45.083 m versus a 6.567 m collision in the reproduction). | Key cache by the existing terrain/foundation revision stamp and launcher position. Tests cover rise, sink, bake revision, moved origin and reuse of settled results. |
| P2 | Lose browser focus while scoped and miss mouse-up; scope remains latched. | Clear scope with other input states. Regression invokes the actual reset function and verifies scope, aim, crank, movement and outgoing stop state. |
| P2 | Fire overlapping Phoenix bursts; a newer burst resets older ghosts' opacity through one shared material. | Give each bounded burst its own fade material; dispose on expiry, eviction and view teardown. Tests prove independent fading and bounded ownership. |

## Verification

- `node multiplayer/tests/ci.mjs`: **130/130 suites passed**, 72.200 seconds measured wall time. All seven new regression suites are blocking CI checks.
- `npm run build:check` in multiplayer: passed, 1.244 seconds.
- `npm run build` in multiplayer: passed, 1.129 seconds. Vite warns about the 2,155 kB main JS chunk (697 kB gzip). Bundle splitting is a follow-up opportunity, not a demonstrated frame-time fix.
- `node multiplayer/tests/patch-notes-required.mjs origin/main` and `git diff --check`: passed.
- Playwright Chromium desktop 1280×720 and emulated touch 844×390: actual lobby, solo entry, renderer and advancing snapshots passed with no browser errors in 15.102 seconds; captures inspected. This is a runtime smoke test, not full gesture, multiplayer interruption, physical phone or headset acceptance.
- Synthetic simulation stress (8 heroes, 64 mixed enemies, 96 curved arrows): CPU p95 2.692 ms, maximum 7.659 ms. Snapshot 146,696 bytes; encoded wire 55,186 bytes. Excludes renderer and actual network; does not establish device FPS.

No production deployment, live-player interruption, long GPU-memory soak or exhaustive audit is claimed. The highest remaining correctness priority is an explicit saved-player identity/ownership recovery policy, including carried supplies, tool state, health and stats.

## Reproducible commands and durable lessons

Run `npm ci --prefix multiplayer --ignore-scripts --no-audit --no-fund` once when dependencies are absent, then `node multiplayer/tests/ci.mjs`. The runner now anchors child suites to multiplayer, so invoking it from repository root is safe.

- Initial root-CWD CI invocation failed all suites on missing paths in 4.548 seconds. Fixed child cwd; do not interpret missing test files as game failures.
- First proper-CWD run passed 122/123 suites in 66.944 seconds. Sole failure was CRLF frontmatter parsing in the patch-note test; normalize line endings like production rather than weakening content checks.
- Save tests must reload the immediate checkpoint after destruction/reconciliation. A later tick must not be required to repair invalid references.
- Visible-node filtering is appropriate when applying effects, but teardown must visit hidden nodes. Dispose owned clones exactly once; preserve shared templates.
- Caches must invalidate on in-place changes, not just array length. Independent overlapping effects cannot share mutable fade state.
- Material conservation must include held items and capped ground/inventory capacity. Preserve the original save before ambiguous ownership migration; do not claim backed-up supplies are in the new pack.
- PowerShell does not expand positional rg path wildcards: use directory arguments with -g. Use function-specific patch context when guards repeat.
- README contains pre-existing non-UTF-8 bytes. An atomic apply_patch attempt failed before changing files. Insert the new ASCII link at a byte-safe boundary; do not rewrite the entire historical README to repair encoding during an unrelated audit.

Measured setup: discovery 0.263 s; identity/private-repo verification and fetch 3.684 s; isolated worktree 5.868 s; dependency install 8.745 s; focused root regression batch 0.751 s. Detailed per-step and lane timing/reproduction logs are ignored under logs/robustness-review, logs/audit-gameplay, logs/audit-network and logs/audit-render-input. These are diagnostic artifacts, not runtime dependencies.
