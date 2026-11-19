// The Great Wilds in the shared simulation: deterministic streaming by chunk, a persisted change layer, saves across
// chunk boundaries, and two peers agreeing on everything from the descriptor alone.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {chunkContent, chunkOf, isGeneratedTreeId} from '../shared/worldgen/content.js';
import {worldTrees} from '../shared/world-content.js';
import {createTreeIndex} from '../shared/trees.js';
import {withWorld} from '../shared/world-extent.js';

const world = worldDescriptor({kind: 'wilds', seed: 'ci-wilds', preset: 'continent', size: 2048});
const make = () => { const s = createSimulation({room: 'T', seed: 41, world}); s.addPlayer({id: 'h1', name: 'A', role: 'hero'}); return s; };
const a = make(), b = make();
let snap = a.snapshot();
assert.deepEqual(snap.world, world, 'snapshot carries only the descriptor');
assert.ok(!('terrain' in snap) && JSON.stringify(snap).length < 400000, 'baseline land is never serialised');
const hero = snap.players[0];
assert.ok(Math.abs(hero.position[0]) < 30 && Math.abs(hero.position[2]) < 30, 'Hero spawns at the village forge');
assert.ok(snap.pickups.filter(p => String(p.id).startsWith('wstart')).length >= 3, 'starting supplies by the forge');
// Teleport the Hero across chunk boundaries: the live window follows, with stable generated ids.
const w = worldFor(world), far = w.findSites({count: 1, spacing: 10, salt: 'ci-far', near: {x: 0, z: 0, min: 300, max: 500}, filter: (x, z) => w.forestAt(x, z) > .4})[0] || {x: 360, z: 0};
for (const sim of [a, b]) { const st = sim.adventureWorld(); const p = st.players[0]; withWorld(w, () => { p.position = [far.x, terrainHeight(st, far.x, far.z), far.z]; }); for (let i = 0; i < 40; i++) sim.step(); }
snap = a.snapshot();
const [cx, cz] = chunkOf(far.x, far.z);
const live = worldTrees(snap).filter(t => isGeneratedTreeId(t.id));
assert.ok(live.length > 0, 'generated trees go live near the Hero');
assert.ok(live.some(t => t.id.startsWith(`wt${cx}_${cz}_`)) || chunkContent(w, cx, cz).trees.length === 0, 'the Hero\'s own chunk is live');
assert.ok(live.every(t => Math.hypot(t.x - far.x, t.z - far.z) < 80 + 64 * 1.5), 'only nearby chunks are live');
assert.ok(snap.deposits.every(d => Math.hypot(d.x - far.x, d.z - far.z) < 80 + 64 * 1.5 || !/^wr/.test(d.id)), 'deposits stream with the Hero');
// Peers agree: same descriptor and inputs, same land and same content.
const sb = b.snapshot();
assert.deepEqual(worldTrees(sb).map(t => t.id), worldTrees(snap).map(t => t.id));
assert.deepEqual(sb.deposits.map(d => d.id), snap.deposits.map(d => d.id));
for (let k = 0; k < 20; k++) { const x = far.x + k * 3.1 - 30, z = far.z - k * 2.3 + 20; assert.equal(withWorld(w, () => terrainHeight(snap, x, z)), withWorld(w, () => terrainHeight(sb, x, z))); }
// Two saves can share a seed and revision while different trees have rotted away.
{
  const index = createTreeIndex();
  const snapshots = live.slice(0, 2).map(tree => ({
    ...snap, wilds: {...snap.wilds, felled: [[tree.id, snap.tick]], felledRev: 1}
  }));
  assert.equal(snapshots.length, 2);
  for (const i of [0, 1, 0]) {
    const state = snapshots[i], standing = live[1 - i].id, gone = live[i].id;
    index.update(state);
    assert.ok(index.get(standing), 'standing tree remains collidable after switching worlds');
    assert.equal(index.get(gone), undefined);
    assert.ok(worldTrees(state).some(t => t.id === standing));
    assert.ok(!worldTrees(state).some(t => t.id === gone));
  }
}
// A change (a felled tree) persists through a save and comes back when the Hero returns.
const st = a.adventureWorld(), tree = live[0];
st.harvestedTrees.push({id: tree.id, cuts: 3, cutHeight: 0.4, felledTick: st.tick, fallYaw: 0, landed: true});
const saved = JSON.parse(JSON.stringify(a.checkpoint()));
const c = loadSimulation(saved);
assert.deepEqual(c.snapshot().world, world);
assert.ok(c.snapshot().harvestedTrees.some(h => h.id === tree.id), 'felled tree survives a save across chunks');
// Walk away and back: the stump record outlives the live window.
const cs = c.adventureWorld(); withWorld(w, () => { cs.players[0].position = [0, terrainHeight(cs, 0, 8), 8]; }); for (let i = 0; i < 30; i++) c.step();
withWorld(w, () => { cs.players[0].position = [far.x, terrainHeight(cs, far.x, far.z), far.z]; }); for (let i = 0; i < 30; i++) c.step();
assert.ok(c.snapshot().harvestedTrees.some(h => h.id === tree.id), 'change layer kept while the chunk was unloaded');
// Garbage in a save is refused, not trusted.
assert.throws(() => loadSimulation({...saved, world: {...world, seed: 'NOT OK'}}));
assert.throws(() => loadSimulation({...saved, wilds: {...saved.wilds, felled: [['../../x', 1]]}}));
// Saved felled/harvested trees are keyed by generated id, so tree placement (ids and spots) is frozen. Species may
// change; where trees stand may not. This hash was taken from the pre-species generator and must never move.
{
  const {createHash} = await import('node:crypto');
  const gw = worldFor(worldDescriptor({kind: 'wilds', seed: 'ci-wilds', preset: 'continent', size: 2048}));
  let key = ''; for (let cx = -3; cx < 3; cx++) for (let cz = -3; cz < 3; cz++) for (const t of chunkContent(gw, cx, cz).trees) key += `${t.id}@${t.x},${t.z};`;
  assert.equal(createHash('sha1').update(key).digest('hex').slice(0, 16), '0439287206a7c80d', 'generated tree ids keep their saved positions');
}
// Generated worlds share the 192-slot mineral budget across preview, commands, streaming and restore.
{
  const {spellUnavailable} = await import('../client/spell-availability.js');
  const sim = make();
  sim.addPlayer({id:'g', role:'god'});
  const state = sim.adventureWorld(), god = state.players.find(p => p.id === 'g');
  const cast = seq => sim.command('g', {seq, type:'cast', spell:'crystal', point:[25,0,25]});
  state.players[0].position = [far.x, 0, far.z];
  for (let i=0; i<20; i++) sim.step();
  const rock = state.deposits.find(d => d.id.startsWith('wr'));
  Object.assign(rock, {hits:rock.maxHits, depleted:true});
  assert.equal(cast(1).ok, true);
  for (let i=0; i<20; i++) sim.step();
  assert.ok(state.wilds.spent.some(([id]) => id === rock.id), 'casting before the next streaming tick preserves the mined rock timer');
  assert.ok(!state.deposits.some(d => d.id === rock.id && !d.depleted));
  while (state.deposits.length < 191) {
    const n = state.deposits.length;
    state.deposits.push({id:'extra'+n, kind:'stone', x:10, z:10, maxHits:3, hits:0, depleted:false});
  }
  god.mana = 100;
  assert.equal(spellUnavailable(state, god, 'crystal'), '');
  assert.equal(cast(2).ok, true);
  assert.equal(state.deposits.length, 192);
  god.mana = 100;
  assert.equal(spellUnavailable(state, god, 'crystal'), 'Deposit limit reached');
  assert.equal(cast(3).code, 'world_limit');
  assert.doesNotThrow(() => loadSimulation(sim.checkpoint()));
}
// Clearing a camp at the pickup cap waits until its whole reward fits, even over a host handoff.
{
  const sim=make(), state=sim.adventureWorld(), camp=w.discoveries.find(s=>s.kind==='camp');
  state.wilds.guards[camp.id]=[];
  state.pickups=Array.from({length:255},(_,i)=>({id:'full'+i,kind:'stone',x:0,y:0,z:0,amount:1}));
  state.tick=29;
  const cleared=e=>e.kind==='wilds_cleared'&&e.id===camp.id;
  assert.ok(!sim.step().some(cleared));
  assert.equal(state.pickups.length,255);
  const resumed=loadSimulation(sim.checkpoint()), next=resumed.adventureWorld();
  next.pickups.splice(-2);
  let payouts=0;
  for(let i=0;i<60;i++)payouts+=resumed.step().filter(cleared).length;
  assert.equal(payouts,1);
  assert.equal(next.pickups.length,256);
  assert.deepEqual(next.pickups.slice(-3).map(p=>p.kind),['wood','ironOre','apple']);
}
// Many Heroes can reach new camps on the same tick. Each new group consumes the shared guard budget.
{
  const descriptor=worldDescriptor({...world,size:4096});
  const sim=createSimulation({world:descriptor}), state=sim.adventureWorld();
  const camps=worldFor(descriptor).discoveries.filter(s=>s.kind==='camp'||s.kind==='ruin').slice(0,18);
  for(const [i,site] of camps.entries()){
    sim.addPlayer({id:'visit'+i,role:'hero'});
    state.players.at(-1).position=[site.x,0,site.z];
  }
  state.tick=29;
  sim.step();
  const guards=Object.values(state.wilds.guards).flat();
  assert.ok(guards.length>=20&&guards.length<=24, 'shared guard limit: '+guards.length);
}
// The arena is untouched.
const arena = createSimulation({room: 'A', seed: 41}); arena.addPlayer({id: 'x', role: 'hero'}); arena.step();
assert.equal(arena.snapshot().world, undefined);
console.log('PASS wilds stream chunks by stable id, peers agree, changes persist through saves, arena unchanged');
