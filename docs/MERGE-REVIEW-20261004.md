# Combined branch review — 2026-10-04

Integration PR #41 combines the living landmarks (#26), smooth earth presentation
(#34), apples (#37), and reforged Siegebird (#40). Claude merged #37 and #40 while
this review was in progress; their latest main history is preserved. Original
branch ancestry is retained for the remaining PRs. Review used an isolated
checkout; the original main's three unpublished asset-browser commits and
untracked Godot files were not modified.

## Conflict decisions

- Preserve current voice pose callbacks, renderer readiness, collider debugging,
  32-player limits and apple disposal alongside the new landmark interactions.
- Keep `terrain-geometry.js` as the sole incremental terrain uploader. The earth
  presentation uses fractional render time while preserving pending full uploads
  and existing normal updates. Do not restore the competing ground-refresh module.
- Keep authored Siegebird sight geometry and mechanism clearance fixes; do not
  restore the obsolete procedural scope branches.
- Fresh-profile apple browser tests dismiss release notes through the real Got it
  button before expecting active controls. Gameplay input is not bypassed.
- Desktop acceptance disables WebXR by default. `BROWSER_QA_XR=1` explicitly
  enables physical XR testing; close any test-owned VR runtime afterward.

## Verification

- Landmark integration: 156/156 Node suites and production build passed.
- Final combined gameplay code: 158/158 Node suites passed (117.4 seconds).
- Actual browser terrain renderer: 25 GPU output comparisons, 614,400 channels
  per comparison; triangle count unchanged at 51,200. Measured mean geometry
  update time 3.284 ms before versus 0.304 ms after on the review machine.
- Landmark GLB rendered without browser errors: 46,328 triangles, seven draws,
  below its 64,000-triangle budget. Lit runes and open gate were inspected.
- Siegebird sight, moving cords and reload checks passed; the integrated model
  was also inspected in the actual running game without browser errors.
- Apple browser acceptance passed shooting, landing, collection and eating;
  health increased from 64 to 100, and the consumed apple was removed.
- Timberline browser acceptance passed mounting, firing, cutting apples into
  halves, dismounting, navigating around the tree, collecting and eating a half
  in 31.464 seconds, without browser errors or waking SteamVR.
- No physical phone/headset or 32-human-player acceptance is claimed.

Ignored evidence is under `logs/` in the review checkout, including
`combined-ci.log`, `combined-browser/`, `combined-siegebird.png` and
`pr26-landmarks.png`. GitHub CI verifies the final PR head before merge; the
existing main CI/deploy workflow determines publication separately.

## Measured steps and lessons

| Step | Seconds | Outcome |
|---|---:|---|
| Discovery | 1.046 | Branch, local changes and private remote identified |
| Fetch and isolated checkout | 6.778 | Original user work preserved |
| Dependency setup and initial conflict edit | 2.492 | Dependencies installed |
| Invalid initial conflict-resolution trial | 63.5 | Discarded; bad regex removed too much source |
| Corrected landmark suites | 78.8 | 156/156 passed |
| Landmark production build | 1.251 | Passed |
| Terrain geometry regression | 0.648 | 57 comparisons passed |
| Foundation regression | 0.346 | Passed |
| Spell availability regression | 0.161 | 923 cases passed |
| Combined suites | 117.4 | 158/158 passed |
| First apple browser acceptance | 33.625 | Release-notes overlay prevented active controls |
| Corrected apple browser acceptance | 32.544 | Complete interaction passed |
| Reconcile independently merged Siegebird | 0.410 | Clean merge; no content delta |
| Timberline browser first navigation | 36.697 | Straight-line walk could not reach fallen half |
| Navigation diagnostic | 38.583 | Dismounted correctly; no browser errors; path blocked |
| Side-step navigation attempt | 28.776 | Reached fruit proximity but trunk blocked collection |
| Pickup diagnostic | 26.963 | Confirmed player and fruit were on opposite sides of trunk |
| Timberline clear-path acceptance | 31.464 | Complete interaction passed; no browser errors |

Timberline browser lesson: a straight-line keyboard driver is not a pathfinder.
The firing line passes through orchard trunks; navigate around the tree and
approach fallen halves from their visible side. Do not weaken collision or
pickup line-of-sight checks just to satisfy an acceptance fixture. Failure
records now include positions and fruit state to distinguish navigation from
gameplay failures.

Desktop VR lesson: even checking WebXR support can wake the local OpenXR/SteamVR
runtime. Headless mode alone does not prevent that. The shared browser launcher
now disables XR and hides `navigator.xr` in ordinary acceptance contexts. SteamVR
was closed and stayed closed during subsequent desktop acceptance.

The user also reported cursor confinement during capture acceptance. No test
browser remained running after the completed tests, and the owned port-5198 Vite
server was stopped. Native pointer lock is now blocked by default in the shared
Windows QA launcher. Capture-dependent apple tests fail before opening Chromium
unless explicitly opted in; prefer an isolated runner for those tests. This
prevents a repeat rather than relying only on closing the browser afterward.

Conflict editing lesson: never use a DOTALL `.*` to delimit conflict-marker
headers; it can consume multiple blocks. Restrict headers to `[^\n]*`, inspect
diff sizes and run syntax checks before a full suite. Restore only owned
conflicted files if a resolver fails, never reset an entire working tree.

Concurrent author updates: a non-fast-forward push was safely rejected. Fetch
and merge the new head; do not force-push another agent's branch. Integration
branches allow combined review while authors continue working.

Browser fast path: use the existing installed Chromium through `PW_CHROME` and
cached Playwright through `PW_CORE` rather than downloading another browser.
Existing acceptance helpers need these explicit paths on this machine. Quote
agent-browser element references in PowerShell (for example `'@e36'`).

Git account routing: use the absolute `scripts/gh_account.py` from the original
checkout until the separate asset-browser work is published; this helper is not
yet present in upstream review checkouts. Select Moggeth per command without
printing credential material or changing the work account globally.

Documentation encoding: the root README contains legacy non-UTF-8 bytes. Apply
small ASCII insertions as byte-preserving edits rather than decoding/re-encoding
the entire document. A UTF-8 patch read failed safely before changing it.
