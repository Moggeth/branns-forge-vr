// The rabble (shared/critters.js): Kettlebelly vents and, punctured, jets about and bursts; Bramblehog curls, rolls
// through skeletons and goes dizzy; Kegtoter plants its keg, blows it, cheers and digs away (or goes up early when the
// keg is struck). The God's Rabble summon picks one by its cast id, and saves keep every critter's state.
// Run: node tests/critters.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {createEnemy, hitEnemyPart} from '../shared/combat.js';
import {terrainHeight} from '../shared/terrain.js';
import {CRITTER, CRITTER_KINDS, rabbleKind, kettlePhase, bramblePhase, kegPhase, critterDamageScale} from '../shared/critters.js';

const world = () => { const sim = createSimulation({room: 'RABBLE', seed: 5}); sim.addPlayer({id: 'h', role: 'hero'}); return sim; };
const S = sim => sim.adventureWorld();
const step = (sim, n = 1) => { const ev = []; for (let i = 0; i < n; i++) ev.push(...sim.step()); return ev; };
const at = (s, x, z) => [x, terrainHeight(s, x, z), z];
const place = (s, kind, x, z, id = `t_${kind}`) => { const e = createEnemy(id, at(s, x, z), kind); s.enemies.push(e); return e; };
const hero = s => s.players.find(p => p.role === 'hero');
const roundTrip = sim => loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
const finiteAll = e => e.position.every(Number.isFinite) && Number.isFinite(e.yaw) && Number.isFinite(e.hp);
const X = 20, Z = -20; // open ground, clear of the forge apron and the camp

{ // Rabble: every kind can answer, the pick is pure, and a cast spawns one critter that rises from the earth.
  const seen = new Set(); for (let i = 0; i < 60; i++) seen.add(rabbleKind(`r${i}`));
  assert.deepEqual([...seen].sort(), [...CRITTER_KINDS].sort());
  assert.equal(rabbleKind('r7'), rabbleKind('r7'));
  const sim = createSimulation({room: 'RABBLE', seed: 5}); sim.addPlayer({id: 'g', role: 'god'}); const s = S(sim);
  const before = s.enemies.length, r = sim.command('g', {type: 'cast', seq: 1, spell: 'rabble', point: at(s, X, Z)});
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(s.enemies.length, before + 1);
  const c = s.enemies.at(-1); assert.ok(CRITTER_KINDS.includes(c.kind)); assert.equal(c.emergeTick, s.tick); assert.equal(c.hp, CRITTER[c.kind].hp);
}

{ // Kettlebelly: waddles up, builds pressure, vents a steam cone that scalds the Hero in front of it.
  const sim = world(), s = S(sim), k = place(s, 'kettlebelly', X, Z), h = hero(s); h.position = at(s, X, Z - 6);
  let ev = [], vented = false; const hp0 = h.hp;
  for (let i = 0; i < 900 && !vented; i++) { ev = step(sim); vented = ev.some(e => e.kind === 'kettle_vent' && e.id === k.id); }
  assert.ok(vented, 'it vents once it is close and facing'); assert.ok(h.hp < hp0, 'the steam scalds');
  assert.ok(Math.hypot(k.position[0] - h.position[0], k.position[2] - h.position[2]) < CRITTER.kettlebelly.ventRange + .1);
  assert.ok(finiteAll(k)); assert.equal(kettlePhase(k, s.tick), 'vent');
  // Punctured below 45%: it leaks, skids about on its own jet, and bursts on schedule, hurting what is near.
  const skel = place(s, 'skeleton', k.position[0] + 1.5, k.position[2]);
  const out = []; hitEnemyPart(s, k, 'torso', CRITTER.kettlebelly.hp * .6, {ownerId: 'h', point: k.position, normal: [0, 0, 1]}, {nextId: (st, p) => `${p}${++st.idCounter}`, terrainHeight}, out);
  assert.ok(k.leakTick !== undefined && out.some(e => e.kind === 'kettle_leak'));
  const p0 = [...k.position], again = roundTrip(sim); assert.equal(S(again).enemies.find(e => e.id === k.id).leakTick, k.leakTick, 'saves keep the leak');
  ev = step(sim, 40); assert.ok(Math.hypot(k.position[0] - p0[0], k.position[2] - p0[2]) > .5, 'jets about');
  ev = step(sim, CRITTER.kettlebelly.leakTicks);
  assert.ok(!s.enemies.includes(k), 'it burst'); assert.ok(ev.some(e => e.kind === 'critter_blast' && e.style === 'kettle'));
  assert.ok(s.pickups.some(p => p.kind === 'iron'), 'rivets and plate to salvage');
}

{ // Bramblehog: curls, rolls through a skeleton (tossing it), stops dizzy and soft, then trots again.
  const sim = world(), s = S(sim), b = place(s, 'bramblehog', X, Z), h = hero(s); h.position = at(s, X, Z - 9);
  b.yaw = 0; const skel = place(s, 'skeleton', X, Z - 4);
  let ev = [], curled = false; for (let i = 0; i < 400 && !curled; i++) { ev = step(sim); curled = ev.some(e => e.kind === 'bramble_curl'); }
  assert.ok(curled); assert.equal(bramblePhase(b, s.tick), 'curl'); assert.ok(critterDamageScale(b, s.tick) < 1, 'spines turn blows while curled');
  const all = step(sim, CRITTER.bramblehog.curlTicks + CRITTER.bramblehog.rollTicks + 2);
  assert.ok(all.some(e => e.kind === 'bramble_bowl' && e.target === skel.id), 'it bowled the skeleton');
  assert.ok(all.some(e => e.kind === 'bramble_stop')); assert.equal(bramblePhase(b, s.tick), 'dizzy'); assert.ok(critterDamageScale(b, s.tick) > 1, 'dizzy is soft');
  assert.ok(finiteAll(b)); const again = roundTrip(sim); assert.equal(S(again).enemies.find(e => e.id === b.id).dizzyTick, b.dizzyTick);
  step(sim, CRITTER.bramblehog.dizzyTicks + 2); assert.equal(bramblePhase(b, s.tick), 'trot');
}

{ // Kegtoter: totters to the Hero, plants the keg, blows it after the fuse, cheers, then digs away and is gone.
  const sim = world(), s = S(sim), m = place(s, 'kegtoter', X, Z), h = hero(s); h.position = at(s, X, Z - 5);
  let ev = [], planted = false; for (let i = 0; i < 900 && !planted; i++) { ev = step(sim); planted = ev.some(e => e.kind === 'keg_plant'); }
  assert.ok(planted && m.kegAt); assert.equal(kegPhase(m, s.tick), 'fuse');
  const hp0 = h.hp; ev = step(sim, CRITTER.kegtoter.fuseTicks + 1);
  assert.ok(ev.some(e => e.kind === 'critter_blast' && e.style === 'keg')); assert.ok(h.hp < hp0, 'the blast reaches the Hero');
  assert.ok(s.enemies.includes(m) && m.blastTick !== undefined && m.kegAt === undefined, 'the mole survives its own keg');
  ev = step(sim, CRITTER.kegtoter.cheerTicks + CRITTER.kegtoter.burrowTicks + 2);
  assert.ok(!s.enemies.includes(m) && ev.some(e => e.kind === 'keg_gone'), 'it dug away');
}

{ // A struck keg goes off at once, and a blast that kills a neighbouring Kegtoter sets its keg off too.
  const sim = world(), s = S(sim), a = place(s, 'kegtoter', X, Z, 'k_a'), b = place(s, 'kegtoter', X + 1.5, Z, 'k_b'), h = hero(s); h.position = at(s, X + 30, Z);
  const out = [], ctx = {nextId: (st, p) => `${p}${++st.idCounter}`, terrainHeight, damageHero: () => {}};
  const head = [a.position[0], a.position[1] + CRITTER.kegtoter.height + .1, a.position[2]];
  hitEnemyPart(s, a, 'head', 5, {ownerId: 'h', point: head, normal: [0, 0, 1]}, ctx, out);
  assert.ok(!s.enemies.includes(a), 'the keg took the mole with it');
  const blasts = out.filter(e => e.kind === 'critter_blast'); assert.equal(blasts.length, 2, 'a chain of kegs is a chain of booms');
  assert.ok(!s.enemies.includes(b));
}

{ // Review fixes: blasts hurt Heroes on every kill path; summons wait out their rise; inconsistent saves are refused.
  const sim = world(), s = S(sim), m = place(s, 'kegtoter', X, Z, 'k_bare'), h = hero(s); h.position = at(s, X + 1, Z); const hp0 = h.hp;
  hitEnemyPart(s, m, 'torso', 999, null, {nextId: (st, p) => `${p}${++st.idCounter}`, terrainHeight}, []); // a bare context, like a Quake or a trap
  assert.ok(h.hp < hp0, 'the keg still hurts the Hero');
  const b = place(s, 'bramblehog', X - 6, Z, 'b_rise'); b.emergeTick = s.tick; const p0 = [...b.position]; h.position = at(s, X - 6, Z - 1.2); h.hp = 100;
  step(sim, 30); assert.ok(Math.hypot(b.position[0] - p0[0], b.position[2] - p0[2]) < 1e-6 && h.hp === 100, 'no moving or nipping while it climbs out');
  const k = place(s, 'kegtoter', X + 8, Z, 'k_bad'); k.plantTick = s.tick; const bad = JSON.parse(JSON.stringify(sim.checkpoint()));
  assert.throws(() => loadSimulation(bad), /enemy/i, 'a lit fuse needs its keg');
}

{ // Long mixed run: no NaN, nothing escapes the world, and every checkpoint loads.
  const sim = world(), s = S(sim), h = hero(s); h.position = at(s, X, Z - 3);
  for (let i = 0; i < 6; i++) place(s, CRITTER_KINDS[i % 3], X + (i % 3) * 3 - 3, Z + 4 + Math.floor(i / 3) * 3, `mix${i}`);
  for (let i = 0; i < 12; i++) { step(sim, 100); for (const e of s.enemies) assert.ok(finiteAll(e), e.id); h.hp = Math.max(h.hp, 60); roundTrip(sim); }
}
console.log('critters: rabble pick, kettle vent/leak/burst, hog curl/roll/dizzy, keg plant/blast/burrow, keg chains, saves');
