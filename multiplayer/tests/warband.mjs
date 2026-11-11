// The Warband: a God musters Forgelings, orders them about, and they escort and fight for their Hero.
// Run: node tests/warband.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {WARBAND, warbandOf, formationOffsets, followSlot, warbandUnit} from '../shared/warband.js';
import {enemyHostileTo, createBattle} from '../shared/battle-mode.js';
import {SPELL_SCHOOLS} from '../shared/spells.js';

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const sim = createSimulation({seed: 7}); sim.addPlayer({id: 'g', role: 'god'});
const S = sim.adventureWorld(), god = S.players[0];
let seq = 0;
const cast = (spell, point) => { god.mana = 100; return sim.command('g', {type: 'cast', seq: ++seq, spell, point}); };
const order = (who, body) => sim.command(who, {type: 'action', seq: ++seq, action: 'warband', ...body});
const steps = n => { for (let i = 0; i < n; i++) sim.step(); };
S.enemies.length = 0; S.battle = createBattle(); // no keep war: a quiet valley to drill in

assert.ok(SPELL_SCHOOLS.find(s => s.id === 'summon').spells.includes('muster'));
assert.deepEqual(formationOffsets(0), []);
for (const n of [1, 2, 3, 4, 5, 6]) { const o = formationOffsets(n); assert.equal(o.length, n); for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(o[i][0] - o[j][0], o[i][1] - o[j][1]) > 1.1, `formation ${n} keeps its spacing`); }

// Muster brings down three Forgelings for the caster; they stand still while they land.
let r = cast('muster', [20, 0, 20]);
assert.equal(r.ok, true, r.code);
assert.ok(r.events.some(e => e.kind === 'warband_muster' && e.units.length === WARBAND.muster));
let mine = warbandOf(S, 'g');
assert.equal(mine.length, 3);
assert.ok(mine.every(e => warbandUnit(e) && e.side === 'party' && e.kind === 'skeleton' && e.warband.order.kind === 'follow'));
assert.ok(mine.every(e => !enemyHostileTo(e, 'party') && enemyHostileTo(e, 'rivals')));
const landed = mine.map(e => [...e.position]);
steps(WARBAND.landTicks - 2);
mine.forEach((e, i) => assert.deepEqual(e.position, landed[i], 'no steering while landing'));

// A second muster fills the cap; a third is refused before mana is spent.
assert.equal(cast('muster', [24, 0, 20]).ok, true);
assert.equal(warbandOf(S, 'g').length, WARBAND.perOwner);
god.mana = 100; assert.equal(sim.command('g', {type: 'cast', seq: ++seq, spell: 'muster', point: [20, 0, 24]}).code, 'warband_full'); assert.equal(god.mana, 100);

// A God's following Forgelings have no Hero to follow: they stand guard where they are.
steps(WARBAND.landTicks + 2);
assert.ok(warbandOf(S, 'g').every(e => e.warband.order.kind === 'hold'));

// Move: the group spreads round the point and marches there, then holds.
r = order('g', {order: 'move', point: [0, 0, 32]});
assert.equal(r.ok, true, r.code);
assert.ok(r.events.some(e => e.kind === 'warband_order' && e.order === 'move' && e.units.length === 6));
const goals = warbandOf(S, 'g').map(e => e.warband.order.point);
assert.equal(new Set(goals.map(p => p.join())).size, 6, 'each unit has its own spot');
steps(60 * 14);
for (const e of warbandOf(S, 'g')) { assert.equal(e.warband.order.kind, 'hold'); assert.ok(flat(e.position, e.warband.order.point) < 2.2, `arrived ${flat(e.position, e.warband.order.point)}`); }

// Bad orders refuse.
assert.equal(order('g', {order: 'dance'}).code, 'invalid_order');
assert.equal(order('g', {order: 'move', point: [1e6, 0, 0]}).code, 'invalid_order');
assert.equal(order('g', {order: 'attack', target: 'nobody'}).code, 'invalid_target');
assert.equal(order('g', {order: 'attack', target: warbandOf(S, 'g')[0].id}).code, 'invalid_target', 'no attacking your own');
sim.addPlayer({id: 'x', role: 'god'});
assert.equal(order('x', {order: 'follow'}).code, 'no_warband', 'only the owner commands them');

// Attack: they chase a named wild skeleton and break it; the fight ends in a hold where it fell.
const foe = {...createEnemy('wild1', [8, 0, 32], 'skeleton')}; S.enemies.push(foe);
r = order('g', {order: 'attack', target: 'wild1'});
assert.equal(r.ok, true, r.code);
let fell = false;
for (let i = 0; i < 60 * 30 && !fell; i++) { const ev = sim.step(); fell = ev.some(e => e.kind === 'death' && e.id === 'wild1'); }
assert.ok(fell, 'the warband broke the skeleton'); steps(2);
assert.ok(warbandOf(S, 'g').every(e => e.warband.order.kind === 'hold'));
assert.ok(!S.pickups.some(p => p.kind === 'iron' && Math.hypot(p.x - 8, p.z - 32) > 30), 'salvage only drops where foes fall');

// Wild creatures fight back: a skeleton left alone near the warband goes for it.
const raider = createEnemy('wild2', [0, 0, 26], 'skeleton'); S.enemies.push(raider);
const hpBefore = warbandOf(S, 'g').reduce((n, e) => n + e.hp, 0);
let hurt = false;
for (let i = 0; i < 60 * 20 && S.enemies.includes(raider); i++) { const ev = sim.step(); hurt ||= ev.some(e => e.kind === 'hit' && warbandOf(S, 'g').some(u => u.id === e.id)); }
assert.ok(!S.enemies.includes(raider), 'holding Forgelings defend their point');
assert.ok(hurt || warbandOf(S, 'g').reduce((n, e) => n + e.hp, 0) <= hpBefore);

// Coming down to the land: the warband rallies to the Hero and keeps formation behind them.
for (let i = 0; i < 130; i++) sim.step();
assert.equal(sim.command('g', {type: 'role', role: 'hero'}).ok, true);
assert.ok(warbandOf(S, 'g').every(e => e.warband.order.kind === 'follow'));
god.position = [10, god.position[1], 36]; god.yaw = 0;
steps(60 * 12);
const team = warbandOf(S, 'g');
team.forEach((e, i) => assert.ok(flat(e.position, followSlot(god, i, team.length)) < 3, `in formation ${flat(e.position, followSlot(god, i, team.length))}`));
assert.ok(team.every(e => flat(e.position, god.position) > .9), 'nobody walks into the Hero');

// A Hero's blows and a God's lightning never harm their own Forgelings.
const ally = team[0], hp = ally.hp;
god.mana = 100; sim.addPlayer({id: 'g2', role: 'god'}); const g2 = S.players.find(p => p.id === 'g2'); g2.mana = 100;
sim.command('g2', {type: 'cast', seq: 1, spell: 'lightning', point: [...ally.position]});
assert.equal(ally.hp, hp, 'party lightning spares party Forgelings');

// Saves keep the warband, its orders and owner; corrupt records refuse.
const saved = sim.checkpoint(), back = loadSimulation(saved).adventureWorld();
assert.deepEqual(warbandOf(back, 'g').map(e => e.warband), team.map(e => e.warband));
const corrupt = structuredClone(saved); corrupt.enemies.find(e => e.warband).warband.order = {kind: 'move'};
assert.throws(() => loadSimulation(corrupt), /warband/i);
const sideless = structuredClone(saved); delete sideless.enemies.find(e => e.warband).side;
assert.throws(() => loadSimulation(sideless));
const old = structuredClone(saved); old.enemies = old.enemies.filter(e => !e.warband);
assert.equal(warbandOf(loadSimulation(old).adventureWorld(), 'g').length, 0, 'older saves load without a warband');

console.log(JSON.stringify({status: 'pass', units: team.length}));
