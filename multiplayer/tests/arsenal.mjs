// The weapon ladder (2026-11-11 scope pass): new Great Wilds worlds start a Hero with the Axe and Pick; each further
// weapon is forged once, in order, at the village forge; it saves by hero name; every other world and every old save
// keeps all weapons. Also checks the shelved list.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {withWorld} from '../shared/world-extent.js';
import {WEAPON_LADDER, STARTING_WEAPONS, SHELVED_WEAPONS, weaponShelved, weaponOwned, nextWeapon, costShortfall, forgedWeapons, restoreArsenal} from '../shared/arsenal.js';
import {TOOLS} from '../shared/combat.js';
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };

const world = worldDescriptor({kind: 'wilds', seed: 'ci-arsenal', preset: 'continent', size: 2048});
function rig() {
  const sim = createSimulation({room: 'A', seed: 41, world});
  sim.addPlayer({id: 'h1', name: 'Brann', role: 'hero'});
  const st = sim.adventureWorld(), w = worldFor(world);
  let seq = 0;
  const cmd = m => sim.command('h1', {type: 'action', seq: ++seq, ...m});
  const place = (p, x, z) => withWorld(w, () => { p.position = [x, terrainHeight(st, x, z), z]; p.vy = 0; });
  return {sim, st, hero: st.players[0], cmd, place, w};
}
const pay = (hero, cost) => { for (const [k, n] of Object.entries(cost)) hero.resources[k] = n; };

test('ladder and shelf are well formed', () => {
  for (const t of [...STARTING_WEAPONS, ...WEAPON_LADDER.map(s => s.tool), ...SHELVED_WEAPONS]) assert.ok(TOOLS.includes(t), t);
  assert.ok(WEAPON_LADDER.every(s => !SHELVED_WEAPONS.includes(s.tool) && Object.keys(s.cost).every(k => ['wood', 'iron', 'gems'].includes(k))), 'ladder costs use Timber, Iron, Crystal');
  assert.equal(weaponShelved('flask'), true); assert.equal(weaponShelved('flask', {labs: true}), false); assert.equal(weaponShelved('axe'), false);
});

test('a new Wilds hero holds only the Axe and Pick; ladder weapons refuse to equip', () => {
  const {sim, hero, cmd} = rig();
  assert.ok(sim.snapshot().arsenal, 'snapshot says the ladder is on');
  assert.deepEqual(forgedWeapons(sim.snapshot(), hero), []);
  assert.equal(cmd({action: 'equip', tool: 'pick'}).ok, true);
  for (const {tool} of WEAPON_LADDER) assert.equal(cmd({action: 'equip', tool}).code, 'not_forged', tool);
  assert.equal(nextWeapon(sim.snapshot(), hero).tool, WEAPON_LADDER[0].tool);
});

test('forging needs the next rung, the price and the forge, then the weapon is yours', () => {
  const {sim, st, hero, cmd, place} = rig();
  const [first, second] = WEAPON_LADDER;
  place(hero, 0, 4);
  assert.equal(cmd({action: 'craftWeapon', tool: second.tool}).code, 'not_next');
  assert.equal(cmd({action: 'craftWeapon', tool: first.tool}).code, 'insufficient_resources');
  pay(hero, first.cost); place(hero, 60, 60);
  assert.equal(cmd({action: 'craftWeapon', tool: first.tool}).code, 'too_far');
  place(hero, 0, 4);
  const done = cmd({action: 'craftWeapon', tool: first.tool});
  assert.equal(done.ok, true); assert.equal(done.events[0].kind, 'weapon_forged'); assert.equal(done.events[0].rung, 1);
  assert.deepEqual(costShortfall(hero.resources, {wood: 0}), {});
  assert.ok(Object.keys(first.cost).every(k => hero.resources[k] === 0), 'paid in full');
  assert.equal(weaponOwned(sim.snapshot(), hero, first.tool), true);
  assert.equal(cmd({action: 'equip', tool: first.tool}).ok, true);
  assert.equal(cmd({action: 'craftWeapon', tool: first.tool}).code, 'already_forged');
  assert.equal(nextWeapon(st, hero).tool, second.tool);
});

test('forged weapons save by hero name and survive a reload with new peer ids', () => {
  const {sim, hero, cmd, place} = rig();
  place(hero, 0, 3);
  for (const rung of WEAPON_LADDER.slice(0, 2)) { pay(hero, rung.cost); assert.equal(cmd({action: 'craftWeapon', tool: rung.tool}).ok, true); }
  const saved = JSON.parse(JSON.stringify(sim.checkpoint()));
  const back = loadSimulation(saved); back.addPlayer({id: 'h9', name: 'brann ', role: 'hero'});
  const me = back.adventureWorld().players.find(p => p.id === 'h9');
  assert.deepEqual(forgedWeapons(back.snapshot(), me), WEAPON_LADDER.slice(0, 2).map(s => s.tool));
  assert.equal(back.command('h9', {type: 'action', action: 'equip', tool: WEAPON_LADDER[1].tool, seq: 1}).ok, true);
  assert.equal(back.command('h9', {type: 'action', action: 'equip', tool: WEAPON_LADDER[2].tool, seq: 2}).code, 'not_forged');
  const stranger = createSimulation({room: 'A', seed: 41, world}); stranger.addPlayer({id: 'x', name: 'Someone', role: 'hero'});
  assert.deepEqual(forgedWeapons(stranger.snapshot(), stranger.adventureWorld().players[0]), []);
});

test("Brann's Valley and old saves keep every weapon", () => {
  const sim = createSimulation({seed: 9}); sim.addPlayer({id: 'v', name: 'Valley'});
  assert.equal(sim.snapshot().arsenal, undefined);
  for (const {tool} of WEAPON_LADDER) assert.equal(sim.command('v', {type: 'action', action: 'equip', tool, seq: WEAPON_LADDER.findIndex(s => s.tool === tool) + 1}).ok, true, tool);
  const {sim: wild} = rig(); const old = JSON.parse(JSON.stringify(wild.checkpoint())); delete old.arsenal;
  const back = loadSimulation(old); back.addPlayer({id: 'o', name: 'Old', role: 'hero'});
  assert.equal(back.snapshot().arsenal, undefined, 'a Wilds save from before the ladder has no ladder');
  assert.equal(back.command('o', {type: 'action', action: 'equip', tool: 'wyrmspout', seq: 1}).ok, true);
});

test('bad arsenal saves are refused', () => {
  for (const arsenal of [null, [], {forged: []}, {forged: {brann: ['flask']}}, {forged: {brann: ['bow', 'bow']}}, {forged: {Brann: []}}, {forged: {}, extra: 1}])
    assert.throws(() => restoreArsenal({arsenal}), /Invalid arsenal/, JSON.stringify(arsenal));
  assert.deepEqual(restoreArsenal({arsenal: {forged: {brann: ['bow', 'crossbow']}}}), {forged: {brann: ['crossbow', 'bow']}}, 'kept in ladder order');
});
console.log(`arsenal: ${count} checks passed`);
