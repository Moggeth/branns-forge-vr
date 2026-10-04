# Public rooms and measured performance pass

Baseline: `origin/main` at `0aa1770`. Branch: `codex/public-rooms-performance`.

## Delivery state

The cloud directory, network-only discovery controller, packet preparation improvements
and incremental terrain updates are implemented. **The player-facing room-browser UI is
not integrated yet; this is not a completed server-browser release.**

Required Opus UI commission verified personal `fauxgrady@gmail.com`, Claude.ai Max,
and actual `claude-opus-5-5`, but failed at the subscription session limit after 2.482 s.
CLI reported reset at 19:20 Australia/Sydney on October 4. No other account/model,
API billing or extra usage used. Isolated brief/output folder:
`work/opus-public-room-browser-20261004`. User was asked whether to reuse existing
themed controls or wait for Opus; no answer received at this checkpoint. Do not
claim an authored Opus design or substitute one silently.

Next: obtain the design/override, integrate Find a world in lobby and menu, wire the
discovery controller to it, verify mobile/desktop browse-and-join, then deploy the
backward-compatible Worker v2 migration before the website. No production deployment
performed in this checkpoint. Keep this branch draft until that flow is complete.

## Public directory

`GET /peer/rooms` returns at most 50 rooms and a nextCursor. Room coordinators publish
display names, counts and availability; they never expose connection secrets, peer
IDs, ICE or saves. Everyone can discover multiplayer games; there is no privacy toggle.
Solo remains local. Full and waiting-for-host rooms cannot be joined from the planned
browser. Existing join-by-code validation remains authoritative if a list changes.

Directory updates on membership/handoff and every minute while occupied. Entries expire
at 150 seconds without refresh, and empty rooms are removed immediately. A separate
read-only endpoint has browser origin checks and a 60/minute/IP limit. All writes are
internal DO binding calls. Storage is paginated, with stale cleanup; each room adds
roughly one directory refresh/alarm per minute. Preserve original ForgeRoom namespace.
See `multiplayer/cloud/README.md` for deployment, migration and operational details.

`client/public-room-directory.js` owns fetch/pagination/cancel/error logic separately
from UI. It polls only while opened/visible, aborts on close, ignores stale responses,
times out at 8 seconds and preserves the last good list on failure. It does not poll
during ordinary gameplay. This controller needs a visual client before players use it.

## Performance changes and measurements

| Workload | Before | After | Scope |
| --- | --- | --- | --- |
| Host snapshot publication, seven guests | 1.570 ms mean / 2.476 ms p95 | 1.119 ms mean / 2.098 ms p95 | Actual snapshot quantization, diff and encoding; excludes WAN/rendering |
| Eighteen seven-guest checkpoint fanouts | 163.379 ms | 29.887 ms | Same bytes/fragments, about 82% less CPU |
| Local deformation mesh updates | 2.686 ms mean / 2.917 ms p95 | 0.339 ms mean / 0.440 ms p95 | Same 25,921 vertices, 51,200 triangles |
| Representative ground upload request | 622,104 bytes | 1,212 bytes | 37 changed position / 64 normal vertices |

Networking prepares immutable JSON/UTF-8/base64 once per publication kind, retaining
independent per-peer assembly IDs, sequence bases, resync and epochs. It coalesces
obsolete snapshots in a delayed timer while preserving all 60 Hz authoritative steps
and events. An empty room avoids guest encoding. Send failures and per-fragment
backpressure remain bounded. Wire bandwidth and checkpoint precision are unchanged.
The short network benchmark maximum did not improve (2.796 to 3.095 ms); these figures
do not establish elimination of every hitch or an overall FPS improvement.

Terrain updates preserve exact Three area-weighted normals and geometry bounds. Dirty
positions and neighboring normals alone are recomputed/uploaded; large changes use a
full pass. Queued full updates stay full until GPU upload even if later partial updates
arrive. No resolution, animation rate, object-count, art or shader reductions.

## Verification

- Room metadata/expiry/pagination pure tests and actual DO storage logic checks pass.
- Live local Worker directory create, list, names/no secrets, full, handoff, waiting,
  empty removal, CORS and public-write rejection: 1.057 s command wall time.
- Existing local cloud protocol/recovery checks: 0.511 s.
- Real Chromium direct sessions, replication, signaling outage and host handoff: 5.673 s.
- Real Chromium forced-relay sessions, replication and handoff: 17.177 s.
- Eight real browser sessions join/replicate: 4.746 s; seven direct edges; zero simulation
  overruns in this short run, maximum observed step 3.6 ms. This transport harness does
  not render eight full game worlds or measure separate-network latency.
- Twelve focused session/codec/peer suites: 1.376 s internal runner time.
- Terrain oracle: 57 exact position/normal/bounds comparisons, including animation,
  edit removal, boundaries, foundations and queued uploads. WebGL: 25 pixel-identical
  renders (15,360,000 channels), no browser errors. CPU oracle command 0.792 s; browser
  command 1.666 s. Existing terrain presentation checks pass.
- Production build passes, 1.495 s. Existing large-bundle warning remains.

Root CI log: `logs/public-rooms-performance/ci.log`. Per-lane evidence is ignored under
`logs/performance-network` and `logs/performance-render`. Root timings: `logs/work-timing.csv`.
Physical phone/headset, public-room UI, separate-network acceptance and long GPU soak
remain unverified. Do not claim all graphics issues or frame drops have been fixed.

## Durable lessons

- Prepare packets explicitly per publication/connection/epoch; never cache mutable source
  objects by identity. Preserve per-peer resync even when encoded bytes are shared.
- Benchmark checkpoint fanout with desktop roster flags: only eligible desktop hosts get
  frequent recovery points; missing flags accidentally benchmark the slower backup cadence.
- Initialize both terrain benchmark baselines identically. Compare mesh components with
  a first-mismatch report; huge typed-array assertion dumps obscure useful evidence.
- CPU-correct partial geometry can still render incorrectly if pending full GPU uploads
  are overwritten by partial ranges. Test multiple snapshots before a rendered frame.
- The first monolithic shell edit was rejected by automatic review. Ordinary apply_patch
  file edits succeeded; no service/policy bypass was attempted. Use focused file edits.
