// Persistent-world expedition safety: bounded quest-ore reuse at the 80-deposit cap, user/world ores never evicted,
// a leaving Hero's carried gems stay in the world, and a parked reconnect never duplicates inventory.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {WorldSession} from '../client/session.js';

const t0 = performance.now();
const startRun = (sim, id, seq) => sim.command(id, {type: 'adventure', seq, action: 'start'});
const json = value => JSON.parse(JSON.stringify(value));

// 1. Deposits full of depleted expedition ores (xv ids) from earlier runs: camp restock reuses those slots.
{
  const base = createSimulation({room: 'CAPREUSE', seed: 41}).checkpoint();
  // Exhaust the new sanctuary cache as well as ore: this case specifically tests mineable restocking.
  base.pickups = base.pickups.filter(q => q.kind !== 'stone');
  const world = base.deposits.map(d => ({...d, hits: d.maxHits, depleted: true}));
  const quest = Array.from({length: 80 - world.length}, (_, i) => ({id: `xv0q${i}`, kind: 'stone', x: -40 + (i % 9) * 3, z: -40 + Math.floor(i / 9) * 3, hits: 3, maxHits: 3, depleted: true}));
  const sim = loadSimulation({...base, deposits: [...world, ...quest]});
  sim.addPlayer({id: 'h', name: 'Hero', role: 'hero'});
  assert.equal(startRun(sim, 'h', 1).ok, true);
  const cp = sim.checkpoint();
  const fresh = cp.deposits.filter(d => d.kind === 'stone' && !d.depleted);
  assert.ok(fresh.length * 2 >= cp.adventure.need.stone, `restocked ${fresh.length} boulders for need ${cp.adventure.need.stone}`);
  assert.ok(cp.deposits.length + cp.pendingStarfalls.length <= 80, 'deposit cap holds');
  for (const d of world) assert.ok(cp.deposits.some(x => x.id === d.id), `world ore ${d.id} kept`);
  assert.doesNotThrow(() => loadSimulation(json(cp)), 'restocked world restores strictly');
}
// Loose starting caches count toward camp supply; no redundant boulder is spawned.
{
  const cp=createSimulation().checkpoint();
  cp.deposits=cp.deposits.map(d=>({...d,hits:d.maxHits,depleted:true}));
  const sim=loadSimulation(cp);sim.addPlayer({id:'h'});
  assert.equal(startRun(sim,'h',1).ok,true);
  assert.equal(sim.checkpoint().deposits.filter(d=>!d.depleted).length,0);
  assert.ok(cp.pickups.filter(q=>q.kind==='stone').reduce((n,q)=>n+q.amount,0)>=sim.checkpoint().adventure.need.stone);
}
// 2. Cap full of non-expedition ores: nothing is evicted; the run still starts (God tithe or mined stone covers it).
{
  const base = createSimulation({room: 'CAPKEEP', seed: 41}).checkpoint();
  const extra = Array.from({length: 80 - base.deposits.length}, (_, i) => ({id: `ore${100 + i}`, kind: 'stone', x: -40 + (i % 9) * 3, z: 30 + Math.floor(i / 9) * 2, hits: 3, maxHits: 3, depleted: true}));
  const before = [...base.deposits, ...extra];
  const sim = loadSimulation({...base, deposits: before});
  sim.addPlayer({id: 'h', name: 'Hero', role: 'hero'});
  assert.equal(startRun(sim, 'h', 1).ok, true);
  assert.deepEqual(sim.checkpoint().deposits.map(d => d.id), before.map(d => d.id), 'user/world ores are never evicted');
}
// 3. Ten Hero-only rematches with every quest boulder mined out: the cap holds and each camp is restocked.
{
  let sim = createSimulation({room: 'REMATCH', seed: 41}); sim.addPlayer({id: 'h', name: 'Hero', role: 'hero'});
  let seq = 0;
  for (let run = 1; run <= 10; run++) {
    const cp = sim.checkpoint();
    cp.pickups = cp.pickups.filter(q => q.kind !== 'stone'); // Prior runs used every loose/cache supply.
    if (run > 1) cp.adventure.stage = 'victory';
    sim = loadSimulation(json(cp));
    assert.equal(startRun(sim, 'h', ++seq).ok, true, `run ${run} starts`);
    const now = sim.checkpoint();
    assert.ok(now.deposits.filter(d => d.kind === 'stone' && !d.depleted).length * 2 >= now.adventure.need.stone, `run ${run} has mineable stone`);
    assert.ok(now.deposits.length <= 80);
    for (const d of now.deposits) if (d.kind === 'stone') Object.assign(d, {hits: d.maxHits, depleted: true}); // mined out
    sim = loadSimulation(json(now));
  }
}
// 4. A Hero leaves carrying star gems: the pack falls as pickups (bounded, <=10 each) and nothing is lost.
{
  const cp = createSimulation({room: 'LEAVE', seed: 41}).checkpoint();
  const sim0 = loadSimulation(cp); sim0.addPlayer({id: 'h', name: 'Hero', role: 'hero'});
  const c = sim0.checkpoint(); c.players[0].resources = {wood: 25, stone: 3, gems: 4};
  const sim = loadSimulation(c); const before = sim.checkpoint().pickups.length;
  assert.equal(sim.removePlayer('h').ok, true);
  const dropped = sim.checkpoint().pickups.slice(before);
  const total = k => dropped.filter(q => q.kind === k).reduce((n, q) => n + q.amount, 0);
  assert.deepEqual({wood: total('wood'), stone: total('stone'), gems: total('gems')}, {wood: 25, stone: 3, gems: 4});
  assert.ok(dropped.every(q => q.amount >= 1 && q.amount <= 10));
  assert.doesNotThrow(() => loadSimulation(json(sim.checkpoint())));
}
// 5. Transient reconnect through the host's parking record: hp/tool/seq return, the pack stays on the ground once.
{
  class FakeConnection extends EventTarget {
    constructor() { super(); this.roster = new Map(); this.hostId = 'one'; this.epoch = 1; }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
    connect() { this.roster.set('one', {id: 'one', name: 'Host', role: 'god', online: true}); this.emit('welcome', {room: 'ABCDEFGH', peerId: 'one', hostId: 'one', role: 'god', peers: [...this.roster.values()]}); }
    broadcast() {} send() {} setCheckpoint() {} close() {}
  }
  const data = new Map(), storage = {getItem: k => data.get(k), setItem: (k, v) => data.set(k, v)};
  const connection = new FakeConnection(), s = new WorldSession({connection, storage});
  try {
    s.connect();
    connection.roster.set('two', {id: 'two', name: 'Friend', role: 'hero', online: true}); connection.emit('peer_joined', {id: 'two'});
    const earned = s.simulation.checkpoint(); const guest = earned.players.find(p => p.id === 'two');
    guest.resources = {wood: 9, stone: 4, gems: 2}; guest.hp = 40; guest.tool = 'pick'; guest.seq = 17;
    s.simulation = loadSimulation(earned);
    const owned = () => { const cp = s.simulation.checkpoint(), sum = {wood: 0, stone: 0, gems: 0};
      for (const p of cp.players) for (const k in sum) sum[k] += p.resources[k];
      for (const q of cp.pickups) if (q.kind in sum) sum[q.kind] += q.amount; return sum; };
    const total = owned();
    connection.roster.get('two').online = false; connection.emit('peer_left', {peerId: 'two'});
    assert.deepEqual(owned(), total, 'leaving moves the pack into the world');
    connection.roster.get('two').online = true; connection.emit('peer_joined', {id: 'two'});
    const back = s.simulation.checkpoint().players.find(p => p.id === 'two');
    assert.equal(back.hp, 40); assert.equal(back.tool, 'pick'); assert.equal(back.seq, 17);
    assert.deepEqual(back.resources, {wood: 0, stone: 0, gems: 0}, 'parked record returns empty-handed');
    assert.deepEqual(owned(), total, 'no duplicated inventory after reconnect');
  } finally { s.dispose(); }
}
console.log(`expedition-persistence: quest-ore cap reuse, user ores kept, 10 rematches, leave drop, parked reconnect no-dup pass (${((performance.now() - t0) / 1000).toFixed(3)} s)`);
