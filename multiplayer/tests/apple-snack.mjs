// Apple on a stick (shared/fruit.js): pierce, fall, plant/rest, take, bite to the core, regrow, saves.
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {APPLE_SLOTS,FRUIT,appleWorld,fruitSlice,fruitCandidate,isAppleTree} from '../shared/fruit.js';
import {nearestCollectible} from '../shared/collection-target.js';
import {readFileSync} from 'node:fs';

const start = performance.now(); let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('ok ' + name); };
let seq = 0;
const act = (sim, action, extra = {}) => sim.command('h', {type: 'action', seq: ++seq, action, ...extra});

// A hero standing 4 m from an apple tree, bow in hand, looking at apple `slot`.
function scene(slot = 0, tool = 'bow') {
 const base = createSimulation({seed: 41}); base.addPlayer({id: 'h'});
 const s = base.checkpoint(), tree = worldTrees(s).find(t => isAppleTree(t) && Math.hypot(t.x, t.z) > 9 && Math.hypot(t.x, t.z) < 40);
 const floor = terrainHeight(s, tree.x, tree.z), apple = appleWorld(tree, slot, floor);
 const out = [apple.position[0] - tree.x, apple.position[2] - tree.z], l = Math.hypot(...out), at = [apple.position[0] + out[0]/l*4, 0, apple.position[2] + out[1]/l*4];
 at[1] = terrainHeight(s, at[0], at[2]); s.players[0].position = at; s.players[0].tool = tool; s.players[0].hp = 40;
 const sim = loadSimulation(s); seq = 0;
 return {sim, tree, apple, origin: [at[0], at[1] + 1.5, at[2]]};
}
const aim = (from, to) => { const d = to.map((n, i) => n - from[i]), l = Math.hypot(...d); return d.map(n => n/l); };
const state = sim => sim.checkpoint();
const step = (sim, n) => { const events = []; for (let i = 0; i < n; i++) events.push(...sim.step()); return events; };

check('apple slot table matches the authored apple tree GLB', () => {
 const b = readFileSync(new URL('../public/assets/tree.glb', import.meta.url)), jl = b.readUInt32LE(12), J = JSON.parse(b.subarray(20, 20 + jl).toString());
 const node = J.nodes.find(n => n.name === 'Fruit'), a = J.accessors[J.meshes[node.mesh].primitives[0].attributes.POSITION], v = J.bufferViews[a.bufferView];
 assert.equal(a.count, APPLE_SLOTS.length*42); const stride = v.byteStride || 12, off = (v.byteOffset || 0) + (a.byteOffset || 0);
 for (let k = 0; k < APPLE_SLOTS.length; k++) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = k*42; i < k*42 + 42; i++) for (let j = 0; j < 3; j++) { const n = b.readFloatLE(28 + jl + off + i*stride + j*4); lo[j] = Math.min(lo[j], n); hi[j] = Math.max(hi[j], n); }
  for (let j = 0; j < 3; j++) assert.ok(Math.abs((lo[j] + hi[j])/2 - APPLE_SLOTS[k][j]) < .002, `slot ${k} axis ${j}`); }
});

check('an arrow through a hanging apple takes it onto the shaft and stops', () => {
 const {sim, apple, origin} = scene(0);
 assert.equal(act(sim, 'fire', {origin, direction: aim(origin, apple.position), draw: 1}).ok, true);
 const events = step(sim, 30), pierce = events.find(e => e.kind === 'apple_pierce');
 assert.ok(pierce, 'pierced'); assert.equal(pierce.stick, 'arrow'); assert.equal(pierce.by, 'h');
 const s = state(sim); assert.equal(s.projectiles.length, 0, 'the arrow stopped in the apple');
 assert.equal(s.fruit.missing.length, 1); assert.equal(s.fruit.drops.length, 1); assert.equal(s.fruit.drops[0].stick, 'arrow');
 assert.ok(!s.embeds.length, 'no separate embed');
});

check('the shaft falls, weathervanes and comes to rest on the ground; it is never lost in the soil', () => {
 const {sim, apple, origin} = scene(2);
 act(sim, 'fire', {origin, direction: aim(origin, apple.position), draw: 1});
 const events = step(sim, 400), s = state(sim), d = s.fruit.drops[0];
 assert.ok(events.some(e => e.kind === 'apple_land'), 'landed');
 assert.ok(['rest', 'planted'].includes(d.mode), d.mode);
 const g = terrainHeight(s, d.position[0], d.position[2]);
 assert.ok(d.position[1] >= g + .02 && d.position[1] < g + .75, `apple ${d.position[1] - g} m above the ground`);
});

check('a Siegebird bolt takes apples too', () => {
 const {sim, apple, origin} = scene(4, 'crossbow');
 assert.equal(act(sim, 'fire', {origin, direction: aim(origin, apple.position)}).ok, true);
 const pierce = step(sim, 20).find(e => e.kind === 'apple_pierce'); assert.equal(pierce?.stick, 'bolt');
});

check('a missed shot takes nothing; a pierced apple cannot be taken twice', () => {
 const {sim, apple, origin} = scene(0);
 act(sim, 'fire', {origin, direction: aim(origin, [apple.position[0], apple.position[1] + 3, apple.position[2]]), draw: 1});
 assert.ok(!step(sim, 60).some(e => e.kind === 'apple_pierce'));
 step(sim, 40); act(sim, 'fire', {origin, direction: aim(origin, apple.position), draw: 1}); assert.ok(step(sim, 30).some(e => e.kind === 'apple_pierce'));
 step(sim, 40); act(sim, 'fire', {origin, direction: aim(origin, apple.position), draw: 1});
 const again = step(sim, 30).filter(e => e.kind === 'apple_pierce'); assert.ok(again.every(e => e.slot !== 0), 'the same apple is gone');
});

function landed() {
 const f = scene(0); act(f.sim, 'fire', {origin: f.origin, direction: aim(f.origin, f.apple.position), draw: 1}); step(f.sim, 400);
 const s = state(f.sim), d = s.fruit.drops[0];
 s.players[0].position = [d.position[0] + .6, terrainHeight(s, d.position[0] + .6, d.position[2]), d.position[2]];
 f.sim = loadSimulation(s); seq = 1000; return {...f, drop: d};
}
check('collect takes the apple on its stick; collect again and the primary action bite it', () => {
 const {sim, drop} = landed(), s0 = state(sim), p0 = s0.players[0], bloom0 = s0.bloom;
 const c = nearestCollectible(s0, p0); assert.equal(c?.id, drop.id); assert.equal(c.type, 'snack');
 assert.equal(act(sim, 'collectTarget', {targetId: drop.id}).ok, true);
 let s = state(sim); assert.equal(s.fruit.drops[0].heldBy, 'h'); assert.equal(s.fruit.drops[0].mode, 'held');
 assert.equal(nearestCollectible(s, s.players[0])?.held, true, 'the held snack comes first');
 assert.equal(act(sim, 'snack', {op: 'bite'}).code, 'cooldown', 'a beat to admire it first');
 step(sim, FRUIT.biteTicks);
 const hp = [state(sim).players[0].hp], events = [];
 for (let i = 0; i < 3; i++) { const r = i === 1 ? act(sim, 'collectTarget', {targetId: drop.id}) : act(sim, 'snack', {op: 'bite'}); assert.equal(r.ok, true, `bite ${i + 1}`); events.push(...r.events);
  assert.equal(act(sim, 'snack', {op: 'bite'}).code, i < 2 ? 'cooldown' : 'nothing_held'); hp.push(state(sim).players[0].hp); step(sim, FRUIT.biteTicks); }
 assert.deepEqual(hp.slice(1).map((n, i) => +(n - hp[i]).toFixed(3)), FRUIT.biteHeal, 'each bite heals');
 assert.equal(+(hp[3] - hp[0]).toFixed(3), 50);
 assert.deepEqual(events.filter(e => e.kind === 'snack_bite').map(e => e.bite), [1, 2, 3]);
 assert.ok(events.some(e => e.kind === 'snack_done')); assert.ok(state(sim).bloom > bloom0, 'the eaten seed feeds Bloom');
 assert.equal(state(sim).fruit.drops.length, 0);
});

check('it can be eaten at full health, put down, and other heroes cannot take it from the hand', () => {
 const {sim, drop} = landed(); const s = state(sim); s.players[0].hp = 100; const sim2 = loadSimulation(s); sim2.addPlayer({id: 'g'});
 assert.equal(sim2.command('h', {type: 'action', seq: 5000, action: 'collectTarget', targetId: drop.id}).ok, true);
 const t = sim2.checkpoint(); t.players[1].position = [...t.players[0].position]; const sim3 = loadSimulation(t);
 assert.equal(sim3.command('g', {type: 'action', seq: 1, action: 'collectTarget', targetId: drop.id}).ok, false);
 for (let i = 0; i < FRUIT.biteTicks; i++) sim3.step();
 assert.equal(sim3.command('h', {type: 'action', seq: 5001, action: 'snack', op: 'bite'}).ok, true, 'a treat even at full health');
 assert.equal(sim3.command('h', {type: 'action', seq: 5002, action: 'equip', tool: 'axe'}).ok, true);
 const after = sim3.checkpoint().fruit.drops[0]; assert.equal(after.heldBy, null, 'changing tools puts it down'); assert.equal(after.bites, 1, 'bites are kept');
});

check('saves round-trip falling, resting and held drops; legacy saves start with no fruit', () => {
 const {sim, apple, origin} = scene(0); act(sim, 'fire', {origin, direction: aim(origin, apple.position), draw: 1}); step(sim, 12);
 const s = state(sim); assert.equal(s.fruit.drops[0].mode, 'air');
 const again = loadSimulation(JSON.parse(JSON.stringify(s))); for (let i = 0; i < 300; i++) { again.step(); sim.step(); }
 assert.deepEqual(again.checkpoint().fruit, state(sim).fruit, 'deterministic after reload');
 const legacy = state(sim); delete legacy.fruit; assert.deepEqual(loadSimulation(legacy).checkpoint().fruit, {missing: [], drops: []});
 const bad = state(sim); bad.fruit.drops[0].stick = 'spear'; assert.throws(() => loadSimulation(bad));
 const bad2 = state(sim); bad2.fruit.drops[0].heldBy = 'nobody'; assert.throws(() => loadSimulation(bad2));
 assert.ok('fruit' in createSimulation({seed: 1}).snapshot());
});

check('apples grow back after about three minutes', () => {
 const {sim, apple, origin} = scene(0); act(sim, 'fire', {origin, direction: aim(origin, apple.position), draw: 1}); step(sim, 30);
 assert.equal(state(sim).fruit.missing.length, 1); step(sim, FRUIT.regrowTicks - 40); assert.equal(state(sim).fruit.missing.length, 1); step(sim, 20); assert.equal(state(sim).fruit.missing.length, 0);
});

check('a cutting wire knocks loose every apple it slices, bare', () => {
 const {sim, tree, apple} = scene(0), s = state(sim), [x, y, z] = apple.position;
 const events = fruitSlice(s, {nextId: (st, p) => p + (++st.idCounter), terrainHeight}, [x - 4, y, z + 4], [x + 4, y, z - 4], {by: 'h', push: [1, 0, 0]});
 assert.ok(events.length >= 1 && events.length <= 8); assert.ok(s.fruit.drops.every(d => d.stick === 'none'));
 assert.equal(fruitCandidate(s, s.players[0]), null, 'out of reach');
});

check('performance: 96 arrows sweeping an orchard stay cheap', () => {
 const {sim, origin} = scene(0); const s = state(sim); s.players[0].tool = 'bow';
 for (let i = 0; i < 96; i++) s.projectiles.push({id: 'q' + (9000 + i), ownerId: 'h', kind: 'arrow', position: [...origin], previousPosition: [...origin], velocity: [Math.cos(i)*30, 2, Math.sin(i)*30], curve: [0, 0, 0], bornTick: s.tick, trail: [[...origin]]});
 const busy = loadSimulation(s), t0 = performance.now(); for (let i = 0; i < 60; i++) busy.step(); const ms = (performance.now() - t0)/60;
 console.log(`  ${ms.toFixed(3)} ms per step with 96 arrows`); assert.ok(ms < 12, `${ms} ms`);
});

console.log(`apple-snack: ${checks} checks passed in ${((performance.now() - start)/1000).toFixed(3)} s`);
