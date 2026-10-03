// Integration of shared/trees.js into the authoritative simulation: chop -> hinge fall -> logs, saves, hands, collision.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {isTestingGift} from '../shared/testing-supplies.js';
import {worldTrees} from '../shared/world-content.js';
import {trunkRadius, timberSections} from '../shared/trees.js';
const started = performance.now();
let seq = 0;
const act = (sim, body) => sim.command('h', {type: 'action', seq: ++seq, ...body});
const steps = (sim, n) => { const events = []; for (let i = 0; i < n; i++) events.push(...sim.step()); return events; };
function heroAt(position, yaw = 0, extra = []) {
  const sim = createSimulation({seed: 41}); sim.addPlayer({id: 'h'}); for (const id of extra) sim.addPlayer({id});
  const s = sim.checkpoint(); s.players[0].position = position; s.players[0].yaw = yaw; return loadSimulation(s);
}
const tree = worldTrees(createSimulation({seed: 41}).checkpoint()).find(t => t.id === 'tree3');
const floor = terrainHeight({edits: [], bridges: []}, tree.x, tree.z), r = trunkRadius(tree, 1);
// Hero stands 1.2 m on +z of the trunk facing it (yaw 0 faces -z).
let sim = heroAt([tree.x, floor, tree.z + 1.2], 0);
const strike = (y = floor + 1) => act(sim, {action: 'strike', targetId: tree.id, point: [tree.x, y, tree.z + r], normal: [0, 0, 1]});
steps(sim, 30);
const first = strike(); assert.equal(first.ok, true); assert.equal(sim.snapshot().harvestedTrees[0].cuts, 1);
steps(sim, 28); const wild = strike(floor + 1.9); assert.equal(wild.events[0]?.glance, true, 'off-notch swing glances');
assert.equal(sim.snapshot().harvestedTrees[0].cuts, 1, 'persisted wound is not reset by a stray swing');
steps(sim, 28); strike(); steps(sim, 28);
// Save while wounded survives exactly.
assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint()))).snapshot().harvestedTrees, sim.snapshot().harvestedTrees);
const fell = strike(); assert.ok(fell.events.some(e => e.kind === 'tree_fell'));
assert.equal(sim.snapshot().pickups.filter(p => p.kind === 'wood' && !isTestingGift(p)).length, 0);
// Mid-fall save/rejoin: continuing from the save must land exactly once with the cut-height-dependent log yield.
steps(sim, 20); const midFall = JSON.parse(JSON.stringify(sim.checkpoint()));
let landEvents = steps(sim, 600).filter(e => e.kind === 'tree_land');
assert.equal(landEvents.length, 1); assert.equal(sim.snapshot().looseLogs.length, timberSections(tree,midFall.harvestedTrees[0],floor).length);
const resumed = loadSimulation(midFall); const resumedLand = steps(resumed, 600).filter(e => e.kind === 'tree_land');
assert.equal(resumedLand.length, 1); assert.deepEqual(resumed.snapshot().looseLogs, sim.snapshot().looseLogs, 'deterministic logs after resume');
steps(sim, 600); const afterSettle = sim.snapshot().looseLogs; assert.ok(afterSettle.every(l => l.sleeping), 'logs come to rest');
const again = loadSimulation(sim.checkpoint()); steps(again, 120); assert.equal(again.snapshot().looseLogs.length, afterSettle.length, 'no duplicate timber after reload');
// Felled tree no longer accepts chops.
assert.deepEqual(strike().events, []);
// Hands: grab -> swings blocked -> throw -> regrab -> stow; logs never auto-collect.
const target = afterSettle[0], st = sim.checkpoint(); st.players[0].position = [target.position[0], terrainHeight(st, target.position[0], target.position[2] + 1.3), target.position[2] + 1.3]; sim = loadSimulation(st);
assert.equal(act(sim, {action: 'grab', id: target.id}).ok, true);
assert.equal(act(sim, {action: 'strike'}).code, 'hands_full');
steps(sim, 2); const held = sim.snapshot().looseLogs.find(l => l.id === target.id); assert.equal(held.heldBy, 'h');
assert.equal(act(sim, {action: 'release', throw: true, direction: [0, 0, -1]}).ok, true);
steps(sim, 10); assert.ok(sim.snapshot().looseLogs.find(l => l.id === target.id).position[2] < held.position[2] - .5, 'throw travels');
steps(sim, 400);
assert.equal(act(sim, {action: 'release'}).code, 'nothing_held');
// Role change / death releases a held log (no ghost holds).
const s2 = sim.checkpoint(), log2 = s2.looseLogs.find(l => l.id !== target.id); s2.players[0].position = [log2.position[0], terrainHeight(s2, log2.position[0], log2.position[2]) , log2.position[2] + 1]; sim = loadSimulation(s2);
assert.equal(act(sim, {action: 'grab', id: log2.id}).ok, true);
assert.equal(act(sim, {action: 'interact'}).events[0].kind, 'pickup'); assert.equal(sim.snapshot().players[0].resources.wood, 1);
assert.equal(sim.snapshot().looseLogs.length, 2);
// Trunk collision: walking into a standing trunk stops at its surface, never inside it.
const other = worldTrees(sim.checkpoint()).find(t => t.id === 'tree5'), oFloor = terrainHeight(sim.checkpoint(), other.x, other.z);
let walker = heroAt([other.x, oFloor, other.z + 1.5], 0);
for (let i = 0; i < 60; i++) { walker.command('h', {type: 'input', seq: ++seq, move: {x: 0, z: -1}, yaw: 0}); walker.step(); }
const wp = walker.snapshot().players[0].position; assert.ok(Math.hypot(wp[0] - other.x, wp[2] - other.z) >= trunkRadius(other, .5) + .25, 'trunk blocks hero');
// Strict restore: hostile logs and legacy saves.
const base = sim.checkpoint();
for (const corrupt of [s => s.looseLogs[0].position = [1e9, 0, 0], s => s.looseLogs[0].heldBy = 'ghost', s => s.looseLogs.push({...s.looseLogs[0]}), s => s.looseLogs[0].extra = 1, s => s.looseLogs[0].sourceId = 'nope', s => s.harvestedTrees[0].landed = 'yes'])
  { const bad = structuredClone(base); corrupt(bad); assert.throws(() => loadSimulation(bad)); }
const legacy = structuredClone(base); delete legacy.looseLogs; for (const h of legacy.harvestedTrees) delete h.landed;
const legacySim = loadSimulation(legacy); steps(legacySim, 240); assert.equal(legacySim.snapshot().looseLogs.length, 0, 'legacy felled trees already paid their wood');
// Eight players plus the full cadence stay valid.
const crowd = createSimulation({seed: 41}); for (let i = 0; i < 8; i++) assert.equal(crowd.addPlayer({id: 'p' + i}).ok, true);
const t0 = performance.now(); steps(crowd, 600); const perTick = (performance.now() - t0) / 600;
console.log(`tree-integration: notch persistence, glance, mid-fall resume, exact logs, hands, throw, stow, trunk collision, strict/legacy saves pass (${((performance.now() - started) / 1000).toFixed(3)} s; 8-player step ${perTick.toFixed(3)} ms)`);
