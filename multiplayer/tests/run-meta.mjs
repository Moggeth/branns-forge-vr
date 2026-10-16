// Expedition Roguelite persistence (client/run-meta.js) and the run strip model (client/run-panel.js):
// Embers bank once per finished run, Hall unlocks cost and cap correctly, junk storage is tolerated.
import assert from 'node:assert/strict';
import {loadRunMeta, saveRunMeta, buyHall, hallCost, creditRun, runKey} from '../client/run-meta.js';
import {runStripModel} from '../client/run-panel.js';
import {createSimulation} from '../shared/simulation.js';
import {HALL} from '../shared/run-boons.js';

const mem = (v = null) => ({v, get() { return this.v; }, set(x) { this.v = x; return true; }});
assert.equal(loadRunMeta(mem('not json')).embers, 0, 'junk storage starts fresh');
assert.deepEqual(loadRunMeta(mem(JSON.stringify({embers: 50, hall: {spark: 9, bogus: 1}}))).hall, {spark: HALL.spark.max}, 'unknown unlocks dropped, levels capped');
const store = mem(), meta = loadRunMeta(store);
const run = {format: 'daily', seed: 7, daily: '2026-10-16', boss: 'colossus', result: {outcome: 'won', banked: 240, haul: 120, kills: 30, deaths: 1, time: 900, path: ['skirmish', 'elite', 'hold', 'heart'], tier: 4}};
const r1 = creditRun(meta, run, {boons: ['keen']});
assert.ok(r1.credited && r1.newBest && r1.dailyBest); assert.equal(meta.embers, 240);
assert.equal(creditRun(meta, run).credited, false, 'the same run never pays twice');
assert.equal(creditRun(meta, run, {key: runKey(run, 'other-room')}).credited, true, 'another room is another run');
assert.ok(meta.codex.bosses.includes('colossus') && meta.codex.kinds.includes('heart') && meta.codex.boons.includes('keen'));
assert.equal(hallCost(meta, 'spark'), HALL.spark.costs[0]);
assert.ok(buyHall(meta, 'spark').ok); assert.ok(buyHall(meta, 'spark').ok); assert.equal(buyHall(meta, 'spark').code, 'maxed');
assert.equal(buyHall({embers: 1, hall: {}}, 'choice').code, 'too_poor');
saveRunMeta(meta, store); assert.equal(loadRunMeta(store).hall.spark, 2, 'unlocks persist');

const sim = createSimulation({room: 'R', seed: 41, run: {format: 'expedition', seed: 5}});
sim.addPlayer({id: 'a', name: 'A', role: 'hero'});
const m = runStripModel(sim.snapshot().run, 'a');
assert.equal(m.stage, 'camp'); assert.equal(m.lives, 3); assert.equal(m.seed, 5); assert.equal(m.ended, false);
assert.equal(runStripModel(null), null);
console.log('run meta: ok');
