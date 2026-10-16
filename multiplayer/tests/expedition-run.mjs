// Expedition Roguelite (shared/expedition-run.js): seeded routes reproduce, a run plays from camp to every ending,
// boons and kits apply, lives are shared, the Heart guardian is a scaled golem, and runs survive save/load.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {stepRun, buildRoute, routeChoices, RUN_TUNING, restoreRun, dailySeed, NODE_KINDS} from '../shared/expedition-run.js';
import {arenaOpenGround, arenaCamp} from '../shared/run-sites.js';
import {BOONS, KITS} from '../shared/run-boons.js';
import {itemBonus} from '../shared/hero-items.js';
import {heroMaxHp} from '../shared/hero-progress.js';
import {partPosition, validPartHit, enemyMaxHp, createEnemy, makeBoss} from '../shared/combat.js';
import {terrainHeight} from '../shared/terrain.js';
import {grantXp} from '../shared/hero-progress.js';

const ground = arenaOpenGround(), camp = arenaCamp();
assert.ok(ground.length > 100, 'today’s map offers plenty of open run sites');

// Same seed, same route; different seeds, different routes. Every node is reachable and leads to the Heart.
const a = buildRoute(777, camp, ground), b = buildRoute(777, camp, ground), c = buildRoute(778, camp, ground);
assert.deepEqual(a, b, 'a seed reproduces its route exactly');
assert.notDeepEqual(a, c, 'another seed builds another route');
for (const seed of [1, 2, 3, 99, 4242, 123456, dailySeed('2026-10-16')]) {
  const nodes = buildRoute(seed, camp, ground), byId = new Map(nodes.map(n => [n.id, n]));
  assert.equal(nodes.filter(n => n.kind === 'heart').length, 1);
  const reach = new Set(nodes.filter(n => n.tier === 0).map(n => n.id));
  for (let t = 0; t < RUN_TUNING.tiers - 1; t++) for (const n of nodes.filter(n => n.tier === t)) { assert.ok(n.next.length >= 1, 'every node leads on'); if (reach.has(n.id)) n.next.forEach(id => reach.add(id)); }
  assert.equal(reach.size, nodes.length, `every destination is reachable (seed ${seed})`);
  for (const n of nodes) for (const m of nodes) if (n !== m) assert.ok(Math.hypot(n.x - m.x, n.z - m.z) >= RUN_TUNING.spacing * .6 - 1e-6, 'destinations are spread out');
  for (let t = 0; t < RUN_TUNING.tiers - 1; t++) assert.ok(nodes.filter(n => n.tier === t).some(n => n.kind !== 'shrine'), 'each tier offers a fight');
  assert.ok([...byId.values()].every(n => Object.hasOwn(NODE_KINDS, n.kind)));
}

let seq = 1;
const cmd = (sim, id, m) => sim.command(id, {...m, type: 'run', seq: seq++});
const steps = (sim, n) => { const out = []; for (let i = 0; i < n; i++) out.push(...sim.step()); return out; };
const teleport = (sim, id, x, z) => { const st = sim.checkpoint(); const p = st.players.find(q => q.id === id); p.position = [x, p.position[1], z]; return loadSimulation(st); };
const killAll = sim => { const st = sim.checkpoint(); const ids = new Set(st.run.foes.map(f => f.id)); st.enemies = st.enemies.filter(e => !ids.has(e.id)); return loadSimulation(st); };
const mineShards = sim => { const st = sim.checkpoint(); for (const d of st.deposits) if (st.run.shards.includes(d.id)) { d.depleted = true; d.hits = d.maxHits; } return loadSimulation(st); };

function clear(sim, id) {
  // Walk to the chosen destination and win its encounter.
  let s = sim.snapshot(); const n = s.run.nodes.find(q => q.id === s.run.target);
  sim = teleport(sim, id, n.x, n.z); steps(sim, 3); s = sim.snapshot();
  if (n.kind === 'shrine') { assert.equal(s.run.stage, 'reward'); return sim; }
  assert.equal(s.run.stage, 'fight', `arriving starts the ${n.kind}`);
  if (n.kind === 'heart') {
    const boss = s.enemies.find(e => typeof e.boss === 'string');
    assert.ok(boss, 'the Heart has its guardian');
    assert.equal(boss.hp, enemyMaxHp(boss)); assert.ok(boss.hp >= 1500, 'the guardian is a real boss');
    const head = partPosition(boss, 'head'); assert.ok(head[1] - boss.position[1] > 4, 'the crowned colossus towers');
    assert.ok(validPartHit(boss, 'head', head), 'hits land on its scaled body');
    const reloaded = loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint()))).snapshot().enemies.find(e => typeof e.boss === 'string');
    assert.deepEqual({hp: reloaded.hp, armor: reloaded.armor, boss: reloaded.boss}, {hp: boss.hp, armor: boss.armor, boss: boss.boss}, 'a live guardian survives saves and host handover');
  }
  for (let i = 0; i < 80 && sim.snapshot().run.stage === 'fight'; i++) {
    if (n.kind === 'treasure') sim = mineShards(sim);
    if (n.kind === 'underways' && sim.snapshot().run.delve) {
      // The party went down into a real dungeon (tests/underways.mjs plays those through): call the hoard won and walk out.
      const st = sim.checkpoint(); assert.ok(st.underways.runs.some(r => r.id === st.run.delve && r.tag === `xr:${n.id}`), 'a tagged dungeon opened');
      assert.ok(st.players[0].position[0] > 1000, 'the Hero is down in the Underways');
      st.run.objective.have = 1; sim = loadSimulation(st);
    }
    sim = killAll(sim); sim = teleport(sim, id, n.x, n.z); steps(sim, n.kind === 'hold' ? 400 : 5);
  }
  assert.equal(sim.snapshot().run.stage, 'reward', `${n.kind} clears`);
  return sim;
}

// A full solo run to victory through every tier.
{
  let sim = createSimulation({room: 'RUN', seed: 41, run: {format: 'expedition', seed: 31337}});
  sim.addPlayer({id: 'h1', name: 'Mitch', role: 'hero'});
  assert.equal(sim.snapshot().run.stage, 'camp');
  assert.equal(sim.snapshot().battle.v, 2, 'the keeps still stand in a run world');
  assert.ok(cmd(sim, 'h1', {action: 'hall', hall: {spark: 1, seasoned: 2, reroll: 1, choice: 1, nonsense: 9, packmule: 99}}).ok);
  assert.ok(cmd(sim, 'h1', {action: 'kit', kit: 'woodcutter'}).ok);
  assert.ok(!cmd(sim, 'h1', {action: 'route', node: 'n00'}).ok, 'no route vote before setting out');
  assert.ok(cmd(sim, 'h1', {action: 'begin'}).ok);
  let s = sim.snapshot(), me = s.players[0];
  assert.equal(s.run.stage, 'route'); assert.equal(s.run.lives, RUN_TUNING.livesBase + 1, 'Spare Ember adds a life');
  assert.deepEqual(me.runBoons, ['ironhide']); assert.equal(me.tool, KITS.woodcutter.tool);
  assert.ok(me.resources.wood >= 12 + 4 * 2, 'kit pack and Packmule (clamped to level 2)');
  assert.ok(me.xp >= 60, 'Seasoned starts with experience'); assert.equal(me.maxHp, heroMaxHp({xp: me.xp, runBoons: me.runBoons}));
  assert.ok(!cmd(sim, 'h1', {action: 'kit', kit: 'prospector'}).ok, 'kits lock once the run sets out');
  let pushes = 0;
  while (!['won', 'returned', 'fallen'].includes(sim.snapshot().run.stage)) {
    s = sim.snapshot();
    if (s.run.stage === 'route') { const choices = routeChoices(s.run); assert.ok(cmd(sim, 'h1', {action: 'route', node: choices[choices.length - 1]}).ok); steps(sim, 2); continue; }
    if (s.run.stage === 'travel') { sim = clear(sim, 'h1'); continue; }
    if (s.run.stage === 'reward') {
      const offer = s.run.offers.h1; assert.equal(offer.length, 4, 'Wider Choice shows four cards'); assert.equal(new Set(offer).size, 4);
      if (s.run.rerolls.h1) { assert.ok(cmd(sim, 'h1', {action: 'reroll'}).ok); assert.ok(!cmd(sim, 'h1', {action: 'reroll'}).ok, 'one reroll per level'); }
      const pick = sim.snapshot().run.offers.h1[0];
      assert.ok(cmd(sim, 'h1', {action: 'boon', boon: pick}).ok); assert.ok(!cmd(sim, 'h1', {action: 'boon', boon: pick}).ok, 'one pick per destination');
      steps(sim, 2); continue;
    }
    if (s.run.stage === 'decide') { assert.ok(cmd(sim, 'h1', {action: 'decide', choice: 'push'}).ok); pushes++; steps(sim, 2); continue; }
    assert.fail(`unexpected stage ${s.run.stage}`);
  }
  s = sim.snapshot();
  assert.equal(s.run.stage, 'won'); assert.equal(pushes, RUN_TUNING.tiers - 1); assert.equal(s.run.result.tier, RUN_TUNING.tiers);
  assert.equal(s.run.result.banked, s.run.result.haul * RUN_TUNING.wonMult, 'winning banks the haul twice over');
  assert.ok(s.run.mult > 1.5, 'pushing on raised the multiplier');
  assert.ok(s.players[0].runBoons.length >= 1 + RUN_TUNING.tiers, 'an upgrade for every destination');
  assert.equal(s.enemies.filter(e => e.id.startsWith('rx')).length, 0, 'run foes leave with the run');
  assert.ok(!cmd(sim, 'h1', {action: 'route', node: 'heart'}).ok, 'a finished run takes no more commands');
}

// Returning banks the haul; shared lives run out into a fall that keeps a quarter.
{
  let sim = createSimulation({room: 'RUN2', seed: 41, run: {format: 'daily', seed: dailySeed('2026-10-16'), daily: '2026-10-16'}});
  sim.addPlayer({id: 'h1', name: 'Ana', role: 'hero'}); sim.addPlayer({id: 'h2', name: 'Bo', role: 'hero'}); sim.addPlayer({id: 'g1', name: 'Cy', role: 'god'});
  assert.ok(cmd(sim, 'g1', {action: 'begin'}).ok);
  let s = sim.snapshot(); assert.equal(s.run.lives, RUN_TUNING.livesBase + 1, 'one more life per extra Hero');
  assert.ok(s.players.filter(p => p.role === 'hero').every(p => p.runBoons?.length === 1), 'Heroes without a kit choice get a seeded kit');
  const first = routeChoices(s.run);
  cmd(sim, 'h1', {action: 'route', node: first[0]}); cmd(sim, 'h2', {action: 'route', node: first[1]}); cmd(sim, 'g1', {action: 'route', node: first[1]});
  steps(sim, 2); assert.equal(sim.snapshot().run.target, first[1], 'majority picks the destination');
  sim = clear(sim, 'h1'); s = sim.snapshot();
  assert.ok(s.run.offers.g1.every(id => ['god', 'any'].includes(BOONS[id].role)), 'Gods are offered God upgrades');
  steps(sim, RUN_TUNING.pick + 2); s = sim.snapshot();
  assert.equal(s.run.stage, 'decide', 'unpicked upgrades are chosen for you when time runs out');
  assert.ok(Object.values(s.run.picks).length === 3);
  const haul = s.run.haul; assert.ok(haul > 0);
  // A save mid-run restores exactly.
  const saved = JSON.parse(JSON.stringify(sim.checkpoint()));
  const back = loadSimulation(saved); assert.deepEqual(back.snapshot().run, s.run);
  assert.throws(() => restoreRun({...saved.run, stage: 'party'}));
  assert.throws(() => restoreRun({...saved.run, extra: 1}));
  cmd(sim, 'h1', {action: 'decide', choice: 'return'}); cmd(sim, 'h2', {action: 'decide', choice: 'push'}); cmd(sim, 'g1', {action: 'decide', choice: 'return'});
  steps(sim, 2); s = sim.snapshot();
  assert.equal(s.run.stage, 'returned'); assert.equal(s.run.result.banked, haul, 'returning banks the whole haul');

  // Fall: every death spends a shared life; one more after zero ends the run.
  let fall = loadSimulation(saved);
  cmd(fall, 'h1', {action: 'decide', choice: 'push'}); cmd(fall, 'h2', {action: 'decide', choice: 'push'}); steps(fall, 2);
  assert.equal(fall.snapshot().run.stage, 'decide', 'the vote waits for everyone (or the timer)');
  steps(fall, RUN_TUNING.decide);
  assert.equal(fall.snapshot().run.stage, 'route');
  const live = fall.adventureWorld(), lives = live.run.lives;
  const ctx = {createEnemy, terrainHeight, grantXp, heroMaxHp, makeBoss};
  for (let i = 0; i < lives; i++) { stepRun(live, [{kind: 'death', id: 'h1'}], ctx); assert.equal(live.run.lives, lives - 1 - i); }
  stepRun(live, [{kind: 'death', id: 'h2'}], ctx);
  assert.equal(live.run.stage, 'fallen'); assert.equal(live.run.result.banked, Math.floor(haul * RUN_TUNING.fallenKeep), 'a fall keeps a quarter of the haul');
  stepRun(live, [{kind: 'death', id: 'skeleton-not-a-player'}], ctx);
}

// Boons fold into the shared bonus system; Glass Heart is a trade-off.
assert.ok(Math.abs(itemBonus({runBoons: ['keen', 'fury']}, 'damage') - .45) < 1e-9);
assert.equal(heroMaxHp({xp: 0, runBoons: ['glass']}), 70);
assert.equal(itemBonus({runBoons: ['wellspring'], items: []}, 'mana'), .5);
// The Underways destination with a dungeon module present (ctx.underways mirrors shared/underways/rules.js:
// openUnderway, enterUnderway, an in-dungeon test). Clear the mouth, go down, win the hoard, come back up.
{
  const camp0 = arenaCamp(), route = buildRoute(4242, camp0, ground), uwNode = route.find(n => n.kind === 'underways') || route.find(n => n.tier === 1);
  const state = {tick: 0, players: [{id: 'h1', name: 'Mitch', role: 'hero', hp: 100, mana: 0, xp: 0, position: [uwNode.x, 0, uwNode.z], resources: {}, runBoons: []}], enemies: [], deposits: []};
  state.run = {...(await import('../shared/expedition-run.js')).createRun({seed: 4242, camp: camp0, sites: ground}), stage: 'travel', target: uwNode.id};
  state.run.nodes.find(n => n.id === uwNode.id).kind = 'underways';
  const opened = [], entered = [];
  const underways = {
    open(st, o) { const r = {id: `uw${opened.length + 1}`, tag: o.tag, style: o.style, depth: o.depth, back: o.back, cleared: false}; (st.underways ||= {runs: []}).runs.push(r); opened.push(o); return r; },
    enter(st, p, r, ev) { p.position = [9100, 0, 9100]; entered.push(p.id); ev.push({kind: 'underway_enter', id: p.id, run: r.id}); },
    inside: p => p.position[0] >= 9000,
  };
  const ctx = {createEnemy, terrainHeight: () => 0, grantXp, heroMaxHp, makeBoss, underways};
  const tick = (events = []) => { state.tick++; return stepRun(state, events, ctx).events; };
  tick(); assert.equal(state.run.stage, 'fight', 'arriving at the mouth starts the guard fight');
  assert.ok(state.run.foes.length > 0, 'guardians wait at the mouth');
  state.enemies = []; tick();
  assert.equal(opened.length, 1, 'a cleared mouth opens a dungeon');
  assert.equal(opened[0].tag, `xr:${uwNode.id}`); assert.ok(['mine', 'crypt', 'keep'].includes(opened[0].style) && opened[0].depth >= 1);
  assert.deepEqual(entered, ['h1'], 'the party goes down'); assert.equal(state.run.delve, 'uw1');
  for (let i = 0; i < 30; i++) tick(); assert.equal(state.run.stage, 'fight', 'the destination waits on the delve');
  // Abandoned delve: the dungeon closes; walking back to the mouth opens a fresh one.
  state.underways.runs = []; state.players[0].position = [uwNode.x, 0, uwNode.z]; tick();
  assert.equal(opened.length, 2, 'returning to the mouth reopens the Underways'); assert.equal(state.run.delve, 'uw2');
  const restored = restoreRun(JSON.parse(JSON.stringify(state.run))); assert.equal(restored.delve, 'uw2', 'an open delve survives a save');
  tick([{kind: 'underway_hoard', run: 'uw2', tag: `xr:${uwNode.id}`, drops: [], granted: []}]);
  assert.equal(state.run.objective.have, 1, 'the guardian’s hoard wins the delve');
  tick(); assert.equal(state.run.stage, 'fight', 'still below: wait for the way out');
  state.players[0].position = [uwNode.x, 0, uwNode.z + 3]; tick();
  assert.equal(state.run.stage, 'reward', 'back on the surface the Underways count as cleared');
  // No dungeon module (or every slot busy): the mouth fight alone clears it.
  const legacy = {...ctx, underways: undefined}; delete legacy.underways;
  const st2 = {tick: 0, players: [{...state.players[0], position: [uwNode.x, 0, uwNode.z]}], enemies: [], deposits: []};
  st2.run = {...restoreRun(JSON.parse(JSON.stringify({...state.run, stage: 'travel', target: uwNode.id, at: '', path: [], delve: '', objective: {have: 0, need: 0}, foes: []})))};
  stepRun(st2, [], legacy); st2.enemies = []; stepRun(st2, [], legacy); assert.equal(st2.run.stage, 'reward');
  const { delve, ...old } = st2.run; assert.equal(restoreRun(old).delve, '', 'runs saved before delves still load');
}
console.log('expedition run: ok');
