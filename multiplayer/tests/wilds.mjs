// The Great Wilds in the shared simulation: deterministic streaming by chunk, a persisted change layer, saves across
// chunk boundaries, and two peers agreeing on everything from the descriptor alone.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {chunkContent, chunkOf, isGeneratedTreeId} from '../shared/worldgen/content.js';
import {worldTrees} from '../shared/world-content.js';
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
// The arena is untouched.
const arena = createSimulation({room: 'A', seed: 41}); arena.addPlayer({id: 'x', role: 'hero'}); arena.step();
assert.equal(arena.snapshot().world, undefined);
console.log('PASS wilds stream chunks by stable id, peers agree, changes persist through saves, arena unchanged');
