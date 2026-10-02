# Forge Expedition — integration

`shared/adventure.js` is an optional cooperative run layered on the free sandbox. Until a player presses **Start Expedition** it does nothing (casts are ungated, no spawns, no costs). It never reads a clock or RNG; it advances exactly one tick per simulation tick and its clock pauses while the room is empty.

## The loop (what players see)

| Stage | Goal (exact, shown in banner) | Pressure / telegraphs | Fallback when a role is absent |
|---|---|---|---|
| **I · Prepare the Camp** | Deliver timber `6+3h` (≤24) and stone `4+2h` (≤16) to the forge (within 9 m). If a God is present: one path-shaping cast (raise/lower/sunder/wall within 32 m) and one grove/ring. | Skeleton patrols at 60 s and 150 s, each telegraphed 6 s at a gate. Hint at 200 s. | No God → path/grove goals shown as *optional*. No Hero → God **Tithe** (30 mana → 2 units). |
| **II · Recover the Fallen Star** | Star site (one of 3, by seed+run) is telegraphed 8 s, then a crater plus `need/2` real meteor shards appear. Deliver `2+2·ceil(h/2)` gems (≤8). | Guardians (golem + 2–4 skeletons) wake 3 s after impact, telegraphed. Optional God “star path” shaping between forge and site adds renown. | No Hero → guardians are smaller (2 skeletons); God clears them (real Lightning) then **Lodestar** (25 mana → 1 charge at the site). |
| **III · Rekindle the Forge** | Raise the forge flame to 100 and endure 3 waves (10 s, 65 s, 120 s, each telegraphed 6 s at a gate). Flame: +0.5/s while the forge stands, −0.45/s per skeleton and −0.9/s per golem within 11 m. Feeding: wood +4, stone +2, gems +10 (never overfilled). | Waves scale with Heroes (h): 1+h, 2+h(+golem at h≥2), 2+h + 1–2 golems. Leftovers flee 60 s after the last wave (no stuck-enemy deadlock). | No Hero → waves of 2/2/3 skeletons spawn *inside* the flame ring so idle foes still threaten it; God Tithe gives +5 flame. |
| **Victory** | Everyone present gets renown once per run (`10 + 5·(2−retries) + deeds bonus`). | — | **Rematch** starts run+1 (resources are not granted by rematch). |
| **Defeat** (flame 0) | **Retry last stand** (≤3, each retry removes up to 2 skeletons per wave) or **Leave**. | — | — |

`h` = Heroes present when the stage starts, clamped to 1..6. Unhurried 1–4 player runs are ~3–5 min camp, ~3–4 min star, ~2.5–3.5 min last stand (≈10–13 min). The scripted floor is 5 s / 13 s / 120 s; the rest is gathering, travel and fighting (see HANDOFF limitations).

**God assistance rule (one rule everywhere):** Tithe/Lodestar are explicit mana-paid actions with a 2 s per-God cooldown. They may cover all of a stage goal when no Hero is present, or a quarter of it while Heroes are present. Nothing is granted automatically.

**Hostile God summons during a run** go through `adventureCastGate`: not within 12 m of the forge, not within 6 m of a Hero, not while no Hero is present, and a per-stage challenge budget `2 + 2h` (skeleton 1, golem 3, squad 4). Support/terrain spells are never gated. Outside a run nothing is gated.

## API

```js
import {createAdventure, stepAdventure, adventureAction, adventureCastGate, adventureCastRefund,
  applyAdventureIntents, applyIntentsViaCheckpoint, checkpointAdventure, validateRestore, adventureView} from './shared/adventure.js';
```

* `createAdventure({seed})` → plain JSON state (≈0.5 KB for 8 players).
* `stepAdventure(adv, world, events)` → `{events, intents}`. Call once per sim tick **after** `game.step()`, with `world` = live state or snapshot (read-only) and `events` = all events since the last call (command results + step).
* `adventureAction(adv, playerId, message, world)` → `{ok, intents, events}` or `{ok:false, code}`. Message: `{type:'adventure', seq, action, kind?, amount?, point?}`, actions `start|retry|leave|deposit|tithe|lodestar`. `seq` is its own per-player counter (separate from sim input seq); a valid new seq is consumed even if rejected. The next seq for a reconnecting player is `adv.seqs[playerId] + 1`.
* Intents: `spawn {id,kind,x,z}`, `deposit {id,x,z}` (meteor), `crater {id,x,z,radius,height}`, `despawn {ids}`, `debit {playerId,kind,amount}`, `mana {playerId,amount}`. IDs are `xv…`, never produced by the sim's `nextId` prefixes.
* `applyAdventureIntents(state, intents, {createEnemy, terrainHeight})` → `{applied, skipped}`. Re-checks debits/mana (never negative), world caps (64 enemies, 80 deposits, 64 edits+starfalls) and ID collisions.
* `adventureCastGate(adv, id, castMessage, world)` → `{ok, code?, charged?}`; if the sim then rejects the cast, call `adventureCastRefund(adv, gate)`.
* `checkpointAdventure(adv)` / `validateRestore(saved)` → `{ok:true, adventure}` or `{ok:false, code}`. Strict whitelist: exact keys, integer ranges, ≤16 foes, ≤8 telegraphs, ≤16 ledger entries, `xv` foe IDs, stock ≤ need, `rewardedRun ≤ run`.
* `adventureView(adv, world, viewerId)` → stable UI model `{stage, run, title, notice, role, elapsedSeconds, objectives[{id,label,have,need,done,icon,role,waived?}], telegraphs[{…,secondsLeft}], flame, retriesLeft, godSupportLeft, challengeLeft, renown, party, actions, star}` (≈0.8 KB).

## Exact hooks (narrow; no simulation rewrite)

### 1. Simulation (`shared/simulation.js`): three lines, recommended
```js
import {applyAdventureIntents} from './adventure.js';
// inside instantiate(state) → api:
adventureWorld() { return state; },                 // read-only for stepAdventure/adventureAction; avoids a per-tick snapshot copy
applyAdventure(intents) { return applyAdventureIntents(state, intents, {createEnemy, terrainHeight}); },
```
Without this hook, `applyIntentsViaCheckpoint(game, intents, {loadSimulation, createEnemy, terrainHeight})` works on the untouched simulation (checkpoint → apply → load; only called when intents exist, a few dozen times per run). Tests use this path.

### 2. Host owner tab (`lobby.js` room loop)
```js
let adv = createAdventure({seed}); const pendingEvents = [];
// per 60 Hz tick
const stepEvents = game.step();
const out = stepAdventure(adv, game.adventureWorld(), [...pendingEvents, ...stepEvents]); pendingEvents.length = 0;
if (out.intents.length) game.applyAdventure(out.intents);
broadcastEvents([...stepEvents, ...out.events]);
// on peer command
if (msg.type === 'adventure') { const r = adventureAction(adv, id, msg, game.adventureWorld()); if (r.ok) game.applyAdventure(r.intents); reply(r); }
else if (msg.type === 'cast') { const gate = adventureCastGate(adv, id, msg, game.adventureWorld());
  if (!gate.ok) reply(gate); else { const r = game.command(id, msg); if (!r.ok) adventureCastRefund(adv, gate); pendingEvents.push(...r.events); reply(r); } }
else { const r = game.command(id, msg); pendingEvents.push(...r.events); reply(r); }
// snapshot message: {type:'state', snapshot: game.snapshot(), adventure: checkpointAdventure(adv)}
// persistence (atomic, together): {sim: game.checkpoint(), adventure: checkpointAdventure(adv)}
// restore: const v = validateRestore(saved.adventure); adv = v.ok ? v.adventure : createAdventure({seed}); // log v.code
```
Apply action intents synchronously in the same turn (the host is single-threaded, so the validated resources cannot change in between; a stale debit is skipped rather than minted).

### 3. Client (`game.js`)
```js
import {adventureView} from '../shared/adventure.js';
import {createAdventureBanner, drawAdventurePanel} from './adventure-view.js';
const banner = createAdventureBanner(hudRoot, {onAction: action => sendAdventure(action)});
// on state: banner.update(adventureView(msg.adventure, msg.snapshot, myId));
// VR: drawAdventurePanel(canvas.getContext('2d'), view, 512, 256, cache) then texture.needsUpdate = true when it returns true.
```
`sendAdventure('deposit')` should send one message per carried kind (`{action:'deposit', kind, amount: carried}`); the module takes only what is still needed. `tithe` in camp needs `kind:'wood'|'stone'` (pick the less complete); `lodestar` needs `point` (use `view.star`). Telegraphs (`view.telegraphs` with x/z/radius/secondsLeft) should also be drawn as ground rings by the world renderer.

## Reconnect / farming guarantees
Inventories live only in the sim player; `removePlayer` discards them and `addPlayer` starts at zero, so leaving cannot duplicate resources. Team stock, flame and star charge live in the adventure and are unaffected by reconnects. Deposits take `min(requested, carried, still needed)`; surplus is never taken. Renown is granted once per run (`rewardedRun`), to players present at victory, capped at 9999 and 16 ledger entries.
