// Seeded world generation: reproducible, engine-independent, hydrologically coherent.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {generateWorld, BIOME} from '../shared/worldgen/generate.js';
import {PRESET_IDS} from '../shared/worldgen/presets.js';
import {restoreWorldDescriptor, worldDescriptor} from '../shared/worldgen/registry.js';
import {hashText} from '../client/state-codec.js';

// 1. Only exactly-rounded arithmetic: transcendental Math functions differ between JS engines.
const dir = new URL('../shared/worldgen/', import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'map-image.js')) {
  const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|asin|acos|atan2?|pow|exp|expm1|log\w*|hypot|cbrt|random)\b/, `${f} uses an engine-dependent Math function`);
}
const fingerprint = w => hashText(JSON.stringify({
  e: Array.from(w.grids.elev, v => Math.round(v * 1000)), b: Array.from(w.grids.biome), rivers: w.rivers.map(r => [r.points.length, r.end, Math.round(r.length)]),
  lakes: w.lakes.map(l => [l.cells, Math.round(l.level * 1000)]), s: w.settlements.map(s => [s.id, Math.round(s.x), Math.round(s.z)]), u: w.entrances.map(e => [e.id, Math.round(e.x), Math.round(e.z), e.seed]),
  h: [0, 1, 2, 3, 4, 5, 6, 7].map(k => Math.round(w.heightAt(k * 137 - 500, 300 - k * 91) * 1e4)),
}));
const size = 2048;
for (const preset of PRESET_IDS) {
  const a = generateWorld({seed: 'ci-vale', preset, size}), b = generateWorld({seed: 'ci-vale', preset, size});
  assert.equal(fingerprint(a), fingerprint(b), `${preset}: same seed must give the same world`);
  // 2. Water runs downhill and ends somewhere real.
  for (const r of a.rivers) {
    for (let k = 1; k < r.points.length; k++) assert.ok(r.points[k].surface <= r.points[k - 1].surface + 1e-9, `${preset} ${r.name}: river flows uphill`);
    assert.ok(['sea', 'lake', 'river'].includes(r.end), `${preset} ${r.name}: river has no outlet (${r.end})`);
    if (r.end === 'sea') assert.ok(r.points.at(-1).surface <= .5, `${preset} ${r.name}: sea mouth above sea level`);
  }
  for (const l of a.lakes) assert.ok(l.level > 0 && l.depth >= 0, `${preset}: lake ${l.id} has an impossible level`);
  // 3. A start village on dry land, with caves to find and somewhere to go.
  const start = a.settlements.find(s => s.start);
  assert.ok(start && a.heightAt(start.x, start.z) > 1 && !a.isWater(start.x, start.z), `${preset}: start village is not on dry land`);
  assert.ok(a.entrances.length >= 2 && a.settlements.length >= 2, `${preset}: too empty (${a.entrances.length} caves, ${a.settlements.length} settlements)`);
  const land = Array.from(a.grids.biome).filter(v => v !== BIOME.OCEAN).length / a.grids.biome.length;
  assert.ok(land > .2 && land < .97, `${preset}: land fraction ${land.toFixed(2)}`);
}
assert.notEqual(fingerprint(generateWorld({seed: 'ci-vale', preset: 'continent', size})), fingerprint(generateWorld({seed: 'ci-dale', preset: 'continent', size})), 'different seeds must differ');
// 4. Descriptors: strict, normalised, and the only thing saves carry.
assert.deepEqual(worldDescriptor({seed: ' Mossy Heron 417 '}), {kind: 'wilds', seed: 'mossy-heron-417', preset: 'continent', size: 4096, gen: 1});
for (const bad of [{kind: 'wilds', seed: 'x', preset: 'continent', size: 4096, gen: 1, extra: 1}, {kind: 'moon', seed: 'x', preset: 'continent', size: 4096, gen: 1},
  {kind: 'wilds', seed: 'Bad Seed', preset: 'continent', size: 4096, gen: 1}, {kind: 'wilds', seed: 'x', preset: 'continent', size: 4000, gen: 1}, {kind: 'wilds', seed: 'x', preset: 'continent', size: 4096, gen: 99}])
  assert.throws(() => restoreWorldDescriptor(bad));
assert.equal(restoreWorldDescriptor(undefined), undefined);
console.log('PASS seeded worlds reproduce, use engine-exact maths, drain downhill to real outlets, and validate descriptors');
