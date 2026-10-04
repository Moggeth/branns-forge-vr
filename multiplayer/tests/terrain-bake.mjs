// Unlimited terrain: hundreds of God earthworks stay exact, bounded and fast once old ones are baked.
// Run: node tests/terrain-bake.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {terrainHeight, TERRAIN_BAKE, restoreTerrainBake} from '../shared/terrain.js';
import {encodeDelta, applyDelta} from '../client/state-codec.js';
import {quantizeWire} from '../client/wire-quantize.js';

let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const sim = createSimulation({seed: 4}); sim.addPlayer({id: 'g', role: 'god'});
const live = sim.adventureWorld(), all = new Map(); let seq = 0, maxLive = 0;
const remember = () => { for (const e of live.edits) if (!all.has(e.id)) all.set(e.id, structuredClone(e)); maxLive = Math.max(maxLive, live.edits.length); };
const spells = ['raise', 'lower', 'raise', 'wall', 'sunder'];
let deltaBytes = 0, keyBytes = 0;
for (let i = 0; i < 400; i++) {
  live.players[0].mana = 100;
  const spell = spells[i % spells.length], x = rand() * 80 - 40, z = rand() * 80 - 40, line = spell === 'wall' || spell === 'sunder';
  const a = rand() * Math.PI * 2, msg = {type: 'cast', seq: ++seq, spell, point: [x, 0, z], ...(line ? {start: [x, 0, z], end: [Math.max(-45, Math.min(45, x + Math.cos(a) * 9)), 0, Math.max(-45, Math.min(45, z + Math.sin(a) * 9))]} : {})};
  const sample = i % 10 === 9, before = sample && JSON.parse(JSON.stringify(quantizeWire(sim.snapshot())));
  const r = sim.command('g', msg); assert.equal(r.ok, true, `cast ${i} ${spell}: ${r.code}`);
  remember(); sim.step();
  // One 20 Hz frame across a cast (and any bake it triggered): only the changed tiles travel.
  if (sample) { const after = quantizeWire(sim.snapshot()); deltaBytes = Math.max(deltaBytes, JSON.stringify(encodeDelta(before, after) ?? null).length); keyBytes = Math.max(keyBytes, JSON.stringify(after).length); }
  for (let t = 0; t < 29; t++) sim.step();
}
for (let t = 0; t < 200; t++) sim.step();
const state = sim.checkpoint();
assert.ok(maxLive <= TERRAIN_BAKE.live, `live edit list stays bounded (${maxLive})`);
assert.ok(state.terrainBake?.rev > 5, 'old earthworks were baked');
assert.ok(all.size > 1000, `hundreds of casts made ${all.size} edits`);

// The baked ground matches replaying every edit ever made (ruptures long finished).
const reference = {edits: [...all.values()], tick: state.tick};
let worst = 0;
for (let i = 0; i < 3000; i++) { const x = rand() * 100 - 50, z = rand() * 100 - 50; worst = Math.max(worst, Math.abs(terrainHeight(state, x, z) - terrainHeight(reference, x, z))); }
assert.ok(worst < .003, `baked ground within 3 mm of the full replay (worst ${worst})`);

// Reading cost no longer grows with history.
const time = (s, n = 40000) => { const t = performance.now(); let acc = 0; for (let i = 0; i < n; i++) acc += terrainHeight(s, (i * 7.31) % 100 - 50, (i * 3.17) % 100 - 50); return [performance.now() - t, acc]; };
time(state); time(reference, 4000);
const [baked] = time(state), [replay] = time(reference);
assert.ok(baked < replay / 4, `baked reads (${baked.toFixed(1)} ms) far cheaper than replaying ${all.size} edits (${replay.toFixed(1)} ms)`);

// Saves restore exactly, and corrupt bakes are refused.
const restored = loadSimulation(JSON.parse(JSON.stringify(state)));
sim.step(); restored.step(); assert.deepEqual(restored.snapshot(), sim.snapshot());
const tile = Object.keys(state.terrainBake.earth)[0];
for (const bad of [{...state.terrainBake, rev: 0}, {...state.terrainBake, extra: 1}, {...state.terrainBake, earth: {'11,0': state.terrainBake.earth[tile]}}, {...state.terrainBake, earth: {[tile]: 'AAAA'}}, {...state.terrainBake, earth: {[tile]: btoa('\xff\x7f'.repeat(256))}}])
  assert.throws(() => restoreTerrainBake(bad), /Invalid baked/);
assert.throws(() => loadSimulation({...JSON.parse(JSON.stringify(state)), terrainBake: {rev: 1, earth: [], scar: {}}}));

// The 20 Hz stream sends only changed tiles; keyframes stay well under the codec limit.
assert.ok(keyBytes < 400_000, `keyframe ${keyBytes} bytes`);
assert.ok(deltaBytes < keyBytes / 2, `delta ${deltaBytes} bytes vs keyframe ${keyBytes}`);
const a = JSON.parse(JSON.stringify(quantizeWire(sim.snapshot())));
live.players[0].mana = 100; sim.command('g', {type: 'cast', seq: ++seq, spell: 'raise', point: [5, 0, 5]});
for (let t = 0; t < 2; t++) sim.step();
const b = JSON.parse(JSON.stringify(quantizeWire(sim.snapshot())));
assert.equal(JSON.stringify(applyDelta(a, JSON.parse(JSON.stringify(encodeDelta(a, b))))), JSON.stringify(b));
console.log(JSON.stringify({suite: 'terrain-bake', edits: all.size, live: maxLive, bakes: state.terrainBake.rev, tiles: Object.keys(state.terrainBake.earth).length, worstMm: +(worst * 1000).toFixed(3), bakedMs: +baked.toFixed(1), replayMs: +replay.toFixed(1), keyBytes, deltaBytes}));
