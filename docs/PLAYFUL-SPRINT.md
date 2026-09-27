# Bellworks and the playful workshop

## Play

In the normal game, the Bellworks gate stands east of Brann. The palm menu's
Travel page also offers Bellworks Fair, Copper Kite Cargo, Hall of Inventions
and Tune playful tools. Restart the game once for these new engine primitives.
Restart the local service normally to load Brann's new progress context. Existing
running processes were deliberately left alone during development.

For a standalone desktop preview, open **Play Bellworks Demo.cmd** in the project.
It uses no service, paid API, microphone or player saves. Close its window to stop;
logs are in `logs/bellworks-demo.log`. Progress in this demo resets on exit.

- **Sunskipper:** grip/E takes the returning ring. Trigger/click selects gentle,
  courtyard or long throw; release/E throws. Empty-hand trigger/click recalls.
  Bellworks offers three trials: three bells, a four-note melody, then three
  moving-gold hits. Stand behind the gold line. Claim a persistent Bellwright
  trophy and ring accent in the full game; replay never removes the reward.
- **Copper Kite:** cross the fair's east bridge. Grip/E takes the wand;
  trigger/click pulls a marked parcel or gently drops it; A/X flings it.
  Set SUN, LEAF and MOON in their corresponding nests and let them settle.
  Physically grip and pull the lever in VR, or select its button on desktop.
  A copper flower opens and a persistent Copper Gardener trophy appears.
  Only these three explicitly registered parcels respond to this wand.
- **The Unfinished Lullaby:** in the archive's experiment catalog, prepare the
  garden and wait for its ready message, then select Enter Experiment. Its three
  sleeping buds need light, warmth and sound. Starter objects are provided.
  Other supported Living emitters can solve them too. The handbell must be held
  and triggered. Completing three distinct buds opens a copper chorus.
- **Cinderloop:** another optional catalog experiment. Its forge stand is near
  `(-3, 0, 7)`. Grip/E takes it, release/E throws, empty-hand trigger recalls.
  Impacts illuminate its own lantern. This is a reusable data-authored returning
  projectile example, distinct from the bespoke Sunskipper activity.

Six existing-system sliders tune ring strength, gravity and recall speed, plus
magnet range, pull and fling. Full-game settings persist through the service and
support undo. Offline demo settings and undo last only for that session.

## Boundaries, state and recovery

This is deliberately local single-player play. No multiplayer, paid calls,
unrestricted generated scripts or automatic arbitrary-scene modification were
introduced. Living content remains validated, bounded and versioned. Held old
versions defer replacement; an outbound projectile can be retired safely when its
package changes. A new engine primitive still needs a code update and restart.

`user://playful_encounters.json` and `user://copper_kite_cargo.json` retain trial
progress and claimed rewards in the normal game. Both validate primary, temporary
and backup snapshots, choosing the highest valid revision. Cargo parcel poses and
ring flights are session state; they are not saved. Reset cargo does not erase its
earned reward. Diagnostic/demo runs never write these files.

Brann receives short structured progress fields, not client-written dialogue.
Stale context is not evidence of completion. These activities grant cosmetic
rewards, not materials or XP. See `PLAYFUL-CONTEXT.md` for the service contract.

## Verification and package

Run `scripts/check-playful.ps1` for focused native tools, encounters, cargo,
feedback, art, tuning, garden and actual main-input integration checks. The full
`Verify Brann.ps1` also runs this suite, service tests and the returning-projectile
publish/version/native lifecycle test. Both are offline; integration fixtures use
`BRANN_TEST_ROOT=$env:TEMP` to avoid OneDrive rename interference.

`scripts/Build-Bellworks.ps1` produces `outputs/bellworks-build` and a timestamped
ZIP with a Windows runtime, PCK, launchers, licenses and SHA-256 manifest. No install
is needed after extracting. Use `-SkipArchive` during iteration. The included VR
launcher requires a configured OpenXR runtime; hardware testing remains outstanding.

Screenshots in `outputs/bellworks/` are actual desktop renders, including a staged
bloom reveal. They demonstrate appearance, not an automatically completed player
challenge. Desktop/headless timings do not establish VR frame rates or subjective
sound/throw quality.

Implementation details and focused contracts: `PLAYFUL-TOOLS.md`,
`MAGNETIC-WAND.md`, `PLAYFUL-TUNING.md`, `UNFINISHED-LULLABY.md`, and
`LIVING-RETURNING-PROJECTILE.md`. Root integration backups are under
`backups/playful-sprint-20260921-070548`; bounded agent backups are under `work/`.


## Persistent demo checkpoint

The 07:57 persistent demo ZIP adds isolated saved progress while preserving the
07:39 reset-on-exit fallback. Open **Play Bellworks Persistent Demo.cmd** from
source or **Play Desktop.cmd** inside the new ZIP. Tab > Demo offers compact
controls, current save status, manual save and confirmed reset.

The namespace is `%APPDATA%/Godot/app_userdata/Brann's Forge VR/BellworksDemo`.
No ordinary world, inventory, comfort, quest or service state is loaded/written.
Only the two featured Living packages are offered by the offline catalog. Saved
outcomes reconstruct canonical visuals; no saved manifests, arbitrary transforms,
velocities or held objects are restored. Main-game behavior stays unchanged.

The source lifecycle sequence passed in 12.635 seconds; the same nine phases run
against the exported PCK passed in 10.203 seconds. Store checks cover 61 cases,
adapter checks 35, plus the real offline tuning/help path. The exported menu was
visually reviewed with actual save status visible. The first test-runner mistake
cost 40.270 seconds before its identified process was stopped; corrected required
flags and a bounded frame limit are documented in VERIFICATION.md.

To recover, use the on-screen status first. A valid previous/temp revision is
loaded automatically; corrupt bytes are preserved before replacement. An unknown
future schema stays untouched until explicit reset. Reset archives all old
recovery candidates and writes both a fresh primary and a fresh backup. If reset
was interrupted, the save remains blocked until reset is explicitly retried.
Archives are local recovery evidence, not loaded automatically. Run one demo
instance at a time; simultaneous sessions do not merge progress.


## Bankshot Bell

Travel > Bankshot Bell opens a separate garden court. Retrieve Sunskipper from
the stand, stand behind the gold line, use Courtyard power and bounce off the
teal panel into the bell. Three changing positions earn a medal and best-throw
record; Play Again resets the round while retaining both. Direct hits do not
score. The panel diamond is decorative, not an exact trajectory marker.

The receiver API owns no arbitrary world objects: at most four weak references,
immutable throw context and actual bounce provenance. Existing Bellworks hits
remain the fallback. Art adds 19 meshes and no lights/colliders; the challenge
owns its essential collision. Normal-game persistence and standalone-demo
persistence remain separate.

The new build reads older schema-1 demo saves, adding fresh Bankshot progress.
The older 07:57 executable predates this optional field; do not use it against a
newer demo save without first copying the BellworksDemo folder. The 07:39
reset-on-exit fallback does not access that namespace and remains safe to try.

Verified Bankshot package: `outputs/Bellworks-Persistent-Demo-20260921-081926.zip`.
Actual screenshots: `outputs/bellworks-bankshot/index.html`. Combined verification
passed in 86.293s; exported nine-phase lifecycle in 10.174s; packaging in 5.702s.
The 07:39 and 07:57 packages and galleries remain available as prior checkpoints.


## Festival Relay checkpoint

`outputs/Bellworks-Persistent-Demo-20260921-083429.zip` is the verified relay build
(89,473,216 bytes). `outputs/bellworks-festival/index.html` shows five actual
renders, with the optional clock deliberately staged for illustration. Prior
07:39, 07:57 and 08:19 ZIPs and galleries remain unchanged.

Travel > Festival Relay (or the six-row Demo help) visits its board. Practice is
untimed; Personal Best has no deadline. Three fresh ring strikes lead to a fresh
cargo bloom, then new held-light and handbell actions in the existing garden.
NEXT posts guide travel; restart/abandon preserve medals/bests and all independent
activity achievements. The garden is prepared only when absent; a second NEXT
travels once ready. Held tools must be put down. No new engine subsystem was added.

Validation: 47 relay logic checks, 41 relay persistence checks, art/help checks,
all existing playful/demo regressions, and real main-input source walkthrough
plus fresh-process medal restoration (26.228s). The same physical walkthrough and
relaunch passed against the exported PCK in 25.224s. Build+ZIP: 6.125s. No headset,
live commissions, ordinary player saves or normal runtime processes were touched.


## Echo Bells and Lantern Parade checkpoint — 09:00, 21 September

Verified package: `outputs/Bellworks-Persistent-Demo-20260921-085858.zip`
(89,527,978 bytes). Actual five-view gallery: `outputs/bellworks-arcade/index.html`.
All earlier ZIPs and galleries remain unchanged, including Festival Relay.

Travel > More places finds two optional, untimed activities. Echo Bells generates
an extending two-to-five-note phrase, with physical pull/release clappers and
accessible desktop ray clicking. Lantern Parade asks for six moving targets in a
fixed varied order, using existing Sunskipper flight. Both offer retry/abandon,
medals and bests. Hand ownership suppresses accidental bombs and tool stealing.
Travel is now paged, retaining readable buttons and fixed navigation/footer space.

All 16 playful regressions and six demo suites passed, including 52 Echo checks,
73 Lantern checks and 100 shared arcade persistence checks. The nine-process
save/recovery/reset lifecycle passed in 13.415s. Source physical walkthrough and
relaunch passed in 26.362s; the final export also tested the newly added real
desktop ray click and passed in 25.610s. Packaging took 6.314s. GPU review enlarged
small callouts and moved arrival controls into view before final capture.

The additive optional achievement registry preserves absent-module snapshots and
accepts older saves. It restores no active rounds, melody, timers, moving-target
positions or hand ownership. Normal saves, running games, paid services and
headset sessions were not touched. No Git repository exists here; no Git init,
commit or push was performed. This completes the coordinator's bounded 08:43
continuation ahead of the 09:20 integration checkpoint; no further scope queued.


## Final bounded review checkpoint — 09:10, 21 September

Recommended repair build: `outputs/Bellworks-Persistent-Demo-20260921-090940.zip`
(89,545,968 bytes); handoff page `outputs/bellworks-reviewed/index.html`.
The accepted 08:58 ZIP and every previous gallery/ZIP remain unchanged.

Independent review confirmed and repaired five concrete issues: desktop activity
buttons lost to held ring/wand input; pre-start ring flights credited to a fresh
Festival run; cross-zone pocket arrivals remaining visually hidden; malformed
schema types raising validation errors; and detached optional modules reverting
to a stale retained achievement snapshot. No feature scope was added.

Root reproduced actual main-scene button collision rays and travel from Pinewood
in a disposable demo (1.474s). Exported focused checks passed: 10 flight checks,
18 input/landing checks, 136 malformed/retention checks, plus the actual-scene
fixture. Total export verification 2.856s; build 6.278s. No full unchanged service
suite rerun. Source workers also checked existing Festival47 assertions and
failure boundaries. Exact logs and timings are retained; see
`docs/ARCADE-INPUT-REVIEW.md`, `docs/PERSISTENCE-FINAL-REVIEW.md`, and
`docs/FINAL-ACTIVITY-REVIEW.md`.

No normal saves, resident game restart, paid calls or headset session. All workers
finished; this completes the final coordinator review before the 09:20 checkpoint.


## Final short review burst — completed before 09:57

Latest package: `outputs/Bellworks-Persistent-Demo-20260921-095422.zip`
(89,551,140 bytes), page `outputs/bellworks-final/index.html`. The accepted 09:09 ZIP
and every previous ZIP/gallery remain intact. Two new concrete defects repaired:
controller tracking loss retained ownership of fairground tools, and bare portable
EXE startup bypassed offline-demo flags. Main now cancels only the lost hand's
Echo/cargo/ring/wand interactions without throw/note/launch, and exported demo
startup refuses missing launcher flags before any gameplay/save/service setup.
The export custom feature protects renamed runtimes; basename guard also covers
the supplied Bellworks.exe. Desktop/VR CMD launchers remain supported entry points.

Exported focused verification: 18 inactive-hand checks (0.628s), bare portable
startup using the non-Bellworks console runtime to verify the export feature
(0.629s), and actual-scene safe demo launch/button rays/cross-zone travel (1.185s).
No repeated unchanged whole suite. Resource review of prior immutable package
verified all seven entries, three manifest hashes/sizes and 20 bundled resources.
791 nested malformed-value probes caused no runtime errors. Concurrent sessions
can still resurrect reset progress: confirmed documented single-writer limitation,
not a rushed schema redesign. README and packaged instructions now explicitly
require one persistent demo window at a time.

All workers stopped. No ordinary saves, resident game restart, headset test or
paid call. Repository remains uninitialized (confirmed by branch/status commands),
so no commit/push was possible without separate Git-init authorisation. Fresh
usage before final handoff remained 80% used; no reset was observed or consumed.
