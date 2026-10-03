# Solo forge economy — 2026-10-03

The settlement is an optional persistent layer on the existing world and Forge Expedition. Both a sole God and a sole Hero can reach forge tier three without another player, role changes, injected resources or debug commands. Existing free building and expedition stages remain available.

## Play loop

Summon two workers, initially assigned timber and stone. They walk to finite world resources, chop actual tree notches and wait for physical logs, or strike real deposits. Each worker carries at most two units back to the forge's shared stores. Four workers maximum; each costs 25 regenerating mana. Workers shelter near enemies instead of fighting. Assign timber, stone or gems; a worker carrying cargo must finish delivery before reassignment. When a resource is exhausted, reassign that worker or use earned raid supplies. Gods can also plant groves or summon mineable crystal through existing spells.

Build wards and improve the forge, then challenge a raid. Recover mana between raids; starting the next wave with an empty mana bar can turn timber into repeated emergency repairs. Hero players fight with existing weapons; God players use their actual spells. With no Hero, the raid enemies advance toward the forge and damage it. Wards deal normal authoritative combat damage. A defeated wave awards shared timber, stone and one gem, once. Failed raids award nothing and remove only their own survivors. The existing eight-second forge recovery allows another attempt. Workers and the raid's elapsed clock pause in an empty room.

| Purchase | Cost | Effect |
| --- | --- | --- |
| Worker | 25 mana | One worker, maximum four |
| Forge tiers 1 / 2 / 3 | 6 / 12 / 18 wood; 4 / 8 / 12 stone; 0 / 1 / 2 gems | Reduces each raider's forge damage by one per tier; strengthens wards; repairs 25 integrity |
| Wards 1 / 2 / 3 | 4 / 6 / 8 wood; 3 / 5 / 7 stone | One combined shot per second: `8 × wards + 2 × forge tier` damage, range 16 |
| Repair | 3 wood | Restores 35 integrity, up to 100 |
| Raid | No entry cost | 2–6 skeletons; 120-second limit; three-second recovery after result |

Raid reward is `4 + min(4, previous victories)` wood, `3 + min(3, previous victories)` stone, and one gem. Stores cap at 999 each. The existing expedition can consume shared supplies using its normal camp/star/flame caps. This spends gathered resources; it does not bypass stage progression or create mana-paid tithes.

## Integration contract

All commands use `session.command('action', {action, ...detail})` and the simulation's existing sequence validation. God commands work remotely. Heroes must be within nine horizontal metres of the forge, including after respawn.

- `forgeSummon`
- `forgeAssign {workerId, kind:'wood'|'stone'|'gems'}`
- `forgeUpgrade`, `forgeDefend`, `forgeRepair`, `forgeEncounter`, `forgeContribute`
- `forgeSupply {kind, amount}` transfers up to 99 carried units into shared stores, capped by actual inventory and store capacity.

`settlementView(snapshot, playerId)` from `multiplayer/shared/resources.js` returns title, goal, stocks, level, defenses, completed victories, workers, encounter title/status, result and actions. Actions contain `action`, `label`, `enabled`, `reason`, `cost`, optional `cooldown` seconds, and optional `detail`. The `forgeAssign` action is a capability for worker selectors, not a standalone submit button. Supply actions carry their resource and amount in `detail`.

Snapshot/checkpoint field `settlement` contains the shared economy, bounded worker state and active raid. Missing field restores as an empty settlement for legacy worlds. Worker targets, cargo, work progress and bounded blocked-target retries persist. Invalid counts, phases, coordinates, resources, duplicate IDs, raid references and unknown fields reject restore. Command-time kills are recorded before a checkpoint can be taken; saving between the final blow and next simulation step cannot lose or duplicate the reward.

`createSettlementView({scene, heroView})` reuses the caller's already loaded adventurer model, palettes, weapon sockets, locomotion and attack clips. Call `sync(snapshot)`, `update(dt, cameraWorldPosition)`, `event(ev)` and `dispose()`. This wrapper releases only its worker clones; the caller keeps ownership of shared templates. Worker roots expose `workerId`, `label`, `phase` and `cargo` in userData. It creates no bespoke art or textures.

Simulation integration also preserves optional enemy scorch and emergence ticks, exposes real player cast/attack/flame clocks, and wires the terrain owner's progressive Sunder helpers. These changes are independently covered by the respective lanes' tests.

## Verification and measured cost

Run from the repository root:

```powershell
node --test multiplayer/tests/solo-settlement.mjs multiplayer/tests/settlement-view.mjs
node multiplayer/tests/settlement-budget.mjs
```

Nine authority/loop tests cover actual finite gathering, natural solo God tier-three progression, solo Hero tier-three progression with real melee/return movement/job reassignment, raid defeat, empty-room pause, existing expedition contribution, save determinism, final-kill checkpoint safety, costs/caps, replay and malformed state. The separate view lifecycle test verifies delayed asset availability, tool reassignment, event attribution and shared-resource ownership.

The earlier integration run also passed the existing 12 expedition tests, 13 meteor/resource tests, simulation suite and two lumber session tests in **3.036232 seconds**. Natural two-worker smoke delivered **15 timber and 12 stone in 90 simulated seconds** before later navigation safeguards; supplies came from actual felled/mined world resources.

The measured worst-case fixture keeps **64 enemies, 4 workers, 64 terrain edits and both a God and Hero** alive for **1,200 ticks**. Result: **6.246336 seconds**, mean **5.2053 ms/tick**, p95 **9.3397 ms**, p99 **9.7382 ms**, maximum **12.3004 ms** on this machine. The test enforces a 16.667 ms mean/p95 simulation budget and validates the resulting checkpoint. This measures authority CPU; rendering and physical HMD acceptance are separate.

## Durable findings

- Compare public normalized snapshots across legacy save round trips: load adds established default weapon fields (`flameTick`, `flaskLit`, `overheatUntil`) that may be absent from a newly created raw checkpoint. The first strict raw-object comparison failed for those pre-existing defaults, not lost settlement state.
- A work-reach occlusion check must continue steering around a stump when the line is blocked. Merely reporting blocked at the nominal 1.8 m work distance can stop a worker forever. Targets stay stable while travelling; after two seconds without measurable approach, one blocked target is deferred for twenty seconds. No global pathfinding flood is introduced.
- A worker pictured near home in a failed long-run test is not proof of a stuck route. Sample progress over time. The full Hero audit showed continuing long-distance log deliveries, an exhausted stone worker and a one-unit timber shortfall at the coarse deadline. Reassigning the idle stone worker to timber through the real command completed the run.
- Hero death can respawn beyond the nine-metre management radius. Successful solo tests must actually return to the forge instead of treating rejected remote management as an economy failure.
- Mana and repairs are real constraints. Continuously challenging raids with no recovery consumed repair timber in an early God test; a gather/improve/recover/challenge sequence completes tier three without changing costs or injecting resources.

Timing details are recorded in ignored `logs/solo-settlement-timing.csv`. No production server restart or publication was performed by this lane.
