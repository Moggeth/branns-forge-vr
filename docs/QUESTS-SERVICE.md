# Quest and XP service

`service/quests.js` adds a small, persistent XP journal in `player.json` under `rpg`. Balance and descriptions live in `service/quests-config.json`. Restart the local service after editing this configuration. Active jobs keep the goal/reward they had when accepted; new runs use updated definitions.

There are five repeatable choices: three physical Skeleton Skull deliveries, three rats, three skeletons, three fresh lumber, or three fresh stone. The skull basket appears first. At most three jobs can be active. Accept first, then progress, then claim near Brann; abandoning is allowed anywhere. Gathering jobs do not consume materials. Enemy kills and freshly collected resources also grant small passive XP. Levels award titles only: no talents, combat-stat inflation, resource rewards, or workshop-tier shortcuts.

`world.progression().rpg` and `/api/vr/state.rpg` include `{schema,revision,xp,level,levelXp,nextLevelXp,title,completed,maxActive,quests,rules}`. Every quest lists `{id,name,description,kind,target,goal,progress,xpReward,status,instanceId}`; active records also carry `acceptedAt`. Status is `available`, `active`, or `ready`.

## Native API

- `POST /api/vr/quests/event`: `{eventId,kind:"enemy",target}`. Target is `rat`, `skeleton`, `golem`, `ghost`, `minotaur`, or `ember_warden`. One event represents one actual enemy life. Reusing the same event ID with different data rejects; exact repeats award zero XP and no additional progress. Native IDs must remain stable while retrying an offline event.
- `POST /api/vr/quests/event`: `{eventId:"skull:<skullId>",kind:"delivery",target:"skeleton_skull",skullId,instanceId}` records a basket deposit. A null instance marks a deposit before acceptance. This route grants no passive XP and never treats a skeleton kill as a skull delivery.
- `POST /api/vr/quests/action`: `{action:"accept"|"claim"|"abandon",id,requestId,instanceId?}`. Quest IDs are `skull_basket`, `rat_patrol`, `skeleton_patrol`, `lumber_run`, and `stone_run`. Accept omits/nulls `instanceId`; claim/abandon require the exact current instance ID. A fresh accepted run has a new instance ID. All commands require a stable request ID; retries return the current snapshot and zero additional reward.
- Responses: `{rpg,xpAwarded,levelUp,replayed,instanceId?}`. Display and accept the revision monotonically. A snapshot `nextLevelXp` is the size of the current level's XP bar; `levelXp` is progress within that bar.

Accept and claim require the existing fresh `world.visiting()` state plus `zone:"forge_yard"`. Native UI refreshes context before those actions and enforces actual proximity. This is the local game's trusted event bridge, not a multiplayer anti-cheat system.

## Conservation and recovery

`world.kill` remains the old rat/tail ledger and awards no XP. All enemy XP uses the dedicated quest event route so kills cannot be counted twice by two code paths. Resource XP hooks `world.gather` inside its existing pickup-ID transaction; do not also send resource quest events. The resource route explicitly rejects such duplicate claims. Pouch handling, donations, material returns and satchel recovery do not grant gathering XP. Duplicate pickup IDs award zero.

Quest mutation snapshots the full player object, commits via the existing same-directory temporary file/atomic rename, and restores the entire in-memory state after save failure. Gathering now does the same for resources, pickup identity, XP and quest progress together. Failed writes are retryable without duplication. Corrupt saved RPG state fails closed and should be preserved for recovery.

Limits are 50,000 unique enemy event IDs and 10,000 request receipts. They are not silently evicted, preventing old-event replay rewards. The last 128 claim/abandon summaries are retained for inspection. Archive capacity failures are explicit. XP is capped at one billion. Initial level threshold is 100 XP, increasing by 50 for each later level.

## Verification

`node --test service/quests-test.cjs` covers acceptance before progress, passive XP, duplicate enemy events, exact-once claims across restart, old-instance safety, bounded active slots, fresh proximity, abandoning away, no XP for recovery, resource conservation, disk-failure rollback, malformed events and corrupt saved state. A real isolated HTTP service on an OS-assigned port proves accept → three rat lives → claim → 50 total XP while workshop tier stays one. No paid API calls or generation are used.

All **81 service tests passed**, Node-reported 0.482449 seconds (tool wall time 0.659584 seconds). Detailed measured command timings are in `logs/work-timing.csv`.

One initial proximity test reused a previously completed accept request ID and therefore correctly got an idempotent replay instead of an error. The test now uses a fresh ID when testing expired proximity. Preserve this distinction: retries must not become new commands or require the player to return merely to recover a lost response.


## Native integration and verification notes

`godot/quest_runtime.gd` owns the journal and persistent ordered hunt outbox. Enemy hooks run only on actual deaths, reset their per-life guard on respawn, and preserve stable IDs while retrying. Ghost damage still requires fire. The existing resource pickup transaction owns gathering XP; taking items from a pouch does not award it. Enemy event rejection retains the event and backs off rather than losing the player's hunt after a disk failure.

`node scripts/check-quests.cjs` runs an isolated real service plus native scene: accepts a skeleton hunt through the journal, kills actual skeletons, checks repeated damage cannot duplicate credit, claims XP, gathers to level two and verifies journal controls. It also checks a connection failure retains the hunt queue. There are only two skeletons in the current scene; the test simulates the existing respawn lifecycle for the third life rather than waiting 45 seconds. The initial test incorrectly assumed three existing skeletons; its failure was fixture count, not missing quest credit.

Visual QA: the first render put the journal inside Brann's beard because the test camera stood too close. The capture now moves back before presenting the menu. That initial render process also exited nonzero after writing its screenshot (22.624 seconds); its log was superseded by the concurrent verification harness, so the cause was not established. Capture and headless runs now have separate logs, and failures include the exit code. The corrected render passed in 15.254 seconds and showed the journal without overlapping text. Full regression verification passed in 44.283 seconds, including 81 service tests, native firecraft/living checks, audio checks and interaction integration. Native quest network checks passed in 1.482 seconds before adding connection-failure coverage; current timings are in `logs/work-timing.csv`.

The final native test including a deliberately unavailable connection passed in **16.582 seconds**. Its extra 15 seconds is the real HTTP timeout, not slow simulation. Normal render and network checks were already verified above.

## Physical Skeleton Skull basket

The first available job is now **Skulls for the forge**. Accept it near Brann,
detach a skeleton head or defeat a skeleton, and put three actual grabbable
Skeleton Skulls into the portable open basket. In desktop play, E carries or
drops the basket and F stores a nearby looked-at loose skull while carrying
it; F aimed at a grounded basket takes a stored skull out. In VR, release a
skull into its open interior. The three stored skulls remain locked to their
sockets until retrieved. Basket location, contents, skull identities and
delivery queue state are saved in `user://skull_basket.json`; a corrupt save is
preserved and blocks new deposits. Diagnostic checks use an OS-temp path.

The actor's actual detached head rigid body receives a unique `skull_id` at
decapitation or death shatter. Other bones and simulated kills cannot become
delivery items. The native quest outbox records a physical deposit as
`{eventId:"skull:<skullId>",kind:"delivery",target:"skeleton_skull",skullId,instanceId}`.
It captures the accepted quest instance at deposit time, before any offline
retry. `instanceId` is null when the job has not been accepted. The service
stores every skull event ID in the existing persistent RPG event ledger and
advances only the matching accepted instance; delivery grants no passive XP.
Removing and reinserting a skull, retrying an event, or claiming and repeating
the job never recredits that skull. Existing active quests and player saves
retain schema 1 and are not rewritten on configuration load.

Focused checks are `node --test service/quests-test.cjs` and the offline
`res://skull_basket_checks.gd` SceneTree script. The final ten-test service
suite passed in 0.396 s; the native physical-skull, three-deposit, removal/reinsert and
OS-temp persistence check passed in 0.216 s with no engine errors. An initial
native run succeeded functionally but revealed a teardown-only global-transform
query after the basket had left the tree; `_exit_tree` now saves only while its
body remains inside the tree. No live save or service was used.

The existing isolated service/native quest harness first exited in 17.605 s
with its fresh-XP guard (`QUEST_CHECK_RESULT` reported that the loaded quest
snapshot did not have zero XP). The same harness passed on a fresh temporary
service directory in 22.647 s without a source change to the service or
integration path. The first result's cause is unconfirmed; inspect
`logs/quests-network.log` and the fixture's initial `/api/vr/state.rpg` before
altering save or progression logic if it recurs.
