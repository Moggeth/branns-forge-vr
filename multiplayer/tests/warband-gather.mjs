// The Warband at work: an order on a rock or tree sets Forgelings quarrying and felling, and they haul each load home.
// Run: node tests/warband-gather.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {createBattle} from '../shared/battle-mode.js';
import {createEnemy} from '../shared/combat.js';
import {WARBAND, warbandOf} from '../shared/warband.js';

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const sim = createSimulation({seed: 7}); sim.addPlayer({id: 'g', role: 'god'});
const S = sim.adventureWorld(), god = S.players[0];
S.enemies.length = 0; S.battle = createBattle(); // a quiet valley: no keep war
let seq = 0;
const order = body => sim.command('g', {type: 'action', seq: ++seq, action: 'warband', ...body});
const run = (n, until = () => false) => { const ev = []; for (let i = 0; i < n && !until(ev); i++) ev.push(...sim.step()); return ev; };
god.mana = 100; assert.equal(sim.command('g', {type: 'cast', seq: ++seq, spell: 'muster', point: [6, 0, -4]}).ok, true);
run(WARBAND.landTicks + 2);

// An explicit gather order on bare ground refuses; a march order on an iron seam becomes one.
assert.equal(order({order: 'gather', point: [30, 0, 30]}).code, 'invalid_target');
const seam = S.deposits.find(d => d.id === 'ore8');
let r = order({order: 'move', point: [seam.x + .6, 0, seam.z]});
assert.equal(r.ok, true, r.code);
assert.ok(r.events.some(e => e.kind === 'warband_order' && e.order === 'gather' && e.job === 'iron'));
assert.ok(warbandOf(S, 'g').every(e => e.warband.order.kind === 'gather' && e.warband.order.job === 'iron'));

// They swing at the seam (their strikes chip it), break it, carry the ore and hand it over at the Forge.
const ironBefore = god.resources.ironOre || 0;
let ev = run(60 * 20, e => e.some(x => x.kind === 'warband_delivery'));
assert.ok(ev.some(e => e.kind === 'stone_hit' && warbandOf(S, 'g').some(u => u.id === e.by)), 'Forgelings chip the rock');
assert.ok(ev.some(e => e.kind === 'ore_break' && e.id === 'ore8'));
const drop = ev.find(e => e.kind === 'warband_delivery');
assert.ok(drop && drop.by === 'g' && drop.resource === 'ironOre');
assert.ok(Math.hypot(drop.position[0], drop.position[2]) < WARBAND.forgeDrop + WARBAND.drop + .5, 'delivered at the Forge');
assert.equal(god.resources.ironOre, ironBefore + drop.amount);

// Saves keep a load in hand and the work in progress; corrupt loads refuse.
const carrier = () => warbandOf(S, 'g').find(e => e.warband.cargo);
run(60 * 20, () => !!carrier());
assert.ok(carrier(), 'someone is hauling');
const saved = sim.checkpoint(), back = loadSimulation(saved).adventureWorld();
assert.deepEqual(warbandOf(back, 'g').map(e => e.warband), warbandOf(S, 'g').map(e => e.warband));
for (const bad of [{kind: 'gold', amount: 2}, {kind: 'wood', amount: 0}, {kind: 'wood', amount: WARBAND.haul + 1}, {kind: 'wood', amount: 1, extra: 1}]) {
 const c = structuredClone(saved); c.enemies.find(e => e.warband?.cargo).warband.cargo = bad;
 assert.throws(() => loadSimulation(c), /warband/i, JSON.stringify(bad));
}
const badJob = structuredClone(saved); badJob.enemies.find(e => e.warband).warband.order = {kind: 'gather', job: 'stone', point: [0, 0, 0]};
assert.throws(() => loadSimulation(badJob), /warband/i);

// Once every seam round the point is spent they stand guard there.
run(60 * 60, () => warbandOf(S, 'g').every(e => e.warband.order.kind === 'hold'));
assert.ok(warbandOf(S, 'g').every(e => e.warband.order.kind === 'hold' && !e.warband.cargo), 'the area is bare');
assert.ok(['ore6', 'ore7', 'ore8'].every(id => S.deposits.find(d => d.id === id).depleted));
assert.equal(god.resources.ironOre, ironBefore + 12, 'three seams, four ore each');

// Timber: an order on a trunk fells it; they chop, wait for the logs to land and carry each one home.
const woodBefore = god.resources.wood || 0;
r = order({order: 'move', point: [-12.8, 0, -9.4]});
assert.ok(r.events.some(e => e.order === 'gather' && e.job === 'wood'));
ev = run(60 * 40, () => (god.resources.wood || 0) >= woodBefore + 3);
assert.ok(ev.some(e => e.kind === 'tree_fell' && e.id === 'tree6'));
assert.ok(ev.some(e => e.kind === 'pickup' && e.id.startsWith('log')));
assert.ok(god.resources.wood >= woodBefore + 3, `timber hauled: ${god.resources.wood - woodBefore}`);

// A change of orders keeps a load (it is delivered on the next gather) and the save still loads.
run(60 * 30, () => !!carrier()); assert.ok(carrier(), 'someone hauls timber: ' + JSON.stringify(warbandOf(S, 'g').map(e => e.warband.order.kind)));
r = order({order: 'move', point: [2, 0, -16]}); assert.ok(r.events.some(e => e.order === 'move'), JSON.stringify(r));
assert.ok(warbandOf(S, 'g').some(e => e.warband.cargo && e.warband.order.kind === 'move'));
assert.doesNotThrow(() => loadSimulation(sim.checkpoint()));

// Set upon at work, they fight back.
r = order({order: 'move', point: [-12.8, 0, -9.4]}); // tree6's stump is spent: nearest standing trunks round it
const units = warbandOf(S, 'g'), at = units[0].position;
const raider = createEnemy('wildG', [at[0] + 2.5, at[1], at[2]], 'skeleton'); S.enemies.push(raider);
run(60 * 25, () => !S.enemies.includes(raider));
assert.ok(!S.enemies.includes(raider), 'gatherers defend themselves');
console.log(JSON.stringify({status: 'pass', iron: god.resources.ironOre - ironBefore, wood: god.resources.wood - woodBefore, units: units.length}));
