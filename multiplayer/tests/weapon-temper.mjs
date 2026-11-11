// Forge tempering (2026-11-11 progression pass): owned weapons temper three times at the forge for Timber, Iron and
// Crystal; each tier adds 15% to that weapon's hits; tiers save with the hero by name; unforged ladder weapons refuse.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {withWorld} from '../shared/world-extent.js';
import {createEnemy} from '../shared/combat.js';
import {TEMPER, TEMPER_TOOLS, temperLevel, temperScale, temperCost, atForge, validTemper} from '../shared/weapon-temper.js';
import {heroMaxHp} from '../shared/hero-progress.js';
import {progressModel} from '../client/hero-progress-ui.js';
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };
const give = (p, n = 99) => { p.resources.wood = n; p.resources.iron = n; p.resources.gems = n; };

test('table is well formed', () => {
  assert.equal(TEMPER.costs.length, TEMPER.max);
  assert.ok(TEMPER.costs.every(c => Object.keys(c).every(k => ['wood', 'iron', 'gems'].includes(k))), 'costs use Timber, Iron, Crystal');
  assert.equal(temperScale({role: 'hero', temper: {axe: 2}}, 'axe'), 1.3); assert.equal(temperScale({role: 'hero', temper: {axe: 2}}, 'pick'), 1);
  assert.equal(temperScale({role: 'god', temper: {axe: 2}}, 'axe'), 1);
  assert.equal(temperCost({temper: {bow: 3}}, 'bow'), null);
  assert.ok(validTemper(undefined) && validTemper({axe: 3}) && !validTemper({axe: 4}) && !validTemper({flask: 1}) && !validTemper({axe: 0}));
});

test('valley: temper at the heart forge, pay, refuse far away and when broke, cap at three', () => {
  const sim = createSimulation({room: 'T'}); sim.addPlayer({id: 'h', name: 'Brann'});
  const st = sim.adventureWorld(), p = st.players[0]; let seq = 0;
  const cmd = m => sim.command('h', {type: 'action', seq: ++seq, ...m});
  p.position = [60, terrainHeight(st, 60, 60), 60]; give(p);
  assert.equal(cmd({action: 'temper', tool: 'axe'}).code, 'too_far');
  p.position = [2, terrainHeight(st, 2, 2), 2];
  assert.equal(atForge(st, p), true);
  assert.equal(cmd({action: 'temper', tool: 'flask'}).code, 'invalid_weapon');
  const r = cmd({action: 'temper', tool: 'axe'}); assert.equal(r.ok, true); assert.equal(r.events[0].kind, 'weapon_tempered'); assert.equal(r.events[0].tier, 1);
  assert.equal(p.resources.iron, 99 - TEMPER.costs[0].iron);
  cmd({action: 'temper', tool: 'axe'}); cmd({action: 'temper', tool: 'axe'});
  assert.equal(temperLevel(p, 'axe'), 3); assert.equal(cmd({action: 'temper', tool: 'axe'}).code, 'fully_tempered');
  give(p, 0); assert.equal(cmd({action: 'temper', tool: 'pick'}).code, 'insufficient_resources');
  assert.deepEqual(sim.snapshot().players[0].temper, {axe: 3});
  // Saves keep it, and the name ledger hands it back to a rejoining hero.
  const saved = JSON.parse(JSON.stringify(sim.checkpoint()));
  assert.deepEqual(loadSimulation(saved).snapshot().players[0].temper, {axe: 3});
  assert.deepEqual(saved.heroLedger.brann.temper, {axe: 3});
  sim.removePlayer('h'); sim.addPlayer({id: 'h2', name: 'Brann'});
  assert.deepEqual(sim.snapshot().players[0].temper, {axe: 3});
  const bad = JSON.parse(JSON.stringify(saved)); bad.players[0].temper = {axe: 9};
  assert.throws(() => loadSimulation(bad), /player/);
  const old = JSON.parse(JSON.stringify(saved)); delete old.players[0].temper; delete old.heroLedger;
  assert.equal(loadSimulation(old).snapshot().players[0].temper, undefined, 'old saves load untempered');
});

test('a tempered weapon hits harder', () => {
  const hit = temper => {
    const sim = createSimulation(); sim.addPlayer({id: 'h', name: 'Mitch'});
    const c = sim.checkpoint(), p = c.players[0]; p.position = [10, terrainHeight(c, 10, 10), 10]; p.yaw = 0; p.tool = 'axe'; if (temper) p.temper = temper; p.hp = heroMaxHp(p);
    const g = createEnemy('g', [10, terrainHeight(c, 10, 8.4), 8.4], 'golem'); g.armor = 0; c.enemies = [g];
    const u = loadSimulation(c), hp = g.hp;
    const r = u.command('h', {type: 'action', seq: 1, action: 'strike', targetId: 'g', point: [10, terrainHeight(c, 10, 8.4) + 1.2, 8.4], normal: [0, 0, 1], part: 'torso'});
    assert.equal(r.ok, true); return hp - u.snapshot().enemies[0].hp;
  };
  assert.ok(Math.abs(hit({axe: 2}) / hit(null) - 1.3) < 1e-9);
  assert.ok(Math.abs(hit({pick: 3}) / hit(null) - 1) < 1e-9, 'another weapon\'s temper does nothing for the axe');
});

test('temper also counts against rival heroes in home-base PvP', () => {
  const pvp = temper => {
    const sim = createSimulation({seed: 9}); sim.addPlayer({id: 'host'}); const w = sim.adventureWorld(); sim.addPlayer({id: 'foe'});
    const [p, foe] = w.players; foe.side = 'rivals'; if (temper) p.temper = temper;
    p.position = [0, terrainHeight(w, 0, 0), 20]; p.yaw = 0; foe.position = [0, terrainHeight(w, 0, 18.6), 18.6]; foe.protectedUntil = 0;
    const hp = foe.hp; assert.equal(sim.command('host', {type: 'action', action: 'strike', seq: 5, targetId: 'foe', point: [0, 1, 18.6], normal: [0, 0, 1]}).ok, true);
    return hp - foe.hp;
  };
  assert.ok(Math.abs(pvp({axe: 3}) / pvp(null) - 1.45) < 1e-9);
});

test('wilds: only weapons you have forged temper, at the village forge', () => {
  const world = worldDescriptor({kind: 'wilds', seed: 'ci-temper', preset: 'continent', size: 2048});
  const sim = createSimulation({room: 'W', seed: 41, world}); sim.addPlayer({id: 'h1', name: 'Brann', role: 'hero'});
  const st = sim.adventureWorld(), p = st.players[0], w = worldFor(world); let seq = 0;
  const cmd = m => sim.command('h1', {type: 'action', seq: ++seq, ...m});
  withWorld(w, () => { p.position = [3, terrainHeight(st, 3, 3), 3]; }); give(p);
  assert.equal(cmd({action: 'temper', tool: 'crossbow'}).code, 'not_forged');
  assert.equal(cmd({action: 'temper', tool: 'pick'}).ok, true);
  withWorld(w, () => { p.position = [80, terrainHeight(st, 80, 80), 80]; });
  assert.equal(cmd({action: 'temper', tool: 'pick'}).code, 'too_far');
});

test('carried iron ore pays for a temper, as it does at the forge', () => {
  const sim = createSimulation(); sim.addPlayer({id: 'h', name: 'Ore'}); const c = sim.checkpoint(), p = c.players[0];
  p.role = 'hero'; p.position = [0, terrainHeight(c, 0, 2), 2]; p.resources = {wood: 4, iron: 2, ironOre: 5};
  const u = loadSimulation(c), r = u.command('h', {type: 'action', seq: 1, action: 'temper', tool: 'axe'});
  assert.equal(r.ok, true, JSON.stringify(r)); const me = u.snapshot().players[0];
  assert.equal(me.resources.iron, 0, 'refined iron goes first'); assert.equal(me.resources.ironOre, 1); assert.equal(me.temper.axe, 1);
});

test('panel model shows the temper tier, cost and whether you can pay here', () => {
  const m = progressModel({xp: 0, temper: {axe: 1}, resources: {wood: 99, iron: 99, gems: 99}}, {atForge: true});
  const axe = m.weapons.find(w => w.id === 'axe');
  assert.equal(axe.temper.tier, 1); assert.deepEqual(axe.temper.cost, TEMPER.costs[1]); assert.equal(axe.temper.state, 'available');
  assert.equal(progressModel({xp: 0, resources: {wood: 99, iron: 99, gems: 99}}).weapons[0].temper.state, 'away');
  assert.equal(progressModel({xp: 0, resources: {}}, {atForge: true}).weapons[0].temper.state, 'short');
  assert.equal(progressModel({xp: 0, temper: {axe: 3}}).weapons[0].temper.state, 'max');
  assert.ok(TEMPER_TOOLS.every(t => ['axe', 'pick', 'hammer', 'crossbow', 'bow', 'wyrmspout'].includes(t)));
});
console.log(`weapon-temper: ${count} passed`);
