# Browser room simulation

`simulation.js` is the deterministic gameplay engine for one room. It imports no DOM, transport, storage, or native game code. The owning browser tab runs `step()` from a 60 Hz accumulator and broadcasts `snapshot()` at a lower rate (10–20 Hz is sufficient). One call to `step()` advances **exactly one** 1/60-second tick; elapsed wall time is never passed in. A delayed frame should call `step()` once per owed tick, with a bounded catch-up budget in the host.

```js
import {createSimulation, loadSimulation} from './shared/simulation.js';
let game = createSimulation({room: 'ABCD', seed: 41});
game.addPlayer({id: 'guest1', name: 'Hero', role: 'hero'});
game.command('guest1', {type: 'input', seq: 1, move: {x: 0, z: -1}, yaw: 0});
const events = game.step();
const stateMessage = {type: 'state', snapshot: game.snapshot()};
const persisted = game.checkpoint();
game = loadSimulation(persisted);
```

`addPlayer`, `removePlayer`, and `command` return `{ok, events}` or `{ok:false, code, events:[]}`. `step` returns zero or more `{kind, position, id}` events. The host supplies stable player IDs, enforces socket ownership and reconnect grace, and persists checkpoints atomically. Sequence numbers for input/action/cast are positive safe integers, shared across those commands. A valid new sequence is consumed even if its payload is rejected. `role` uses no sequence, matching protocol v1. Snapshots contain no sequence/cooldown state; a reconnecting host obtains the player's next sequence from `checkpoint().players`.

`checkpoint()` is a complete JSON-serializable **gameplay** state: tick, seed, room, ID counter, player positions/poses/health/mana/input/sequence/cooldowns, enemies and attack timers, edits, groves, pending Starfalls and their impact ticks, and shrine health/restore tick. It intentionally has no tokens, sockets, connection IDs, IPs, or session metadata. The host must keep credentials separately and ensure only one active session may command a player. `loadSimulation(checkpoint)` validates nested gameplay data and resumes from the same next tick. The host should also cap imported file size before JSON parsing. Checkpoint files should remain private because player names and live game state are present.

The snapshot retains the v1 `tick,time,seed,room,players,enemies,edits,groves,maxPlayers` fields, with `maxPlayers:8`. It adds `pendingStarfalls:[{id,x,z,radius,impactTick}]` for a 0.8-second target warning, and `shrine:{position,hp,maxHp,disabledUntil}` for a visible power anchor. A Hero's strike damages the closest enemy in range first, otherwise the shrine if it is in the 2.8 m facing arc. Four shrine strikes break it for eight seconds; God casts fail with `shrine_disabled` until it restores. Starfall impacts damage nearby enemies by 90 and Heroes by 18, then make a bounded crater edit. It is deliberately not instant damage, so an alerted Hero can move out of the radius.

World limits are eight players, 64 enemies, 64 groves, 64 combined edits and pending Starfalls, and eight concurrent Starfall warnings. Input expires after 18 ticks (300 ms). Hero movement speed is 5 m/s; enemy speed is 2 m/s. God input may update yaw and tracked poses, but cannot move the authoritative root. Client head and hand poses are local offsets only, each within 2.5 m and a normalized quaternion. Terrain uses the contract's base height and radial smoothstep edit formula.

Run `node tests/simulation.mjs` from `multiplayer/` to check tick timing, replay from JSON checkpoints, input and pose validation, capacity, damage, and respawn. The simulation has no runtime logging; the host should log room lifecycle, checkpoint failures, and fatal errors without recording tokens or raw input.


## Combat import (content version 3)
`combat.js` owns 60Hz arrow/bolt flight, six anatomical parts, bounded embedded and detached pieces, spring-held/drop/throw state, weapon specials and golem armour. `spells.js` is the shared fourteen-spell catalogue. Old content-version2 saves migrate with empty combat arrays; new fields are strictly validated and copied by whitelist.

The host renderer reports actual animated model contacts through `WorldSession.projectileContact`. Peer commands cannot submit projectile damage. Reports must match a recent fixed-step trajectory and plausible part position. The renderer supplies local bone position/rotation and complete visible part bounds. This is trusted-browser-host authority, not anti-cheat against a malicious host. Outgoing20Hz snapshots omit host-only16-sample trajectory histories; recovery checkpoints retain them.

Detached pieces currently behave as individual rigid pieces with spring-held motion and terrain collision bounds; articulated knee/ankle ragdolls are not yet imported. Late join restores detached models from their source resting pose. Ore drops remain collectible resources. CPU stress test: `node tests/combat-performance.mjs`; mesh tests: `node tests/combat-view.mjs`; session boundary: `node tests/combat-session.mjs`.
