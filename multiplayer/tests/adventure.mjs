// Executable checks for shared/adventure.js against the unmodified reference simulation.
// Run: node tests/adventure.mjs   (from the commission folder)
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {createAdventure, stepAdventure, adventureAction, adventureCastGate, adventureCastRefund, validateRestore,
  checkpointAdventure, applyIntentsViaCheckpoint, adventureView, PACING} from '../shared/adventure.js';

const results = [];
const test = (name, fn) => { const t0 = performance.now(); fn(); results.push([name, (performance.now() - t0).toFixed(1)]); };
const T0 = performance.now();
const ctx = {loadSimulation, createEnemy, terrainHeight};

// Harness = the exact host loop described in ADVENTURE-INTEGRATION.md, using the zero-change checkpoint fallback.
class Room {
  constructor(seed = 41) { this.game = createSimulation({room: 'EXPD', seed}); this.adv = createAdventure({seed}); this.pending = []; this.seq = {}; this.log = []; }
  add(id, role) { const r = this.game.addPlayer({id, name: id, role}); assert.ok(r.ok); this.seq[id] = 0; }
  world() { return this.game.snapshot(); }
  edit(fn) { const s = this.game.checkpoint(); fn(s); this.game = loadSimulation(s); } // Test fixture only.
  apply(intents) { const r = applyIntentsViaCheckpoint(this.game, intents, ctx); this.game = r.game; return r; }
  cmd(id, msg) { const r = this.game.command(id, {...msg, seq: ++this.seq[id]}); this.pending.push(...r.events); return r; }
  act(id, msg) {
    const r = adventureAction(this.adv, id, {type: 'adventure', seq: ++this.seq[id], ...msg}, this.world());
    if (r.ok) { const a = this.apply(r.intents); assert.equal(a.skipped.length, 0, 'debit intents must apply'); this.log.push(...r.events); }
    return r;
  }
  cast(id, spell, point) {
    const msg = {type: 'cast', spell, point};
    const gate = adventureCastGate(this.adv, id, msg, this.world());
    if (!gate.ok) return gate;
    const r = this.cmd(id, msg);
    if (!r.ok) adventureCastRefund(this.adv, gate);
    return r;
  }
  tick(n = 1) {
    for (let i = 0; i < n; i++) {
      const events = [...this.pending, ...this.game.step()]; this.pending = [];
      const out = stepAdventure(this.adv, this.world(), events);
      this.log.push(...out.events);
      if (out.intents.length) this.apply(out.intents);
    }
  }
  until(pred, max, step = 6) { for (let t = 0; t < max; t += step) { if (pred()) return true; this.tick(step); } return pred(); }
  player(id) { return this.world().players.find(p => p.id === id); }
  give(id, res) { this.edit(s => Object.assign(s.players.find(p => p.id === id).resources, res)); }
  // Real gathering path: a pickup (as left by a felled tree / broken ore) collected with the sim's own interact action.
  gather(id, kind, amount) {
    this.edit(s => { const p = s.players.find(q => q.id === id); s.pickups.push({id: `tp${s.idCounter + 900}`, kind, x: p.position[0], z: p.position[2], y: p.position[1], amount}); });
    const before = this.player(id).resources[kind];
    assert.ok(this.cmd(id, {type: 'action', action: 'interact'}).ok);
    assert.equal(this.player(id).resources[kind], before + amount);
  }
  clearFoes() { this.edit(s => { s.enemies = s.enemies.filter(e => !e.id.startsWith('xv')); }); } // Stands in for melee combat.
  walkToForge(id) { for (let i = 0; i < 200 && Math.hypot(...[0, 2].map(k => this.player(id).position[k])) > 6; i++) { const p = this.player(id).position; const d = Math.hypot(p[0], p[2]); this.cmd(id, {type: 'input', move: {x: -p[0] / d, z: -p[2] / d}, yaw: 0}); this.tick(3); } }
}

function heroCamp(room, id) {
  const need = room.adv.need;
  room.gather(id, 'wood', 3); room.gather(id, 'wood', 3);
  room.gather(id, 'stone', 2);
  room.walkToForge(id);
  assert.ok(room.act(id, {action: 'deposit', kind: 'wood', amount: 99}).ok);
  room.give(id, {wood: need.wood, stone: need.stone});
  if(room.adv.stock.wood<need.wood)assert.ok(room.act(id, {action: 'deposit', kind: 'wood', amount: 99}).ok);
  assert.ok(room.act(id, {action: 'deposit', kind: 'stone', amount: 99}).ok);
}

test('solo hero: three stages to victory, rewards once, rematch', () => {
  const r = new Room(); r.add('h1', 'hero');
  assert.equal(adventureView(r.adv, r.world(), 'h1').actions[0], 'start');
  r.tick(30); assert.equal(r.adv.stage, 'idle', 'sandbox stays free until someone starts');
  assert.ok(r.act('h1', {action: 'start'}).ok);
  assert.deepEqual(r.adv.need, {wood: 6, stone: 4, star: 0}, 'star goal is fixed when stage II begins');
  // God goals are waived without a God: no deadlock.
  const camp = adventureView(r.adv, r.world(), 'h1');
  assert.ok(camp.objectives.find(o => o.id === 'shape').waived);
  heroCamp(r, 'h1');
  assert.equal(r.player('h1').resources.wood, 6, 'only the needed timber was taken');
  assert.ok(r.until(() => r.adv.stage === 'star', PACING.interlude + 12));
  assert.equal(r.adv.need.star, 4);
  assert.ok(r.until(() => r.adv.star.landed, PACING.interlude + PACING.starWarn + 12, 1));
  assert.ok(r.log.some(e => e.kind === 'adventure_telegraph' && e.telegraph === 'star'), 'star telegraph published before impact');
  const deposits = r.world().deposits.filter(d => d.id.startsWith('xv1s'));
  assert.equal(deposits.length, 2, 'star shards exist as real meteor deposits');
  r.tick(PACING.guardDelay + 2);
  assert.ok(r.world().enemies.some(e => e.kind === 'golem' && e.id.startsWith('xv')), 'guardians spawned through the sim');
  r.gather('h1', 'gems', 2); r.gather('h1', 'gems', 2); r.clearFoes(); r.walkToForge('h1');
  assert.ok(r.act('h1', {action: 'deposit', kind: 'gems', amount: 4}).ok);
  r.tick(1); assert.equal(r.adv.stage, 'rekindle');
  r.give('h1', {wood: 40});
  let fed = 0;
  for (let t = 0; t < 60 * 260 && r.adv.stage === 'rekindle'; t += 30) {
    r.tick(30); r.clearFoes();
    if (r.adv.flame < 90 && fed < 10 && r.act('h1', {action: 'deposit', kind: 'wood', amount: 1}).ok) fed++;
  }
  assert.equal(r.adv.stage, 'victory');
  assert.equal(r.adv.waveIndex, 3);
  assert.equal(r.player('h1').hp,100); assert.equal(r.player('h1').mana,100);
  assert.ok(r.player('h1').resources.gems>=3);const loot=structuredClone(r.player('h1').resources);
  const renown = r.adv.renown.h1; assert.ok(renown >= 20);
  r.tick(120); assert.equal(r.adv.renown.h1, renown, 'no repeated reward while idling at victory');assert.deepEqual(r.player('h1').resources,loot,'resource rewards cannot repeat');
  assert.equal(adventureAction(r.adv, 'h1', {seq: ++r.seq.h1, action: 'retry'}, r.world()).code, 'invalid_stage');
  assert.ok(r.act('h1', {action: 'start'}).ok); assert.equal(r.adv.run, 2); assert.equal(r.adv.stage, 'camp');
  assert.equal(r.adv.renown.h1, renown, 'rematch does not grant anything by itself');
});

test('solo God: tithe, real lightning on guardians, lodestar, idle foes threaten flame', () => {
  const r = new Room(7); r.add('g1', 'god');
  assert.ok(r.act('g1', {action: 'start'}).ok);
  assert.equal(r.act('g1', {action: 'deposit', kind: 'wood', amount: 1}).code, 'role_required');
  assert.ok(r.cast('g1', 'raise', [10, 0, 10]).ok); r.tick(50);
  assert.ok(r.cast('g1', 'grove', [-12, 0, 12]).ok); r.tick(2);
  let tithes = 0;
  for (let i = 0; i < 400 && r.adv.stage === 'camp'; i++) {
    const kind = r.adv.stock.wood < r.adv.need.wood ? 'wood' : 'stone';
    if (r.act('g1', {action: 'tithe', kind}).ok) tithes++;
    r.tick(60);
  }
  assert.equal(r.adv.stage, 'star'); assert.equal(tithes, 5, 'solo tithe covers 10 units at 2 per tithe');
  assert.ok(r.until(() => r.adv.foes.some(f => f.tag === 'g' && f.seen), 60 * 20, 1));
  const site = adventureView(r.adv, r.world(), 'g1').star;
  assert.equal(r.act('g1', {action: 'lodestar', point: [site.x, 0, site.z]}).code, 'guarded');
  for (let i = 0; i < 40 && r.adv.foes.some(f => f.tag === 'g'); i++) {
    const e = r.world().enemies.find(x => x.id.startsWith('xv'));
    if (e) r.cast('g1', 'lightning', e.position);
    r.tick(60);
  }
  assert.equal(r.adv.foes.filter(f => f.tag === 'g').length, 0, 'lightning cleared the idle guardians');
  assert.ok(r.adv.deeds.kills >= 2);
  for (let i = 0; i < 40 && r.adv.stage === 'star'; i++) { r.act('g1', {action: 'lodestar', point: [site.x, 0, site.z]}); r.tick(60); }
  assert.equal(r.adv.stage, 'rekindle');
  const start = r.adv.flame;
  r.tick(PACING.waves[0] + 60);
  const foes = r.world().enemies.filter(e => e.id.startsWith('xv'));
  assert.ok(foes.length === 2 && foes.every(e => Math.hypot(e.position[0], e.position[2]) <= 11), 'solo-God attackers stand inside the flame ring');
  const f0 = r.adv.flame; r.tick(120); assert.ok(r.adv.flame < f0, 'idle attackers drain the flame');
  for (let i = 0; i < 300 && r.adv.stage === 'rekindle'; i++) {
    const e = r.world().enemies.find(x => x.id.startsWith('xv'));
    if (e && r.player('g1').mana >= 22) r.cast('g1', 'lightning', e.position);
    else if (r.player('g1').mana >= 30) r.act('g1', {action: 'tithe'});
    r.tick(60);
  }
  assert.equal(r.adv.stage, 'victory', `solo God can win (flame started ${start})`);
});

test('role parity: God help is capped at a quarter while Heroes gather', () => {
  const r = new Room(); r.add('h1', 'hero'); r.add('g1', 'god');
  r.act('g1', {action: 'start'});
  let given = 0;
  for (let i = 0; i < 20; i++) { if (r.act('g1', {action: 'tithe', kind: 'wood'}).ok) given++; r.tick(130); }
  assert.equal(given, Math.ceil((6 + 4) / 4)); assert.equal(r.adv.stock.wood, 3);
  assert.equal(adventureView(r.adv, r.world(), 'g1').godSupportLeft, 0);
  // With a God present, the path and grove goals become real requirements.
  r.give('h1', {wood: 20, stone: 20}); r.walkToForge('h1');
  r.act('h1', {action: 'deposit', kind: 'wood', amount: 20}); r.act('h1', {action: 'deposit', kind: 'stone', amount: 20});
  r.tick(PACING.interlude + 10); assert.equal(r.adv.stage, 'camp', 'waits for the God path/grove');
  r.cast('g1', 'raise', [6, 0, 14]); r.tick(50); r.cast('g1', 'grove', [-14, 0, 14]);
  r.tick(PACING.interlude + 10); assert.equal(r.adv.stage, 'star');
  // A God leaving mid-requirement never blocks: requirement converts back to optional.
  r.game.removePlayer('g1');
  assert.ok(adventureView(r.adv, r.world(), 'h1').party.gods === 0);
});

test('resources are spent once; duplicates and reconnects cannot farm', () => {
  const r = new Room(); r.add('h1', 'hero'); r.act('h1', {action: 'start'});
  r.give('h1', {wood: 5}); r.walkToForge('h1');
  const msg = {type: 'adventure', seq: ++r.seq.h1, action: 'deposit', kind: 'wood', amount: 5};
  const first = adventureAction(r.adv, 'h1', msg, r.world()); r.apply(first.intents);
  assert.equal(adventureAction(r.adv, 'h1', msg, r.world()).code, 'duplicate_sequence');
  assert.equal(r.adv.stock.wood, 5); assert.equal(r.player('h1').resources.wood, 0);
  assert.equal(r.act('h1', {action: 'deposit', kind: 'wood', amount: 5}).code, 'insufficient_resources');
  // Stale debit (world changed after validation) is refused by the applier instead of going negative.
  const stale = r.apply([{type: 'debit', playerId: 'h1', kind: 'wood', amount: 3}]);
  assert.deepEqual(stale.skipped, ['h1']); assert.equal(r.player('h1').resources.wood, 0);
  r.game.removePlayer('h1'); r.add('h1', 'hero'); r.seq.h1 = r.adv.seqs.h1; r.walkToForge('h1');
  assert.equal(r.player('h1').resources.wood, 0, 'reconnect yields an empty inventory');
  assert.equal(r.act('h1', {action: 'deposit', kind: 'wood', amount: 5}).code, 'insufficient_resources');
  assert.equal(r.adv.stock.wood, 5, 'team stock survives reconnect exactly');
  r.give('h1', {wood: 50}); r.act('h1', {action: 'deposit', kind: 'wood', amount: 50});
  assert.equal(r.adv.stock.wood, 6); assert.equal(r.player('h1').resources.wood, 49, 'surplus is never taken');
});

test('mid-stage save/restore resumes byte-identically', () => {
  const a = new Room(3); a.add('h1', 'hero'); a.add('g1', 'god'); a.act('h1', {action: 'start'});
  heroCamp(a, 'h1'); a.cast('g1', 'raise', [6, 0, 14]); a.tick(50); a.cast('g1', 'grove', [-14, 0, 14]);
  a.tick(PACING.interlude + PACING.starWarn + 100);
  assert.equal(a.adv.stage, 'star');
  const saved = JSON.parse(JSON.stringify({sim: a.game.checkpoint(), adv: checkpointAdventure(a.adv)}));
  const restored = validateRestore(saved.adv); assert.ok(restored.ok, restored.code);
  const b = new Room(3); b.game = loadSimulation(saved.sim); b.adv = restored.adventure; b.seq = {...a.seq};
  for (let i = 0; i < 900; i++) { a.tick(); b.tick(); }
  assert.equal(JSON.stringify(b.adv), JSON.stringify(a.adv));
  assert.equal(JSON.stringify(b.game.checkpoint()), JSON.stringify(a.game.checkpoint()));
});

test('defeat, bounded retries, and leave vote', () => {
  const r = new Room(); r.add('h1', 'hero'); r.add('h2', 'hero'); r.act('h1', {action: 'start'});
  r.adv.stage = 'rekindle'; r.adv.elapsed = 0; r.adv.flame = 25; r.adv.waveIndex = 0; // Fixture: jump to the last stand.
  r.edit(s => { for (let i = 0; i < 6; i++) s.enemies.push(createEnemy(`siege${i}`, [Math.cos(i) * 4, 0, Math.sin(i) * 4], 'golem')); });
  r.tick(60 * 8); assert.equal(r.adv.stage, 'defeat'); assert.equal(r.adv.foes.length, 0);
  r.edit(s => { s.enemies = []; });
  assert.ok(r.act('h2', {action: 'retry'}).ok); assert.equal(r.adv.stage, 'rekindle'); assert.equal(r.adv.retries, 1);
  r.adv.retries = 3; r.adv.stage = 'defeat';
  assert.equal(r.act('h1', {action: 'retry'}).code, 'no_retries');
  r.adv.stage = 'star';
  r.act('h1', {action: 'leave'}); assert.equal(r.adv.stage, 'star', 'one of two votes is not a majority');
  r.act('h2', {action: 'leave'}); assert.equal(r.adv.stage, 'idle');
});

test('hostile God summons are a bounded challenge, never forge spam', () => {
  const r = new Room(); r.add('h1', 'hero'); r.add('g1', 'god'); r.add('g2', 'god'); r.act('g1', {action: 'start'});
  assert.equal(adventureCastGate(r.adv, 'g1', {type: 'cast', spell: 'squad', point: [3, 0, 3]}, r.world()).code, 'expedition_keep_out');
  const hp = r.player('h1').position;
  assert.equal(adventureCastGate(r.adv, 'g1', {type: 'cast', spell: 'skeleton', point: [hp[0], 0, hp[2] + 13]}, r.world()).ok, true);
  r.adv.hostileUsed = 0;
  let spent = 0;
  for (const spell of ['golem', 'squad', 'golem', 'squad']) if (adventureCastGate(r.adv, 'g2', {type: 'cast', spell, point: [-30, 0, -30]}, r.world()).ok) spent++;
  assert.equal(spent, 1, 'budget 4 for one hero: one golem (3), then a squad (4) no longer fits');
  assert.equal(adventureCastGate(r.adv, 'g2', {type: 'cast', spell: 'heal', point: [0, 0, 0]}, r.world()).ok, true, 'support spells unaffected');
  const solo = new Room(); solo.add('g1', 'god'); solo.act('g1', {action: 'start'});
  assert.equal(adventureCastGate(solo.adv, 'g1', {spell: 'skeleton', point: [-30, 0, -30]}, solo.world()).code, 'expedition_no_heroes');
  const idle = new Room(); idle.add('g1', 'god');
  assert.equal(adventureCastGate(idle.adv, 'g1', {spell: 'squad', point: [1, 0, 1]}, idle.world()).ok, true, 'free sandbox untouched');
});

test('hostile payloads and corrupt saves are rejected', () => {
  const r = new Room(); r.add('h1', 'hero'); r.act('h1', {action: 'start'}); r.walkToForge('h1'); r.give('h1', {wood: 5});
  for (const bad of [{amount: -1}, {amount: 1.5}, {amount: '5'}, {amount: 1e9}, {kind: 'gold', amount: 1}, {kind: '__proto__', amount: 1}, {kind: 'wood', amount: NaN}])
    assert.equal(r.act('h1', {action: 'deposit', kind: 'wood', ...bad}).ok, false, JSON.stringify(bad));
  assert.equal(adventureAction(r.adv, 'h1', {seq: 1e300, action: 'start'}, r.world()).code, 'invalid_sequence');
  assert.equal(adventureAction(r.adv, 'ghost', {seq: 99, action: 'start'}, r.world()).code, 'not_joined');
  assert.equal(adventureAction(r.adv, 'h1', null, r.world()).code, 'invalid_message');
  assert.equal(r.act('h1', {action: 'lodestar', point: [0, 0, 0]}).code, 'role_required');
  const good = checkpointAdventure(r.adv);
  assert.ok(validateRestore(good).ok);
  const mutate = fn => { const c = JSON.parse(JSON.stringify(good)); fn(c); return validateRestore(c); };
  const cases = [c => { c.stock.wood = 999; }, c => { c.flame = 101; }, c => { c.extra = 1; }, c => { delete c.need; },
    c => { c.stage = 'boss'; }, c => { c.run = -1; }, c => { c.renown = Object.fromEntries(Array.from({length: 17}, (_, i) => [`p${i}`, 1])); },
    c => { c.foes = Array.from({length: 17}, (_, i) => ({id: `xv1w0${i}`, kind: 'skeleton', tag: 'w0', seen: true, age: 1})); },
    c => { c.foes = [{id: 'h1', kind: 'skeleton', tag: 'w0', seen: true, age: 1}]; }, c => { c.notice = 'x'.repeat(97); },
    c => { c.seqs = JSON.parse('{"__proto__":{"polluted":1}}'); }, c => { c.rewardedRun = c.run + 1; }, c => { c.flame = '50'; },
    c => { c.star.charge = 9; }, c => { c.telegraphs = [{id: 'a', kind: 'gate', x: 1e6, z: 0, radius: 1, until: 1, label: ''}]; }];
  for (const [i, fn] of cases.entries()) assert.equal(mutate(fn).ok, false, `case ${i}`);
  assert.equal(validateRestore(null).ok, false); assert.equal(validateRestore([]).ok, false);
  assert.equal({}.polluted, undefined);
});

test('caps: foes, telegraphs and ledgers stay bounded', () => {
  const r = new Room(); for (let i = 0; i < 8; i++) r.add(`h${i}`, 'hero');
  r.act('h0', {action: 'start'}); assert.deepEqual(r.adv.need, {wood: 16, stone: 9, star: 0});
  r.adv.stage = 'rekindle'; r.adv.elapsed = 0; r.adv.flame = 60;
  let maxFoes = 0;
  for (let t = 0; t < PACING.waves[2] + 30; t += 10) { r.adv.flame = 99; r.tick(10); maxFoes = Math.max(maxFoes, r.adv.foes.length); assert.ok(r.adv.telegraphs.length <= 8); }
  assert.ok(maxFoes <= 16 && maxFoes > 8, `max ${maxFoes}`);
  assert.ok(r.world().enemies.length <= 64);
  for (let i = 0; i < 30; i++) adventureAction(r.adv, 'h0', {seq: 1e6 + i, action: 'leave'}, r.world());
  assert.ok(Object.keys(r.adv.seqs).length <= 16 && r.adv.votes.length <= 8);
});

test('determinism: identical inputs give identical state, empty room pauses', () => {
  const run = () => { const r = new Room(9); r.add('h1', 'hero'); r.act('h1', {action: 'start'}); heroCamp(r, 'h1'); r.tick(1200); return JSON.stringify(r.adv); };
  assert.equal(run(), run());
  const r = new Room(); r.add('h1', 'hero'); r.act('h1', {action: 'start'}); r.tick(10);
  const e = r.adv.elapsed; r.game.removePlayer('h1'); r.tick(600); assert.equal(r.adv.elapsed, e, 'clock paused while nobody is present');
});

// Current compact HUD behavior is covered by tests/expedition-hud.mjs and vr-adventure-panel.mjs.
test('stepAdventure cost at world caps (8 players, 64 enemies)', () => {
  const r = new Room(); for (let i = 0; i < 8; i++) r.add(`h${i}`, 'hero');
  r.act('h0', {action: 'start'}); r.adv.stage = 'rekindle'; r.adv.flame = 50;
  r.edit(s => { for (let i = 0; i < 64; i++) s.enemies.push(createEnemy(`b${i}`, [Math.cos(i) * 20, 0, Math.sin(i) * 20])); });
  const world = r.world(), events = [{kind: 'spell', spell: 'raise', position: [1, 0, 1]}];
  const t0 = performance.now(); for (let i = 0; i < 10000; i++) { r.adv.flame = 50; r.adv.elapsed = 1000; stepAdventure(r.adv, world, events); }
  const us = (performance.now() - t0) * 1000 / 10000;
  console.log(`stepAdventure: ${us.toFixed(2)} us/tick at caps (excludes simulation)`);
  assert.ok(us < 200, 'well inside a 16.7 ms frame');
});

// Authored pacing floor: minimum scripted time per stage when goals are met instantly (real play adds gathering).
test('pacing floor report', () => {
  const floor = {camp: PACING.interlude / 60, star: (PACING.interlude + PACING.starWarn) / 60, rekindle: (PACING.waves[2]) / 60};
  console.log(`pacing floor (s): camp>=${floor.camp} star>=${floor.star} rekindle>=${floor.rekindle} (+flame to 100 from 25 at 0.5/s = 150 s unfed)`);
});

for (const [name, ms] of results) console.log(`ok  ${ms.padStart(8)} ms  ${name}`);
console.log(`${results.length} adventure tests passed`);
console.log(`total ${(performance.now() - T0).toFixed(0)} ms`);
