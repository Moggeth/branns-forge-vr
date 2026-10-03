// tree_fell carries the exact authoritative touchdown tick (landTicks) that presentation (wood audio) schedules from.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {trunkRadius, treeFall, TREE_LIMITS} from '../shared/trees.js';
import {woodLayersFor} from '../client/wood-audio.js';
const started = performance.now();
let seq = 0;
const act = (sim, body) => sim.command('h', {type: 'action', seq: ++seq, ...body});
const base = createSimulation({seed: 41}); base.addPlayer({id: 'h'});
const tree = worldTrees(base.checkpoint()).find(t => t.id === 'tree3');
const floor = terrainHeight({edits: [], bridges: []}, tree.x, tree.z), r = trunkRadius(tree, 1);
const s = base.checkpoint(); s.players[0].position = [tree.x, floor, tree.z + 1.2]; s.players[0].yaw = 0;
const sim = loadSimulation(s);
const strike = () => act(sim, {action: 'strike', targetId: tree.id, point: [tree.x, floor + 1, tree.z + r], normal: [0, 0, 1]});
for (let i = 0; i < 30; i++) sim.step();
let fell = null;
for (let n = 0; n < 3 && !fell; n++) { fell = strike().events.find(e => e.kind === 'tree_fell'); for (let i = 0; i < 28; i++) sim.step(); }
assert.ok(fell, 'third notch fells the tree');
assert.ok(Number.isSafeInteger(fell.landTicks) && fell.landTicks >= 1 && fell.landTicks <= 240, `landTicks ${fell.landTicks}`);
const cut = sim.snapshot().harvestedTrees.find(h => h.id === tree.id);
const ground = (x, z) => terrainHeight(sim.snapshot(), x, z);
const fall = treeFall(tree, cut, cut.felledTick + fell.landTicks, floor, ground);
assert.equal(fall.landTicks, fell.landTicks, 'payload equals the pure treeFall land tick');
assert.equal(fall.phase, 'down', 'trunk is in contact exactly at felledTick + landTicks');
assert.equal(treeFall(tree, cut, cut.felledTick + fell.landTicks - 1, floor, ground).phase, 'falling', 'and not one tick earlier');
// The authoritative settle event still fires once, landTicks after the fell tick.
let landTick = null;
for (let i = 0; i < 600 && landTick === null; i++) { const tick = sim.snapshot().tick; if (sim.step().some(e => e.kind === 'tree_land')) landTick = tick; }
assert.ok(landTick !== null, 'tree_land fires');
assert.ok(Math.abs(landTick - (cut.felledTick + fell.landTicks)) <= 1, `tree_land at ${landTick}, fell ${cut.felledTick}, land ${fell.landTicks}`);
// Audio plan: heavy landing is scheduled at exactly landTicks/60 s (no 2.5 s magic delay); tree_land then plays settle.
const scheduled = new Map(), plan = woodLayersFor(fell, scheduled);
assert.equal(plan.find(l => l.sound === 'log_land_heavy').delay, fell.landTicks / 60);
assert.equal(plan.find(l => l.sound === 'foliage_rustle').delay, fell.landTicks / 60);
assert.equal(woodLayersFor({kind: 'tree_land', id: tree.id}, scheduled)[0].sound, 'log_settle');
console.log(`tree-land-timing: landTicks ${fell.landTicks} (${(fell.landTicks / 60).toFixed(3)} s), ok in ${(performance.now() - started).toFixed(1)} ms`);
