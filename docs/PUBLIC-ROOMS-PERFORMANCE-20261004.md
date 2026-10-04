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

- Final blocking CI: **136/136 suites passed**, 72.3 s runner time. Initial run was
  134/136: two tests extracted rebuildGround without providing its new dependency.
  Both now instantiate the actual terrain updater; all original assertions remain.
- Integrated desktop and touch-emulation solo/render smoke passed in 13.269 s.
- Draft review: https://github.com/Moggeth/branns-forge-vr/pull/39. Owned local
  Wrangler and Vite QA processes were stopped after verification.
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
- Source-extraction fixtures must provide newly introduced real dependencies. Missing
  test bindings are not runtime rendering failures; preserve their behavioral assertions.
- The first monolithic shell edit was rejected by automatic review. Ordinary apply_patch
  file edits succeeded; no service/policy bypass was attempted. Use focused file edits.

## Expanded 32-player battle work (in progress)

The user extended this pass to32 human seats plus bots and an optional opposing-wave mode. Capacity and battle authority are committed on the same draft PR; UI and final integration remain in progress. Current milestones: crowd animation a6d5c66, capacity bad399a, battle authority cbbd07c, objective presentation0f24295. Existing upstream proximity voice4878b54 was integrated as27cc2f3, retaining both sets of CI checks. These commits are pushed to private origin/codex/public-rooms-performance; none establishes a production release.

Battle mode uses Dawn/party and Dusk/rivals, existing authored skeletons and sanctuary models, four soldiers per side every15seconds,16 living soldiers per side. Wave bots have separate human-slot accounting but share the existing64-enemy safety cap with neutral creatures. Bases have400HP. The host can start/reset/disable; disabling cleans only battle content. Normal melee/projectiles, Timberline and God offensive spells damage opposing objectives. Healing/blessing supports allied soldiers. Existing environmental fire remains dangerous to either side; existing summon spells remain neutral. Human-versus-human weapon combat is not introduced: this is team objective combat with bots, not a complete competitive MOBA.

Gameplay evidence:11 battle regressions, actual authored-world navigation/combat/victory, checkpoint continuation, malformed save refusal, faction protection, paired spawn fairness at world cap, ownership after disconnect.32 humans+32bots+64terrain edits averaged0.435ms/tick in600 CPU-only steps. Root1200-tick input/projectile fixture: mean0.385ms,p95.564ms,max3.954ms,0over16.7ms; no GPU/WAN claim.

Rendering: remote Hero CPU mean0.757->0.310ms with32 Heroes (16VR) and64 skeletons.97,280 bone matrices matched reference;96.3% fewer redundant hierarchy refreshes. Actual RTX3080Ti browser crowd fixture800x450:1,025 actor draw calls,1.279Mtriangles; mean interval8.405ms over25frames. This excludes full world/effects/network/shadows and exposes a remaining mobile draw-call risk.

32 real lightweight Chromium sessions passed both direct and forced-relay connections, all-player input, replication and host transfer. No codec rejects. Direct worst arrival gap240.6ms; relay one peer below20Hz. Full exact checkpoints still create substantial uplink load; a separately verified delta recovery stream is being implemented. No promise of hitch-free32-phone or32-headset sessions.

New lessons: use actual model world elevation for sanctuary ray fixtures; y=0 assumptions can miss valid geometry. Shared battle helpers require their real nextId context. A test literal saying eight players is obsolete when room capacity changes; retain actionable error assertions. Voice requires spatially bounded topology, not a32-person full mesh. Preserve all CI lists when incorporating another feature's runner changes.
