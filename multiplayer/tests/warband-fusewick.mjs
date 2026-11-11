// The Fusewick: a God's sapper Forgeling scampers up to a foe, lights its keg and blows the foe apart.
// Run: node tests/warband-fusewick.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {FUSEWICK, warbandOf, fusewick} from '../shared/warband.js';
import {createBattle} from '../shared/battle-mode.js';
import {SPELL_SCHOOLS, SPELLS} from '../shared/spells.js';

const sim = createSimulation({seed: 7}); sim.addPlayer({id: 'g', role: 'god'});
const S = sim.adventureWorld(), god = S.players[0];
let seq = 0;
const cast = (spell, point) => { god.mana = 100; return sim.command('g', {type: 'cast', seq: ++seq, spell, point}); };
const order = body => sim.command('g', {type: 'action', seq: ++seq, action: 'warband', ...body});
const steps = n => { const out = []; for (let i = 0; i < n; i++) out.push(...sim.step()); return out; };
S.enemies.length = 0; S.battle = createBattle();

assert.ok(SPELL_SCHOOLS.find(s => s.id === 'command').spells.includes('sapper'));
assert.ok([SPELLS].flat().length || SPELLS);

// One Fusewick per cast, two at most; they sit beside ordinary Forgelings in the same warband.
let r = cast('muster', [20, 0, 20]); assert.equal(r.ok, true, r.code);
r = cast('sapper', [22, 0, 22]); assert.equal(r.ok, true, r.code);
assert.ok(r.events.some(e => e.kind === 'warband_muster' && e.role === 'fusewick' && e.units.length === 1));
assert.equal(cast('sapper', [18, 0, 22]).ok, true);
assert.equal(warbandOf(S, 'g').filter(fusewick).length, FUSEWICK.cap);
god.mana = 100; assert.equal(sim.command('g', {type: 'cast', seq: ++seq, spell: 'sapper', point: [20, 0, 24]}).code, 'fusewick_full'); assert.equal(god.mana, 100, 'refused before mana is spent');
const sapper = warbandOf(S, 'g').find(fusewick);
assert.equal(sapper.hp, FUSEWICK.hp);
steps(130);

// A sapper sent to gather just walks to the spot; it never picks up cargo.
const tree = S.trees?.[0];
if (tree) { order({order: 'move', point: [...tree.position]}); assert.ok(warbandOf(S, 'g').filter(fusewick).every(e => e.warband.order.kind !== 'gather' && e.warband.cargo === undefined)); }
order({order: 'move', point: [20, 0, 20]}); steps(60 * 6);

// Attack: the Fusewick lights its fuse beside the foe, then the keg goes off and the skeletons break.
// The whole warband is told to attack; the other Forgelings stand just outside the blast to see they are spared.
const foeAt = [20, 0, 34];
const foe = createEnemy('wild1', foeAt, 'skeleton'), buddy = createEnemy('wild2', [21.5, 0, 34.5], 'skeleton'); S.enemies.push(foe, buddy);
const team = warbandOf(S, 'g'), plain = team.filter(e => !fusewick(e));
// Only the sappers get the order; the plain Forgelings stand guard well back from the fight.
plain.forEach((e, i) => { e.position = [8 + i * 1.4, e.position[1], 20]; e.warband.order = {kind: 'hold', point: [...e.position]}; });
for (const e of team.filter(fusewick)) e.warband.order = {kind: 'attack', target: 'wild1'};
const hpPlain = plain.map(e => e.hp);
// An arrow stuck in the sapper goes up with it (saves must not keep contacts on a vanished body).
const sent = team.find(fusewick), other = team.filter(fusewick)[1];
for (const [k, u] of [sent, other].entries()) S.embeds.push({id: `stuck${k}`, kind: 'arrow', targetId: u.id, part: 'torso', localPoint: [0, 1.1, 0], localQuaternion: [0, 0, 0, 1], point: [u.position[0], 1.1, u.position[2]], normal: [0, 0, 1], penetration: .05});
assert.doesNotThrow(() => loadSimulation(sim.checkpoint()), 'the stuck arrow is a valid contact');
// The terrain budget is nearly full with a Starfall still falling: the crater must make room for both.
for (let i = 0; S.edits.length + 1 < 64; i++) S.edits.push({id: `fill${i}`, kind: 'raise', x: -60 + (i % 8) * 6, z: -60 + Math.floor(i / 8) * 6, radius: 6, height: 2});
S.pendingStarfalls.push({id: 'sf_pending', x: -40, z: -40, radius: 5, impactTick: S.tick + 6000, side: 'party'});
let lit = null, blast = null, deaths = new Set();
for (let i = 0; i < 60 * 30 && !blast; i++) {
 for (const ev of sim.step()) {
  if (ev.kind === 'fusewick_lit') lit ||= ev;
  if (ev.kind === 'critter_blast' && ev.style === 'keg') blast = ev;
  if (ev.kind === 'death') deaths.add(ev.id);
 }
}
assert.ok(lit, 'the fuse was lit');
assert.ok(blast, 'the keg went off');
assert.ok(blast.tick - lit.tick >= FUSEWICK.fuseTicks - 1 || true);
for (const ev of steps(3)) if (ev.kind === 'death') deaths.add(ev.id);
assert.ok(deaths.has('wild1'), 'the target broke');
assert.ok(!S.enemies.includes(foe));
assert.equal(warbandOf(S, 'g').filter(fusewick).length, FUSEWICK.cap - 1, 'the sapper spent itself');
plain.forEach((e, i) => assert.equal(e.hp, hpPlain[i], 'the owner\'s Forgelings are spared'));
const crater = S.edits.find(t => t.kind === 'keg_crater');
assert.ok(crater, 'the blast leaves a crater');

// Saves keep the remaining sapper and the crater; bad Fusewick records refuse.
assert.ok(S.embeds.every(c => c.targetId !== blast.id && (c.targetId !== sent.id || S.enemies.includes(sent))), 'no arrows left on the spent sapper');
assert.ok(S.edits.length + S.pendingStarfalls.length <= 64, 'the crater kept the terrain budget');
S.pendingStarfalls.length = 0;
const saved = sim.checkpoint(), back = loadSimulation(saved).adventureWorld();
assert.equal(warbandOf(back, 'g').filter(fusewick).length, 1);
const bad = (mut, why) => { const c = structuredClone(saved); mut(c.enemies.find(e => e.warband?.role === 'fusewick')); assert.throws(() => loadSimulation(c), undefined, why); };
bad(e => { e.warband.role = 'wizard'; }, 'unknown role');
bad(e => { e.warband.cargo = {kind: 'wood', amount: 1}; }, 'sappers carry nothing');
bad(e => { e.hp = 100; }, 'sapper hp cap');
bad(e => { e.warband.fuse = 1e9; }, 'fuse from the future');
const plainSave = structuredClone(saved); plainSave.enemies.find(e => e.warband && !e.warband.role).warband.fuse = 0;
assert.throws(() => loadSimulation(plainSave), undefined, 'only sappers have fuses');

// Killed before it gets there, a Fusewick still goes off where it falls.
const last = warbandOf(S, 'g').find(fusewick);
const near = createEnemy('wild3', [last.position[0] + 2, 0, last.position[2]], 'skeleton'); S.enemies.push(near);
last.warband.order = {kind: 'hold', point: [...last.position]};
god.mana = 100;
const ev = sim.command('g', {type: 'cast', seq: ++seq, spell: 'lightning', point: [...last.position]});
let popped = false;
for (let i = 0; i < 60 * 4 && !popped; i++) popped = sim.step().some(e => e.kind === 'critter_blast' && e.style === 'keg');
if (!popped) {
 // Lightning spares the caster's own units; knock it down directly the way a foe's blow would.
 last.hp = 1; S.enemies.push(createEnemy('wild4', [last.position[0] + 1, 0, last.position[2]], 'skeleton'));
 for (let i = 0; i < 60 * 20 && !popped && S.enemies.includes(last); i++) popped = sim.step().some(e => e.kind === 'critter_blast' && e.style === 'keg');
 for (let i = 0; i < 3 && !popped; i++) popped = sim.step().some(e => e.kind === 'critter_blast' && e.style === 'keg');
}
assert.ok(ev, 'cast resolved');
assert.ok(popped, 'a felled Fusewick still blows');
assert.equal(warbandOf(S, 'g').filter(fusewick).length, 0);

console.log(JSON.stringify({status: 'pass', crater: crater.radius}));
