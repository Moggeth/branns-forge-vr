import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight, MAX_PLAYERS} from '../shared/simulation.js';

const sim = createSimulation({legacyBattle:true,room: 'TEST'});
assert.equal(sim.addPlayer({id: 'hero', name: 'A', role: 'hero'}).ok, true);
assert.equal(sim.addPlayer({id: 'god', role: 'god'}).ok, true);
for (let i = 2; i < MAX_PLAYERS; i++) assert.equal(sim.addPlayer({id: `p${i}`}).ok, true);
assert.equal(sim.addPlayer({id: 'overflow'}).code, 'room_full');
assert.equal(sim.snapshot().maxPlayers, MAX_PLAYERS);
assert.equal(sim.snapshot().players[0].position[2], 8);

// A fixed tick lasts exactly 1/60 second. Input expires after 300 ms.
assert.equal(sim.command('hero', {type: 'input', seq: 1, move: {x: 1, z: 0}, yaw: 0}).ok, true);
for (let i = 0; i < 18; i++) sim.step();
const moved = sim.snapshot().players[0].position[0];
assert.ok(moved > 1.4 && moved < 1.6);
sim.step();
assert.equal(sim.snapshot().players[0].position[0], moved);
assert.equal(sim.snapshot().tick, 19);
assert.equal(sim.snapshot().time, 19 / 60);

// Bad client positions and headset/controller offsets cannot teleport a root.
const before = sim.snapshot().players[0].position;
assert.equal(sim.command('hero', {type: 'input', seq: 2, move: {x: NaN, z: 0}, yaw: 0}).code, 'invalid_input');
assert.equal(sim.command('hero', {type: 'input', seq: 2, move: {x: 0, z: 0}, yaw: 0}).code, 'duplicate_sequence');
assert.equal(sim.command('hero', {type: 'input', seq: 3, move: {x: 0, z: 0}, yaw: 0,
  head: {position: [99, 0, 0], quaternion: [0, 0, 0, 1]}}).code, 'invalid_input');
assert.deepEqual(sim.snapshot().players[0].position, before);
assert.equal(sim.command('hero', {type: 'input', seq: 4, move: {x: 99, z: 99}, yaw: 10,
  head: {position: [0, 1.65, 0], quaternion: [0, 0, 0, 1]}, hands: []}).ok, true);
assert.deepEqual(sim.snapshot().players[0].head.position, [0, 1.65, 0]);
assert.equal(sim.command('hero', {type: 'cast', seq: 5, spell: 'raise', point: [0, 0, 0]}).code, 'role_required');
assert.equal(sim.command('god', {type: 'action', seq: 1, action: 'strike'}).code, 'invalid_action');
assert.equal(sim.command('god', {type: 'cast', seq: 2, spell: 'raise', point: [56, 0, 0]}).code, 'invalid_cast');

// Telegraph survives save/load, then impact is deterministic and damages heroes and enemies.
assert.equal(sim.command('god', {type: 'cast', seq: 3, spell: 'starfall', point: [...before]}).ok, true);
assert.equal(sim.snapshot().pendingStarfalls.length, 1);
assert.equal(sim.snapshot().edits.length, 0);
const saved = JSON.parse(JSON.stringify(sim.checkpoint()));
assert.ok(!JSON.stringify(saved).includes('token'));
assert.ok(!JSON.stringify(saved).includes('connection'));
const resumed = loadSimulation(saved);
for (let i = 0; i < 48; i++) {
  assert.deepEqual(sim.step(), resumed.step());
  assert.deepEqual(sim.snapshot(), resumed.snapshot());
}
assert.equal(sim.snapshot().pendingStarfalls.length, 0);
assert.equal(sim.snapshot().edits[0].kind, 'starfall');
assert.equal(sim.snapshot().players[0].hp, 82);
assert.ok(terrainHeight(sim.checkpoint(), before[0], before[2]) < terrainHeight(saved, before[0], before[2]));

// Summoned enemies attack, kill, and cause a bounded authoritative respawn.
const duel = createSimulation({legacyBattle:true,legacyBattle:true});
duel.addPlayer({id: 'h'}); duel.addPlayer({id: 'g', role: 'god'});
let sequence = 1;
for (let n = 0; n < 5; n++) {
  assert.equal(duel.command('g', {type: 'cast', seq: sequence++, spell: 'skeleton', point: [0, 0, 8]}).ok, true);
  for (let t = 0; t < 45; t++) duel.step();
}
const combatEvents = [];
for (let t = 0; t < 700; t++) combatEvents.push(...duel.step());
assert.ok(combatEvents.some(e => e.kind === 'death' && e.id === 'h'));
assert.ok(duel.snapshot().players[0].hp > 0);
assert.ok(duel.snapshot().players[0].position.every(Number.isFinite));

// Limits are authoritative even when clients bypass the UI.
const capped = createSimulation({legacyBattle:true,legacyBattle:true}); capped.addPlayer({id: 'g', role: 'god'});
let cp = capped.checkpoint();
cp.groves = Array.from({length: 64}, (_, i) => ({id: `t${i}`, x: i % 55, z: 0}));
const loaded = loadSimulation(cp);
assert.equal(loaded.command('g', {type: 'cast', seq: 1, spell: 'grove', point: [10, 0, 10]}).code, 'world_limit');
assert.equal(loaded.snapshot().groves.length, 64);
assert.equal(loaded.removePlayer('g').ok, true);
assert.equal(loaded.snapshot().players.length, 0);

// The central Forge is permanent. Its apron remains protected after hits and reload.
const shrineSeed = createSimulation({legacyBattle:true,legacyBattle:true});
shrineSeed.addPlayer({id: 'h'}); shrineSeed.addPlayer({id: 'g', role: 'god'});
const shrineState = shrineSeed.checkpoint();
shrineState.players[0].position = [0, terrainHeight(shrineState, 0, 2), 2];
const shrineRoom = loadSimulation(shrineState);
for (let i = 0; i < 4; i++) {
  assert.equal(shrineRoom.command('h', {type: 'action', seq: i + 1, action: 'strike'}).ok, true);
  for (let t = 0; t < 27; t++) shrineRoom.step();
}
assert.equal(shrineRoom.snapshot().shrine.hp, 100);
// A grove aimed at the forge is moved to the apron edge, never refused.
assert.equal(shrineRoom.command('g', {type: 'cast', seq: 1, spell: 'grove', point: [0, 0, 0]}).ok, true);
assert.ok(Math.abs(Math.hypot(shrineRoom.snapshot().groves.at(-1).x, shrineRoom.snapshot().groves.at(-1).z) - 7) < 1e-9);
const shrineRestored = loadSimulation(JSON.parse(JSON.stringify(shrineRoom.checkpoint())));
assert.equal(shrineRestored.snapshot().shrine.disabledUntil, 0);
assert.equal(shrineRestored.snapshot().shrine.hp, 100);
assert.equal(shrineRestored.command('g', {type: 'cast', seq: 2, spell: 'grove', point: [10, 0, 10]}).ok, true);

// User-imported checkpoints are untrusted, including nested objects.
const safe = shrineSeed.checkpoint();
const corruption = [
  state => { state.players[0].position[0] = NaN; },
  state => { state.players[0].move = [100, 0]; },
  state => { state.players[0].seq = -1; },
  state => { state.players[0].head = {position: [3, 0, 0], quaternion: [0, 0, 0, 1]}; },
  state => { state.players[1].id = state.players[0].id; },
  state => { state.players[0].role = 'admin'; },
  state => { state.groves = [{id: 'bad', x: Infinity, z: 0}]; },
  state => { state.pendingStarfalls = [{id: 'bad', x: 0, z: 0, radius: 5, impactTick: 9999}]; },
  state => { state.shrine.hp = -999; },
  state => { state.shrine.disabledUntil = 9999; },
  state => { state.enemies = [{id: 'e', position: [1e9, 0, 0], yaw: 0, hp: 100, attackTick: 0}]; },
];
for (const mutate of corruption) {
  const candidate = structuredClone(safe); mutate(candidate);
  assert.throws(() => loadSimulation(candidate));
}
const godStay = createSimulation({legacyBattle:true,legacyBattle:true}); godStay.addPlayer({id: 'g', role: 'god'});
const godBefore = godStay.snapshot().players[0].position;
assert.equal(godStay.command('g', {type: 'input', seq: 1, move: {x: 1, z: 0}, yaw: 0}).ok, true);
for (let t = 0; t < 18; t++) godStay.step();
assert.deepEqual(godStay.snapshot().players[0].position, godBefore);
const cliffSeed = createSimulation({legacyBattle:true,legacyBattle:true}); cliffSeed.addPlayer({id: 'h'});
const cliffState = cliffSeed.checkpoint();
cliffState.enemies.push({id: 'e1', position: [0, 10, 7], yaw: 0, hp: 100, attackTick: -1000});
const cliff = loadSimulation(cliffState);
assert.equal(cliff.command('h', {type: 'action', seq: 1, action: 'strike'}).events.length, 0);
assert.equal(cliff.snapshot().enemies[0].hp, 100);

console.log('simulation: pass');
