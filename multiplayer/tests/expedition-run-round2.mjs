// Expedition Roguelite, round two: rotating Heart guardians (Colossus, Bone Warden, Shardback), the Wandering Smith
// trader, and run omens. Driven through the pure director with a stand-in world.
import assert from 'node:assert/strict';
import {createRun, stepRun, runAction, restoreRun, omenFor, OMENS, OMEN_IDS, BOSSES, RUN_TUNING, tradePrice, nodeHaul, buildRoute, dailySeed} from '../shared/expedition-run.js';
import {arenaOpenGround, arenaCamp} from '../shared/run-sites.js';
import {BOONS} from '../shared/run-boons.js';
import {createEnemy, makeBoss, enemyMaxHp} from '../shared/combat.js';
import {heroMaxHp, grantXp} from '../shared/hero-progress.js';

const ground = arenaOpenGround(), camp = arenaCamp(), T = RUN_TUNING;
const ctx = {createEnemy, terrainHeight: () => 0, grantXp, heroMaxHp, makeBoss, enemyMaxHp};
const hero = (id = 'h1', at = [0, 0]) => ({id, name: id, role: 'hero', hp: 100, mana: 0, xp: 0, position: [at[0], 0, at[1]], resources: {}, runBoons: []});
const world = (run, players = [hero()]) => ({tick: 0, players, enemies: [], deposits: [], run});
const tick = (st, events = []) => { st.tick++; return stepRun(st, events, ctx).events; };

// Omens: deterministic, the Daily always has one, and every omen turns up.
const seeds = Array.from({length: 300}, (_, i) => i * 7919 + 13);
assert.equal(omenFor(31337), omenFor(31337));
assert.ok(seeds.every(s => omenFor(s, 'daily') !== 'calm'), 'the Daily Expedition always has an omen');
assert.deepEqual(new Set(seeds.map(s => omenFor(s))), new Set(OMEN_IDS), 'every omen appears');
const calmShare = seeds.filter(s => omenFor(s) === 'calm').length / seeds.length;
assert.ok(calmShare > .2 && calmShare < .5, `clear skies about a third of the time (${calmShare})`);
assert.ok(OMEN_IDS.includes(omenFor(dailySeed('2026-10-17'), 'daily')));
// Bosses rotate.
assert.deepEqual(new Set(seeds.map(s => createRun({seed: s, camp, sites: ground}).boss)), new Set(Object.keys(BOSSES)), 'all three guardians rotate in');
// The trader turns up in routes.
assert.ok(seeds.slice(0, 60).some(s => buildRoute(s, camp, ground).some(n => n.kind === 'trader')), 'the Wandering Smith appears on routes');

function runWith({seed = 31337, boss, omen, players} = {}) {
  const run = createRun({seed, camp, sites: ground, boss});
  if (omen) run.omen = omen;
  return world(run, players);
}
function fightAt(st, n) {
  st.run.stage = 'travel'; st.run.target = n.id; st.players[0].position = [n.x, 0, n.z]; tick(st);
  return st;
}

// ---- Bone Warden: the dead keep climbing out while it stands.
{
  const st = runWith({boss: 'warden', omen: 'calm'}), heart = st.run.nodes.find(n => n.kind === 'heart');
  fightAt(st, heart); assert.equal(st.run.stage, 'fight');
  const boss = st.enemies.find(e => e.boss === 'warden'); assert.ok(boss && boss.kind === 'golem');
  const guards = st.run.foes.length;
  // Fell the first guards, then wait: it raises more.
  st.enemies = st.enemies.filter(e => e.id === boss.id); tick(st); assert.equal(st.run.foes.length, 1);
  let raised = 0; for (let i = 0; i < BOSSES.warden.raise + 2; i++) raised += tick(st).filter(e => e.kind === 'run_raise').length;
  assert.equal(raised, 1, 'the Warden raises a wave'); assert.ok(st.run.foes.length > 1, 'raised dead join the fight');
  assert.ok(guards > 1);
  // Felling the Warden and its raised dead wins the Heart.
  st.enemies = []; tick(st); assert.equal(st.run.stage, 'reward');
}
// ---- Shardback: mends until its three heartstones are cracked.
{
  const st = runWith({boss: 'shardback', omen: 'calm'}), heart = st.run.nodes.find(n => n.kind === 'heart');
  fightAt(st, heart);
  const boss = st.enemies.find(e => e.boss === 'shardback'), max = enemyMaxHp(boss);
  assert.equal(st.run.shards.length, BOSSES.shardback.stones, 'three heartstones stand');
  assert.ok(st.run.shards.every(id => st.deposits.find(d => d.id === id)?.kind === 'crystal'));
  boss.hp = Math.round(max / 2); for (let i = 0; i < 120; i++) tick(st);
  assert.ok(boss.hp > max / 2, 'it mends while heartstones stand');
  const events = [];
  for (const id of st.run.shards) { const d = st.deposits.find(q => q.id === id); d.depleted = true; d.hits = d.maxHits; events.push(...tick(st)); }
  assert.equal(events.filter(e => e.kind === 'run_heartstone').length, 3, 'each cracked heartstone is announced');
  assert.equal(st.run.objective.have, 3);
  const hp = boss.hp; for (let i = 0; i < 180; i++) tick(st); assert.equal(boss.hp, hp, 'no mending once they are gone');
  // Saves keep the stones and objective.
  assert.deepEqual(restoreRun(JSON.parse(JSON.stringify(st.run))).shards, st.run.shards);
}
// ---- Wandering Smith: buy with haul, or move on.
{
  const st = runWith({omen: 'calm', players: [hero('h1'), hero('h2')]}), n = {...st.run.nodes.find(q => q.tier === 1), kind: 'trader'};
  st.run.nodes = st.run.nodes.map(q => q.id === n.id ? n : q);
  st.run.haul = 40; for (const p of st.players) st.run.applied[p.id] = true;
  st.run.stage = 'travel'; st.run.target = n.id; st.players[0].position = [n.x, 0, n.z]; tick(st);
  assert.equal(st.run.stage, 'reward', 'no fight at the smith'); assert.equal(st.run.haul, 40, 'the smith pays nothing himself');
  const offer = st.run.offers.h1, prices = offer.map(id => tradePrice(st.run, n, id));
  assert.ok(prices.every(p => p >= 15), 'prices rise with tier');
  const cheap = offer[prices.indexOf(Math.min(...prices))], dear = prices.some(p => p > 40);
  assert.ok(runAction(st, st.players[0], {action: 'boon', boon: cheap}, ctx).ok);
  assert.equal(st.run.haul, 40 - Math.min(...prices), 'buying spends the haul');
  assert.ok(st.players[0].runBoons.includes(cheap));
  st.run.haul = 0;
  assert.equal(runAction(st, st.players[1], {action: 'boon', boon: st.run.offers.h2[0]}, ctx).code, 'cant_afford');
  assert.ok(runAction(st, st.players[1], {action: 'skip'}, ctx).ok, 'anyone can walk on by');
  assert.equal(runAction(st, st.players[1], {action: 'skip'}, ctx).code, 'invalid_skip');
  tick(st); assert.equal(st.run.stage, 'decide');
  assert.deepEqual(restoreRun(JSON.parse(JSON.stringify(st.run))).picks, st.run.picks, "a skipped purchase survives saves");
  void dear;
  // Waiting too long walks on without buying.
  const st2 = runWith({omen: 'calm'}); st2.run.nodes = st2.run.nodes.map(q => q.id === n.id ? n : q); st2.run.applied.h1 = true; st2.run.haul = 500;
  st2.run.stage = 'travel'; st2.run.target = n.id; st2.players[0].position = [n.x, 0, n.z]; tick(st2);
  for (let i = 0; i < T.pick + 2; i++) tick(st2);
  assert.equal(st2.run.picks.h1, 'skip'); assert.equal(st2.run.haul, 500, 'nothing is bought for you');
  // Skipping is only for the smith.
  const st3 = runWith({omen: 'calm'}); st3.run.stage = 'reward'; st3.run.at = st3.run.nodes[0].id; st3.run.offers.h1 = ['keen'];
  assert.equal(runAction(st3, st3.players[0], {action: 'skip'}, ctx).code, 'invalid_skip');
}
// ---- Omen effects.
{
  const sk = runs => { const n = runs.run.nodes.find(q => q.kind === 'skirmish'); fightAt(runs, n); return runs.run.foes.length; };
  const calm = sk(runWith({omen: 'calm'})), blood = sk(runWith({omen: 'bloodmoon'}));
  assert.equal(blood, calm + OMENS.bloodmoon.foes, 'Blood Moon brings more foes');
  const a = runWith({omen: 'calm'}).run, b = runWith({omen: 'bloodmoon'}).run, n0 = a.nodes[0];
  assert.equal(nodeHaul(b, n0), Math.round(NODE_HAUL(n0) * 1.3), 'and more haul');
  const s1 = runWith({omen: 'starfall'}), t = s1.run.nodes.find(q => q.kind === 'treasure') || {...s1.run.nodes[0], kind: 'treasure'};
  s1.run.nodes = s1.run.nodes.map(q => q.id === t.id ? t : q); fightAt(s1, t);
  assert.equal(s1.run.shards.length, T.shards + 1, 'Starfall adds a shard'); assert.equal(nodeHaul(s1.run, t), Math.round(NODE_HAUL(t) * 2));
  const lr = runWith({omen: 'longroad'}); assert.ok(runAction(lr, lr.players[0], {action: 'begin'}, ctx).ok);
  assert.equal(lr.run.lives, T.livesBase - 1, 'the Long Road starts with one fewer life');
  lr.players[0].hp = 10; const n1 = lr.run.nodes.find(q => q.kind === 'shrine' && q.tier === 0) || lr.run.nodes.find(q => q.kind === 'skirmish');
  fightAt(lr, n1); lr.enemies = []; tick(lr);
  assert.equal(lr.run.stage, 'reward'); assert.equal(lr.players[0].hp, heroMaxHp(lr.players[0]), 'and heals fully at every destination');
  assert.equal(lr.run.offers.h1.length, 4, 'with one more card');
  const g = runWith({omen: 'gilded'}), gs = g.run.nodes.find(q => q.kind === 'skirmish'); fightAt(g, gs);
  const before = g.run.haul, felled = g.run.foes.slice(0, 2).map(f => f.id); g.enemies = g.enemies.filter(e => !felled.includes(e.id)); tick(g);
  assert.equal(g.run.haul - before, 2 * (T.killHaul + OMENS.gilded.killHaul), 'Gilded Road pays per foe');
  assert.equal(restoreRun(JSON.parse(JSON.stringify(g.run))).omen, 'gilded');
  const {omen, ...old} = JSON.parse(JSON.stringify(g.run)); assert.equal(restoreRun(old).omen, 'calm', 'older runs load as Clear Skies');
  assert.throws(() => restoreRun({...g.run, omen: 'doom'}), /omen/);
}
function NODE_HAUL(n) { return {skirmish: 20, elite: 40, treasure: 35, hold: 30, shrine: 6, underways: 50, heart: 120, trader: 0}[n.kind] * (1 + .35 * n.tier); }
assert.ok(Object.keys(BOONS).length >= 16);
console.log('expedition run round two: ok');
