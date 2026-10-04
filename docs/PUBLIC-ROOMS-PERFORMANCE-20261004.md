# Public rooms and measured performance pass

Baseline: `origin/main` at `0aa1770`. Branch: `codex/public-rooms-performance`.

## Delivery state

Public-world discovery, the mobile-first Opus browser, optional Battle controls,
32-human room capacity, compatibility negotiation, bounded voice and exact recovery
deltas are integrated on PR #39. Release verification is in progress; production
status must be checked before calling this live.

The initial Opus call hit its session quota after 2.482 seconds. After the supported
reset, the completed commission verified personal `fauxgrady@gmail.com`, Claude.ai
Max and actual `claude-opus-5-5`; it took 235.275 seconds. No API billing, extra usage
or account/model workaround. Outputs: `work/opus-public-room-browser-20261004`.
Codex integrated the concrete UI files and corrected mobile space, focus, pending
join and stale-confirmation behavior. Actual 390x650 and 844x340 layouts passed.

Deploy the backward-compatible Worker v2 before this frontend. The live deployment
workflow now checks both directory readiness and 32-seat service capacity first.
Old clients retain eight-seat compatibility; new Battle mode requires all retained
room members to refresh. No existing members are evicted to change capacity.

## Public directory

`GET /peer/rooms` returns at most 50 rooms and a nextCursor. Room coordinators publish
display names, counts and availability; they never expose connection secrets, peer
IDs, ICE or saves. Everyone can discover multiplayer games; there is no privacy toggle.
Solo remains local. Full and waiting-for-host rooms cannot be joined from the
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
during ordinary gameplay. It is wired to the public-world dialog.

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
- PowerShell nested Python quotes caused a syntax error in an attempted CI-list edit.
  Use apply_patch or a single-quoted here-string piped into Python; do not build nested
  shell quoting for multi-line edits.
- A successful UI component render does not establish mobile integration. The existing
  lobby/footer and menu tabs consume real space: verify actual game layouts at390x650
  and844x340. Keyed rows must retain focus through refreshes; stale confirmations must
  cancel when authority, connection or Expedition state changes.

## Expanded 32-player battle work

The requested 32 human seats and optional opposing waves are implemented. Browse
public worlds from the welcome screen; hosts use Menu > Battle to enable, reset or
disable waves. Every multiplayer room is public; solo is local. This is a supported
capacity with bounded resources, not an unconditional device performance guarantee.

Battle mode uses Dawn/party and Dusk/rivals, existing authored skeletons and sanctuary models, four soldiers per side every15seconds,16 living soldiers per side. Wave bots have separate human-slot accounting but share the existing64-enemy safety cap with neutral creatures. Bases have400HP. The host can start/reset/disable; disabling cleans only battle content. Normal melee/projectiles, Timberline and God offensive spells damage opposing objectives. Healing/blessing supports allied soldiers. Existing environmental fire remains dangerous to either side; existing summon spells remain neutral. Human-versus-human weapon combat is not introduced: this is team objective combat with bots, not a complete competitive MOBA.

Gameplay evidence:11 battle regressions, actual authored-world navigation/combat/victory, checkpoint continuation, malformed save refusal, faction protection, paired spawn fairness at world cap, ownership after disconnect.32 humans+32bots+64terrain edits averaged0.435ms/tick in600 CPU-only steps. Root1200-tick input/projectile fixture: mean0.385ms,p95.564ms,max3.954ms,0over16.7ms; no GPU/WAN claim.

Rendering: remote Hero CPU mean0.757->0.310ms with32 Heroes (16VR) and64 skeletons.97,280 bone matrices matched reference;96.3% fewer redundant hierarchy refreshes. Actual RTX3080Ti browser crowd fixture800x450:1,025 actor draw calls,1.279Mtriangles; mean interval8.405ms over25frames. This excludes full world/effects/network/shadows and exposes a remaining mobile draw-call risk.

32 real lightweight Chromium sessions passed direct and forced-relay connections,
all-player input, replication and host transfer. After exact checkpoint deltas:
direct peers received120 snapshots in6seconds, worst peer p95 arrival gap57.8ms;
relay120-121, p95 <=60.2ms. No codec rejects. Final compatibility release rerun passed: direct9.687s, relay16.483s;
120-121 snapshots/client/6s, worst-peer p95 gaps58.7ms and75ms respectively;
maximum gaps84.7ms and108.5ms, no errors, checkpoint host transfer passed. This tests real transport, not32 full renderers or WAN latency.

Exact recovery deltas reduce measured checkpoint traffic63.17->10.65MB (83.1%)
and total heavy31-guest wire traffic104.08->51.56MB (50.5%), preserving values and
cadence; extra checkpoint CPU0.36ms. Voice is bounded to eight nearby edges/client
(127 pairs instead of496 full mesh), with moving2Hz/static0.5Hz presence. Measured
forwarded voice presence traffic fell81%; actual three-browser synthetic-audio
recovery passed17.224s. Physical microphones remain unverified.

### Loading and actual full-scene rendering

The empty lobby prepares the real default terrain, vegetation, character and bot
materials, textures and shadow shaders before reporting ready. No art reduction,
world stepping or network authority occurs in the render-only preview. Deferred
activation honors cancellation. Asset errors remain visible in diagnostics.

On RTX3080Ti at960x540, empty lobby ->32heroes/32bots measured startup2.503s,
132texture uploads; worst postready render CPU1851->89ms, largest frame interval
342ms. First populated snapshot still costs261ms. FPS view retains2241draws and
3.47Mtriangles. This moves compilation into honest loading; it does not prove a
steady FPS gain. The latest shared-machine steady p95 CPU15.3ms/GPU15.32ms must
not be compared as an isolated-device speedup. Custom saves, unusual effects,
phone/headset GPUs and first-join actor creation can still hitch.

Browser benchmark: `node tests/browser-battle-render-load.mjs`, wait for
`canvas.brannDiagnostics().startup.ready`; final run39.853s. Local evidence:
`logs/performance-render-32/warmup-preview-sync/`. The failed compile-only and
populated-before-loading approaches missed real empty-lobby behavior. Always test
empty-lobby -> joined world; compileAsync alone omits shadow warmup and late
material variants. Avoid concurrent full-game browser tests during GPU measurement.

New lessons: use actual model world elevation for sanctuary ray fixtures; y=0 assumptions can miss valid geometry. Shared battle helpers require their real nextId context. A test literal saying eight players is obsolete when room capacity changes; retain actionable error assertions. Voice requires spatially bounded topology, not a32-person full mesh. Preserve all CI lists when incorporating another feature's runner changes.

## Release verification checkpoint

- Local CI151/151 passed in80.8s after upstream Timberline integration; build2.908s.
- Public discovery/join/side choice/enable/disable, solo host and real mobile menu:
  final12.344s, no browser errors.390x650 portrait and844x340 landscape fit.
  Eight separate component focus/error/stale-confirmation checks passed0.713s.
- Short-landscape host confirmation initially overflowed105px (12.518s failed run).
  Explicit grid placement now shares available columns; confirmation temporarily
  replaces live stats while keeping the objective and action explanation. Running
  host panel also verified. Test host controls, not only guest menus.
- Cloud Worker d69d55b8-85bb-4db8-ac85-e46910e0f6f2 deployed; upload1.54s,
  trigger deployment0.69s. Hosted readiness0.615s; protocol6.234s and directory
  lifecycle8.376s passed against the actual public endpoint.
- Existing voice and Timberline commits were cherry-picked and conflicts reviewed.
  8a81eef records their already-integrated ancestry; it changes no tree content.
- Authentication downgrade review found old tabs could replace a new member in
  small rooms; fixed in f00e283 with13 focused checks in1.841s. Preserve the old
  connection and require refresh when credential capability would decrease.
- Frontend publication and hosted UI acceptance are pending this checkpoint.
