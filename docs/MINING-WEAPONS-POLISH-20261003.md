# Mining, weapons, UI and performance polish

This pass implements the user's 90827624 mining/weapons polish brief. Source
ownership stayed with the coordinator during integration; Claude worked only
in isolated commission folders. The old expiry sprint remains paused.

## What changed

- StarShard fracture openings leak restrained violet-blue shafts and reveal a
  progressively luminous chamber. Only actual removed shell cells emit light.
  Saved damage restores without replaying chips. Ordinary stone stays unlit.
- Stonewhisper's extra top ridge is removed while retaining its six crystals,
  gold settings, shaft details, sockets and core pickaxe silhouette.
- Siegebird's strings and pull rope now follow the moving reload sled, with
  fixed limb/drum endpoints. Its original geometry and materials are retained.
- Subtle weapon-specific reticles cover Siegebird, Emberwing, Ember Dew and
  Wyrmspout. Emberwing's curved draw shows a guide integrating the same 60 Hz
  curl, drag and gravity as the authority. The guide stops at terrain/props;
  it is a trajectory forecast, not an enemy lock or guaranteed hit.
- Flight streaks improve arrow/bolt visibility. Bolts penetrate skulls using
  measured part thickness and keep bone-local cracks through detachment and
  grabbing. Local FPS held parts follow the camera grip, including pitch.
  Existing VR hand centering remains authoritative.
- Ember Dew has a shared inexpensive liquid shader with damped slosh and a
  clear lit wick/collar. Local held and thrown bottles use it. Throws inherit
  authoritative player velocity, including sideways motion and jumping.
- F9 or the Hero/God top-bar button switches perspective. The existing two
  second role-change cooldown has an explicit remaining-time explanation.
  XR users leave the immersive session before changing to the God camera.
- Long spell names, names, objectives and help captions wrap. The compact
  objective and field guide work at narrow portrait/landscape sizes and 150%
  layout scaling. Required content remains reachable in constrained panels.
- New shared forest materials improve bark, root collars, canopy shading,
  variation and wind on intact instances and wounded/falling trees.

## Pick provenance

The disliked ridge came from **Opus 5.5**, not a guessed worker: the earlier
weapon-mastery commission's handoff described its dark-metal spine plates.
It was integrated in commit 576c2d1. That commission measured 680.545 seconds.
The current restoration uses verified Opus 5.5 and removes the named
Embellish_Darkmetal_Spine component. Before/after orthographic images and the
actual first-person build were inspected. The restored asset is 6,060 triangles,
10 primitives, five materials and three textures; sockets/bounds are retained.

## Verified commissions and ownership

All four metadata records verified fauxgrady@gmail.com, Claude.ai Pro,
explicit claude-opus-5-5, and matching actual initial/final model metadata.
No API billing or paid extra usage was enabled.

| Isolated work folder | Measured seconds | Integrated output |
| --- | ---: | --- |
| work/opus-weapon-restoration-20261003 | 263.117 | Pick GLB/build source; crossbow restoration findings |
| work/opus-forest-material-scale-20261003 | 399.339 | Shared forest material/shadow kit |
| work/opus-geode-emberdew-light-20261003 | 442.269 | Geode shafts and bottle presentation |
| work/opus-ranged-aim-feedback-20261003 | 399.619 | Reticles, trajectory, streaks and embed cracks |

Root integration corrected shared resource ownership, actual fracture-hole
discovery, exact authoritative forecast tests, part-size crack scaling,
nonuniform tree normals, continuous wind time and production lifecycle hooks.
The exposed geode chamber received restrained emission after actual browser
inspection showed shafts emerging from a dark interior; a first tuning was too
bright and was reduced. No bloom or additional light was introduced.

## Busy errors and capacity

The former broad rate/busy/limit fallback concealed several independent causes.
Cooldowns now name the action and remaining time. Creature, grove, bridge,
projectile, falling-meteor, loose-resource and mineral capacity messages explain
the relevant action. A damaged forge explains repair/recovery.

Fully mined, unreferenced mineral tombstones are reclaimed safely. Quest,
worker, embedded projectile and live crystal-wall references protect required
records. Pure spell previews use the same predicate as the authority.
Commits d8abb26 and 01f5c1e contain the authority and readiness repairs.

**The 64 permanent terrain-edit capacity is still present.** Axe specials use
six edits, pick walls seven, and long God lines up to nine. Waiting does not
clear this capacity. The message says so. Silently dropping old edits would
undo deformation. The investigated baked-grid checkpoint adds 355,498 bytes
and can exceed the 512 KiB peer envelope in a large world; it needs a separate
revisioned tile-transfer design. It was not inserted as an unsafe quick fix.

## Performance evidence and limits

See multiplayer/FIRE-PERFORMANCE-20261003.md and
multiplayer/FOREST-MATERIALS-20261003.md for reproducible commands and budgets.

Controlled same-process CPU measurements against 96ce51c:

| Work | Before | After |
| --- | ---: | ---: |
| Dense fuel sync, 256 cells / 64 terrain edits | 21.263 ms | 0.125 ms |
| Fire ecology terrain work | 8.954 ms | 1.285 ms |
| Short ground collision ray | 0.864 ms | 0.000090 ms cached |

The fix avoids unchanged topology/height work and tests crossed ground cells,
rather than traversing all 51,200 triangles. Exact geometry parity covers
1,303 ground rays and 24 old/new fuel-buffer cases. Fire remains pooled:
768 instances, four draws, three shadowless lights; requested 10/100/500
fixtures saturate existing capacities instead of allocating unbounded effects.
Transparency/fragment-noise cost remains; these are not headset FPS claims.

The 500-tree fixture uses 12 LOD batches and shared materials. Its deliberately
enabled sun plus point shadow test submits 97 draws / 7,089,882 triangles.
Production continues to disable tree shadows. Far LOD remains about 1,772
triangles per tree; a cheaper authored far silhouette remains useful work.

Geode effects cap at 12 nearby damaged deposits, two extra draws each, with
no lights. Flight streaks use one capped instanced draw; cracks render the
nearest 32 in one draw. Bottle geometry/programs are shared (500-clone resource
ownership tested). The trajectory uses two draws and updates at 15 Hz; the
integrated desktop software-rendered test observed 7.8 ms last / 9.2 ms peak
per forecast. The guide is not free, so its cadence is intentionally bounded.

## Verification and measured work

- 40 focused Node test cases passed in 1.316 seconds, including the real GLBs,
  crossbow mechanics, held embedded skull, shader lifecycle, fire equivalence,
  exact trajectory integration, authority velocity and readiness. The readiness
  suite itself covers 597 generated cases.
- Local peer signaling test passed in 2.089 seconds including command/status.
- Production build passed in 1.882 seconds including dependency audit (30
  packaged texture references). The approximately 473 KiB gzip JS bundle still
  triggers Vite's chunk-size warning; no warning suppression was added.
- Integrated browser equipment/throw/fire/F9/UI pass: 16.227 seconds.
- Real StarShard mining through touch and two actual swings: 7.108 seconds.
- Two independent browser clients joined one room, started an expedition and
  shared a God terrain cast: 11.337 seconds. All had zero console errors.
- HUD agent: 971.512 seconds inspection/repair/verification; final real-input
  test 19.120 seconds across four portrait/landscape/150% layout cases.
- Tree integration: 487.187 seconds; actual GLB browser shader check 3.538 s.
- Geode integration: 315.398 seconds. Fire audit 281.435 s and implementation/
  verification 438.188 s. Individual commands remain in logs/work-timing.csv.

Browser evidence is under ignored logs/mining-polish-final and logs/hud-text.
Run from multiplayer with the documented PW_CORE/PW_CHROME environment paths
and ACCEPT_BASE, against a separate owned peer and built preview. Use
browser-mining-polish.mjs, browser-geode-light.mjs, browser-hud-text.mjs and
browser-friends.mjs. PATCH_HUD_CSS must be unset/0 for built-output acceptance.

Physical phone, physical headset and separate-network play are not verified.
The public peer still depends on the original PC-hosted service/tunnel.

## Published result

Verified source **3e589d7** is live at
https://branns-forge-multiplayer.vercel.app.
Deployment dpl_5DDA3LUxC9DZBURpSZoH2fB6edZf completed in **15.240 seconds**.
The clean source revision is included in the on-screen build tag.

Anonymous production browser equipment/throw/fire/F9/label checks passed in
**19.128 seconds**. Two independent public-site browser clients created/joined
one room, shared an expedition and synchronized a God terrain cast in
**12.092 seconds**. Both suites reported zero console errors. Evidence is in
ignored logs/mining-polish-public. The integrated built-output HUD test passed
in **19.099 seconds**, without source-CSS injection; the final restrained geode
light browser test passed in **7.063 seconds**.

Only owned local QA listeners 8799 and 5188 were stopped after verification.
Original public peer 8789 and its tunnel were preserved. Unrelated Godot UID
files remain untouched. Documentation-only commits after 3e589d7 do not change
the deployed runtime and do not require another deployment.

## Lessons

- Await an observable lit-state threshold, not 350 ms of wall time: software
  rendering with capped frame dt can make a fixed delay fail spuriously.
- Source-string VR assertions needed the new command wrapper name; test the
  real public entry point rather than bypassing error-context recording.
- Read/write code as UTF-8 explicitly in Python on Windows. Default cp1252
  failed on an existing UTF-8 character. For rg, search a directory with -g
  instead of passing unexpanded PowerShell wildcard paths.
- CDP-only device overrides can be reset by screenshots. Use fresh browser
  contexts with explicit viewport/DPR for repeatable zoom-layout tests.
- Test actual taps after fixing text: at enlarged landscape sizes the weapon
  strip and stick intercepted objective actions. Scoped layering fixed this.
- Set BROWSER_QA_DIR relative to the documented multiplayer cwd or absolutely;
  an initial root-cwd geode run put evidence in the parent workspace logs.
