// Bloom rises as life thrives and unlocks the Life Spring, Blessing and Quake.
// Run: node tests/bloom.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {BLOOM, bloomLevel, nextBloom} from '../shared/bloom.js';
import {BOONS} from '../shared/god-boons.js';
import {spellUnavailable} from '../client/spell-availability.js';

assert.deepEqual([0, 29, 30, 89, 90, 180, 999].map(bloomLevel), [0, 0, 1, 1, 2, 3, 3]);
assert.equal(nextBloom(0), 30); assert.equal(nextBloom(200), 0);

const sim = createSimulation({seed: 5}); sim.addPlayer({id: 'g', role: 'god'}); sim.addPlayer({id: 'h', role: 'hero'});
const S = sim.adventureWorld(), god = S.players[0], hero = S.players.find(p => p.id === 'h'); hero.position = [20, 0, 20];
let seq = 0;
const cast = (spell, point) => { god.mana = 100; return sim.command('g', {type: 'cast', seq: ++seq, spell, point}); };

// Locked spells refuse before mana is spent; the client says why.
assert.equal(S.bloom, 0);
assert.equal(cast('spring', [10, 0, 10]).code, 'bloom_locked'); assert.equal(god.mana, 100);
assert.equal(spellUnavailable(sim.snapshot(), god, 'spring'), 'Unlocks at Bloom 1');

// Groves raise Bloom; crossing a threshold announces the level.
let levelEvents = [];
for (let i = 0; i < 15; i++) { const r = cast('grove', [-40 + (i % 5) * 9, 0, -40 + Math.floor(i / 5) * 9]); assert.equal(r.ok, true, r.code); levelEvents.push(...r.events.filter(e => e.kind === 'bloom_level')); }
assert.equal(S.bloom, 15 * BLOOM.grove); assert.deepEqual(levelEvents.map(e => e.level), [1]);
assert.equal(spellUnavailable(sim.snapshot(), god, 'spring'), '');

// Life Spring heals a Hero standing in it, then dries up.
assert.equal(cast('spring', [20, 0, 20]).ok, true);
hero.hp = 50; for (let i = 0; i < 60; i++) sim.step();
assert.ok(Math.abs(hero.hp - (50 + BLOOM.spring.hpPerSecond)) < 1e-6, `spring healed to ${hero.hp}`);
assert.equal(sim.snapshot().springs.length, 1);
for (let i = 0; i < 9; i++) cast('spring', [-20 + i * 4, 0, 30]);
assert.equal(S.springs.length, BLOOM.spring.cap, 'the oldest spring gives way instead of refusing');

// Eating fruit and felling the God's creatures feed Bloom.
const apple = S.pickups.find(q => q.kind === 'apple'); hero.position = [apple.x, apple.y, apple.z]; hero.hp = 40;
const ate = sim.command('h', {type: 'action', seq: 1, action: 'collectTarget', targetId: apple.id});
assert.equal(ate.ok, true, ate.code); assert.equal(S.bloom, 30 + BLOOM.apple);

// Save and restore keep Bloom and live springs; older saves start at zero.
const saved = sim.checkpoint(), restored = loadSimulation(saved);
assert.equal(restored.snapshot().bloom, S.bloom); assert.equal(restored.snapshot().springs.length, S.springs.length);
const old = structuredClone(saved); delete old.bloom; delete old.springs;
assert.equal(loadSimulation(old).snapshot().bloom, 0);
assert.throws(() => loadSimulation({...saved, bloom: -1}));
assert.throws(() => loadSimulation({...saved, springs: [{id: 'x', x: 0, z: 0, expireTick: saved.tick + 99999}]}));

// Blessing (Bloom 2) heals and gives a long weapon charge; Quake (Bloom 3) hurts foes and shakes ore loose.
S.bloom = 90; hero.position = [20, 0, 20]; hero.hp = 50;
const blessed = cast('blessing', [21, 0, 20]); assert.equal(blessed.ok, true, blessed.code);
assert.equal(hero.hp, 50 + BOONS.blessing.heal); assert.deepEqual(hero.charge, {hits: BOONS.blessing.hits, until: S.tick + BOONS.blessing.ticks});
assert.equal(loadSimulation(sim.checkpoint()).snapshot().players.find(p => p.id === 'h').charge.hits, BOONS.blessing.hits, 'blessing charge survives a save');
assert.equal(cast('quake', [-20, 0, -20]).code, 'bloom_locked');
S.bloom = 180; S.enemies = [];
sim.command('g', {type: 'cast', seq: ++seq, spell: 'skeleton', point: [-20, 0, -18]}); const foe = S.enemies.at(-1); foe.emergeTick = 0;
const hp = hero.hp; hero.position = [-22, 0, -20];
const quake = cast('quake', [-20, 0, -20]); assert.equal(quake.ok, true, quake.code);
assert.ok(foe.hp < 100 && foe.slowUntil > S.tick, 'quake hurts and slows foes');
assert.equal(hero.hp, Math.max(0, hp - BOONS.quake.heroDamage) || 100);
assert.deepEqual(quake.events.filter(e => e.kind === 'god_gift').map(e => e.material), BOONS.quake.ores);

// A felled creature counts only when a Hero fells it.
const before = S.bloom; S.enemies = []; S.bloom = 200;
sim.command('g', {type: 'cast', seq: ++seq, spell: 'skeleton', point: [hero.position[0], 0, hero.position[2] - 1.5]});
const target = S.enemies.at(-1); target.position = [hero.position[0], hero.position[1], hero.position[2] - 1.5]; target.emergeTick = 0; target.hp = 1; hero.yaw = 0; hero.tool = 'axe'; hero.attackTick = -1000;
const kill = sim.command('h', {type: 'action', seq: 2, action: 'strike'});
assert.ok(kill.events.some(e => e.kind === 'death' && e.id === target.id), 'skeleton felled');
assert.equal(S.bloom, 200 + BLOOM.skeleton); void before;

// Passive: living groves breathe Bloom every 30 s.
S.bloom = 0; while (S.tick % BLOOM.passiveTicks !== BLOOM.passiveTicks - 1) sim.step();
sim.step(); assert.equal(S.bloom, Math.min(BLOOM.passiveCap, S.groves.length));
console.log('bloom: ok');
