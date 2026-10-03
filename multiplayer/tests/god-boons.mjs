// God spells feed the Heroes: each cast leaves real materials, fruit or a short boon.
// Run: node tests/god-boons.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {BOONS} from '../shared/god-boons.js';

const sim = createSimulation({seed: 4}); sim.addPlayer({id: 'g', role: 'god'}); sim.addPlayer({id: 'h', role: 'hero'});
const S = sim.adventureWorld(), hero = S.players.find(p => p.id === 'h'); hero.position = [20, 0, 20];
let seq = 0, heroSeq = 0;
const cast = (spell, point, extra = {}) => { S.players[0].mana = 100; const r = sim.command('g', {type: 'cast', seq: ++seq, spell, point, ...extra}); assert.equal(r.ok, true, `${spell}: ${r.code}`); return r.events.filter(e => e.kind === 'god_gift'); };
const gifts = list => list.map(e => e.gift).join(',');

let before = S.deposits.length;
assert.equal(gifts(cast('raise', [30, 0, -20])), 'stone_boulder'); assert.equal(S.deposits.at(-1).kind, 'stone');
assert.equal(gifts(cast('lower', [-30, 0, 20])), 'iron_seam'); assert.equal(S.deposits.at(-1).kind, 'iron');
assert.equal(gifts(cast('raise', [30.5, 0, -20])), '', 'no second seam stacked on the first');
assert.equal(gifts(cast('wall', [10, 0, -30], {start: [10, 0, -30], end: [18, 0, -30]})), 'stone_boulder');
assert.equal(S.deposits.length, before + 3);
assert.equal(gifts(cast('raise', [3, 0, 3])), '', 'nothing is left on the forge apron');
assert.equal(gifts(cast('sunder', [-20, 0, -20], {start: [-20, 0, -20], end: [-12, 0, -20]})), 'crystal,crystal');
assert.equal(gifts(cast('grove', [-25, 0, 30])), 'apple,apple');
assert.equal(gifts(cast('heal', [-25, 0, 30])), 'apple', 'rain ripens fruit on the grove');

// Lightning near a Hero hurts but charges the weapon; charged strikes hit harder and run out.
const hp = hero.hp, struck = cast('lightning', [21, 0, 20]);
assert.equal(gifts(struck), 'charge'); assert.equal(hero.hp, hp - BOONS.charge.strikeDamage); assert.deepEqual(hero.charge, {hits: 3, until: S.tick + BOONS.charge.ticks});
for (let i = 0; i < 4; i++) {
  S.enemies = [];
  sim.command('g', {type: 'cast', seq: ++seq, spell: 'skeleton', point: [hero.position[0], 0, hero.position[2] - 1.5]}); S.players[0].mana = 100;
  const target = S.enemies.at(-1); target.position = [hero.position[0], hero.position[1], hero.position[2] - 1.5]; target.emergeTick = 0; target.hp = 100; hero.yaw = 0; hero.tool = 'axe'; hero.attackTick = -1000;
  const r = sim.command('h', {type: 'action', seq: ++heroSeq, action: 'strike'}), charged = r.events.some(e => e.kind === 'charged_strike');
  assert.equal(charged, i < 3, `strike ${i} charged=${charged}`);
  assert.deepEqual(r.events.filter(e => e.kind === 'hit').map(e => e.damage), [i < 3 ? 34 + BOONS.charge.bonus : 34], 'charged strikes add damage');
}
assert.equal(hero.charge, undefined, 'charge is spent'); S.enemies = [];

// Frost quickens the Hero; the boon expires.
assert.equal(gifts(cast('frost', [hero.position[0] + 1, 0, hero.position[2]])), 'swift');
const x0 = hero.position[0];
for (let i = 0; i < 18; i++) { sim.command('h', {type: 'input', seq: ++heroSeq, move: {x: 1, z: 0}, yaw: 0}); sim.step(); }
assert.ok(hero.position[0] - x0 > 5 * 18 / 60 * 1.3, 'swift Heroes outrun normal pace');
const snap = sim.snapshot().players.find(p => p.id === 'h'); assert.ok(snap.swiftUntil > S.tick, 'boons replicate');
const restored = loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
assert.equal(restored.snapshot().players.find(p => p.id === 'h').swiftUntil, snap.swiftUntil, 'boons survive saves');
for (let i = 0; i < BOONS.swift.ticks; i++) sim.step();
assert.equal(hero.swiftUntil, undefined, 'swift expires');
assert.throws(() => loadSimulation({...sim.checkpoint(), players: sim.checkpoint().players.map(p => p.id === 'h' ? {...p, charge: {hits: 9, until: 0}} : p)}));

// A Tree Ring is a sanctuary.
cast('ring', [hero.position[0], 0, hero.position[2]]); hero.hp = 50;
for (let i = 0; i < 120; i++) sim.step();
assert.ok(Math.abs(hero.hp - (50 + 2 * BOONS.sanctuary.hpPerSecond)) < .01, `ring heals (${hero.hp})`);

// A felled golem breaks into iron and crystal.
cast('golem', [-10, 0, 35]); const golem = S.enemies.at(-1); golem.hp = 1; golem.emergeTick = 0;
const pickupsBefore = S.pickups.length;
S.players[0].mana = 100; sim.command('g', {type: 'cast', seq: ++seq, spell: 'lightning', point: golem.position});
assert.ok(!S.enemies.includes(golem)); assert.deepEqual(S.pickups.slice(pickupsBefore).map(q => [q.kind, q.amount]), [['iron', 2], ['gems', 1]]);
console.log('god-boons: raise/lower/wall seams, sunder crystal, grove and rain fruit, lightning charge, frost swift, ring sanctuary, golem core passed');
