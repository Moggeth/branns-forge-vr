// Expedition runs on a generated world: sites come from world.findSites (+ real Underways entrances), deterministic.
import assert from 'node:assert/strict';
import {runSitesFromWorld, runSeedFor, EXPEDITION_MODE, RUN_WORLD} from '../shared/expedition-world.js';
import {worldMode} from '../shared/world-modes.js';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {worldDescriptor} from '../shared/worldgen/registry.js';
import {createRun, restoreRun} from '../shared/expedition-run.js';

// A stand-in world: findSites scatters seeded points in the requested ring, like worldgen's findSites.
const fakeWorld = {
  spawn: {x: 3, z: -4}, extent: 1024,
  entrances: [{id: 'ent-a', x: 150, z: 20}, {id: 'ent-b', x: -40, z: 210}, {id: 'ent-far', x: 900, z: 900}],
  findSites({count, salt, near}) {
    let h = runSeedFor(salt); const out = [];
    for (let i = 0; i < count; i++) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; const a = (h % 6283) / 1000, d = near.min + (h % 9973) / 9973 * (near.max - near.min); out.push({id: `site-${i}`, x: Math.cos(a) * d, z: Math.sin(a) * d}); }
    return out;
  },
};
const a = runSitesFromWorld(fakeWorld, 31337), b = runSitesFromWorld(fakeWorld, 31337);
assert.deepEqual(a, b, 'same world + seed gives the same sites');
assert.deepEqual(a.camp, [0, 0]);
assert.equal(a.sites.filter(s => s.kind === 'underways').length, 2, 'in-range entrances become Underways sites');
assert.ok(!a.sites.some(s => s.id === 'xr_ent-far'), 'far entrances are skipped');
assert.ok(a.sites.every(s => s.id.startsWith('xr_')), 'site ids are prefixed');
assert.equal(a.bound, 1024, 'bound follows the world (walk bounds or extent)');
const run = createRun({seed: 31337, ...a});
assert.equal(run.nodes.length, 10);
assert.deepEqual(restoreRun(JSON.parse(JSON.stringify(run))), run, 'world runs round-trip through restore');

// The registered mode only builds the run; the core simulation steps, saves and snapshots it.
assert.equal(worldMode('expedition').newState, EXPEDITION_MODE.newState);
assert.equal(EXPEDITION_MODE.step, undefined, 'no second director step');
const state = {world: {seed: 'mossy-heron-417'}};
EXPEDITION_MODE.newState(state, fakeWorld);
assert.equal(state.run.seed, runSeedFor('mossy-heron-417'));
const st2 = {world: {seed: 'x'}}; EXPEDITION_MODE.newState(st2, fakeWorld, {seed: 31337, format: 'daily', daily: '2026-10-17'});
assert.equal(st2.run.seed, 31337); assert.equal(st2.run.format, 'daily');

// The real thing: a generated expedition world with a run, stepped, saved and reloaded.
const descriptor = worldDescriptor({kind: 'expedition', seed: 'mossy-heron-417', preset: 'continent', size: 2048});
const sim = createSimulation({room: 'XR', seed: 5, world: descriptor, run: {seed: 31337}});
sim.addPlayer({id: 'p1', name: 'Mitch', role: 'hero'});
for (let i = 0; i < 120; i++) sim.step();
const snap = sim.snapshot();
assert.ok(snap.run && snap.world, 'snapshot carries the run and the world');
assert.equal(snap.run.seed, 31337);
assert.ok(snap.run.nodes.every(n => Math.hypot(n.x, n.z) <= RUN_WORLD.far + 1), 'destinations within the run ring');
const again = createSimulation({room: 'XR', seed: 5, world: descriptor, run: {seed: 31337}}).snapshot().run;
assert.deepEqual(again.nodes, snap.run.nodes, 'same world + seed = same route');
const loaded = loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
assert.deepEqual(loaded.snapshot().run, snap.run, 'world runs survive save and reload');

// A full solo run to victory across the generated world: foes, shards and the colossus spawn on its terrain.
{
  let run = loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint()))), seq = 1;
  const cmd = m => run.command('p1', {...m, type: 'run', seq: seq++});
  const steps = n => { for (let i = 0; i < n; i++) run.step(); };
  const edit = fn => { const st = run.checkpoint(); fn(st); run = loadSimulation(st); };
  const teleport = (x, z) => edit(st => { const p = st.players[0]; p.position = [x, p.position[1], z]; });
  assert.ok(cmd({action: 'kit', kit: 'skirmisher'}).ok); assert.ok(cmd({action: 'begin'}).ok);
  let spawned = 0;
  for (let guard = 0; guard < 400 && !['won', 'returned', 'fallen'].includes(run.snapshot().run.stage); guard++) {
    const s = run.snapshot(), r = s.run;
    if (r.stage === 'route') { assert.ok(cmd({action: 'route', node: r.at ? r.nodes.find(n => n.id === r.at).next[0] : r.nodes[0].id}).ok); steps(2); continue; }
    if (r.stage === 'reward') { assert.ok(cmd({action: 'boon', boon: r.offers.p1[0]}).ok); steps(2); continue; }
    if (r.stage === 'decide') { assert.ok(cmd({action: 'decide', choice: 'push'}).ok); steps(2); continue; }
    const n = r.nodes.find(q => q.id === r.target);
    if (r.stage === 'travel') { teleport(n.x, n.z); steps(3); continue; }
    // fight
    for (const f of s.enemies.filter(e => r.foes.some(q => q.id === e.id))) {
      spawned++;
      assert.ok(f.position.every(Number.isFinite));
      assert.ok(Math.hypot(f.position[0] - n.x, f.position[2] - n.z) < 30, 'foes gather at their destination');
    }
    edit(st => { const ids = new Set(st.run.foes.map(f => f.id)); st.enemies = st.enemies.filter(e => !ids.has(e.id)); for (const d of st.deposits) if (st.run.shards.includes(d.id)) { d.depleted = true; d.hits = d.maxHits; } });
    teleport(n.x, n.z); steps(n.kind === 'hold' ? 400 : 5);
  }
  const end = run.snapshot().run;
  assert.equal(end.stage, 'won', 'the world run reaches the Heart and wins');
  assert.ok(spawned > 5, 'encounters spawned on the generated terrain');
  const heart = end.nodes.find(n => n.kind === 'heart'); assert.ok(Math.hypot(heart.x, heart.z) > 150, 'the Heart sits far out in the world');
}
// The next run: a fresh world of the same preset, or the very same world and route.
{
  const {nextRunOptions, runWorldFor} = await import('../client/run-panel.js');
  const menu = worldDescriptor({kind: 'expedition', seed: 'amber-otter-212', preset: 'highlands', size: 2048});
  assert.equal(runWorldFor({format: 'expedition', seed: 9}, menu), menu, 'a run plays on the world picked in the menu');
  assert.deepEqual(runWorldFor({format: 'daily', seed: 77}, menu), runWorldFor({format: 'daily', seed: 77}, worldDescriptor({kind: 'expedition', seed: 'other-seed-1', preset: 'archipelago', size: 2048})), 'the daily world is the same for everyone');
  assert.equal(runWorldFor({format: 'daily', seed: 77}, null), null);
  const s = sim.snapshot(), fresh = nextRunOptions(s, {seed: 4242}), same = nextRunOptions(s, {same: true});
  assert.equal(fresh.seed, 4242); assert.equal(fresh.world.preset, 'continent'); assert.notEqual(fresh.world.seed, s.world.seed);
  assert.deepEqual(same.world, s.world); assert.equal(same.seed, 31337);
  assert.deepEqual(nextRunOptions({run: s.run}, {seed: 7}), {format: 'expedition', seed: 7}, 'arena runs stay on the arena');
  const next = createSimulation({room: 'XR', seed: 41, run: (({world, ...o}) => o)(fresh), world: fresh.world}).snapshot();
  assert.equal(next.world.seed, fresh.world.seed); assert.equal(next.run.seed, 4242);
}
console.log('expedition-world: ok');
