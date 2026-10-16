// Expedition runs on a generated world: sites come from world.findSites (+ real Underways entrances), deterministic.
import assert from 'node:assert/strict';
import {runSitesFromWorld, runSeedFor, expeditionWorldMode, RUN_WORLD} from '../shared/expedition-world.js';
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
assert.deepEqual(a.camp, [3, -4]);
assert.equal(a.sites.filter(s => s.kind === 'underways').length, 2, 'in-range entrances become Underways sites');
assert.ok(!a.sites.some(s => s.id === 'xr_ent-far'), 'far entrances are skipped');
assert.ok(a.sites.every(s => s.id.startsWith('xr_')), 'site ids are prefixed');
assert.ok(a.bound <= RUN_WORLD.far + 80);
const run = createRun({seed: 31337, ...a});
assert.equal(run.nodes.length, 10);
assert.deepEqual(restoreRun(JSON.parse(JSON.stringify(run))), run, 'world runs round-trip through restore');

// Hooks: newState builds a run from the world, snapshot/restore carry it, actions route to the run.
const hooks = expeditionWorldMode({grantXp() {}, heroMaxHp: () => 100, makeBoss() {}}, () => fakeWorld);
const state = {world: {seed: 'mossy-heron-417'}, players: [], enemies: [], deposits: []};
hooks.newState(state, fakeWorld);
assert.equal(state.run.seed, runSeedFor('mossy-heron-417'));
const out = {}; hooks.snapshot(state, out); assert.equal(out.run, state.run);
const copy = {}; hooks.restore(JSON.parse(JSON.stringify(out)), copy); assert.deepEqual(copy.run, state.run);
assert.equal(hooks.action(state, {id: 'p1'}, {type: 'mode'}, {}), null, 'messages for other modes are not ours');
console.log('expedition-world: ok');
