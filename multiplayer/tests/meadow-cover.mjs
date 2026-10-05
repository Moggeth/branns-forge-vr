// Pure Node checks for client/meadow-cover.js (no WebGL): determinism, clearances, budgets, terrain/structure response,
// shader anchors against the installed three and disposal. Run: node multiplayer/tests/meadow-cover.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ShaderLib} from 'three';
import {createMeadowCover, bakeCellStatic, meadowWear, MEADOW_QUALITY, FILL_BUDGET_MS} from '../client/meadow-cover.js';
import {disturbanceAt} from '../client/orchard-presentation.js';
import {STARTING_PATHS} from '../shared/starting-world.js';

const results = []; let failed = 0;
const test = (name, fn) => { const t0 = performance.now(); try { const note = fn(); results.push(`ok   ${name}${note ? '  ' + note : ''}  (${(performance.now() - t0).toFixed(1)} ms)`); } catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.stack}`); } };
const height = (x, z, edits = []) => { let h = .45 * Math.sin(x * .09) * Math.cos(z * .07); for (const e of edits) { const t = Math.min(1, Math.max(0, 1 - Math.hypot(x - e.x, z - e.z) / e.radius)); h += e.height * t * t * (3 - 2 * t); } return h; };
const camAt = (x, y, z, tx = 0, tz = 0) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, y, z); c.lookAt(tx, 0, tz); c.updateMatrixWorld(); return c; };
function settle(m, cam, opts) { for (let i = 0; i < 400; i++) { m.update(1 / 60, cam, opts); if (!m.stats().pending) return i + 1; } throw Error('meadow never settled'); }
const instances = (m, kind = 'grass') => { const g = m.objects[kind].geometry, a = g.attributes.aMeadowPos.array; return Array.from({length: g.instanceCount}, (_, i) => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]]); };

test('static candidates are deterministic and keep paths, plaza and landmark ribbons clear', () => {
  let grass = 0, flowers = 0, daisies = 0;
  for (let cj = 0; cj < 11; cj++) for (let ci = 0; ci < 11; ci++) {
    const a = bakeCellStatic(ci, cj, MEADOW_QUALITY.high, true), b = bakeCellStatic(ci, cj, MEADOW_QUALITY.high, true);
    assert.deepEqual(a.grass, b.grass); assert.deepEqual(a.flowers, b.flowers); assert.deepEqual(a.daisies, b.daisies);
    for (let s = 0; s < a.daisies.length; s += 5) { const x = a.daisies[s], z = a.daisies[s + 1]; daisies++; assert.ok(Math.hypot(x, z) >= 4.4 && meadowWear(x, z) <= .6, 'daisies stay off the plaza and worn paths'); }
    for (let s = 0; s < a.grass.length; s += 7) {
      const x = a.grass[s], z = a.grass[s + 1]; grass++;
      assert.ok(Math.hypot(x, z) >= 4.4, 'forge plaza bare');
      assert.ok(meadowWear(x, z) <= .6, 'no tufts on worn paths');
      for (const p of STARTING_PATHS) for (let i = 1; i < p.points.length; i++) { const [[ax, az], [bx, bz]] = [p.points[i - 1], p.points[i]], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); assert.ok(Math.hypot(x - ax - dx * t, z - az - dz * t) > p.width / 2, 'landmark path clear'); }
    }
    flowers += a.flowers.length / 5;
  }
  assert.ok(grass > 20000 && flowers > 1500 && daisies > 100, `meadow populated (${grass} tufts, ${flowers} flowers, ${daisies} daisy clumps)`);
  return `${grass} tufts, ${flowers} flowers, ${daisies} daisy clumps`;
});

test('bounded instances, four draws, nearest-first budgeted fill that converges', () => {
  const scene = new THREE.Scene(), m = createMeadowCover({scene, height});
  const cam = camAt(0, 1.65, 8, 0, 0); const frames = settle(m, cam), s = m.stats();
  assert.equal(s.drawCalls, 4); assert.ok(s.grass > 3000 && s.grass <= MEADOW_QUALITY.high.grass); assert.ok(s.flowers <= MEADOW_QUALITY.high.flowers); assert.ok(s.daisies > 0 && s.daisies <= MEADOW_QUALITY.high.daisies, `daisies ${s.daisies}`);
  for (const [x, , z] of instances(m)) assert.ok(Math.hypot(x, z - 8) <= MEADOW_QUALITY.high.radius + 3.01, 'inside fill radius');
  const low = createMeadowCover({scene: new THREE.Scene(), height, quality: 'low'}); settle(low, cam);
  assert.ok(low.stats().grass <= MEADOW_QUALITY.low.grass && low.stats().triangles < s.triangles / 2.5, 'phone tier far lighter');
  // Walking 2.5 m triggers one refill whose cell baking stays in budget once neighbours are cached.
  const fills = s.fills; m.update(1 / 60, camAt(2.5, 1.65, 8)); const t = m.stats();
  assert.equal(t.fills, fills + 1); assert.ok(t.lastFillMs < FILL_BUDGET_MS + 6, `refill ${t.lastFillMs} ms`);
  return `${frames} frames to settle, ${s.daisies} daisy clumps, ${s.grass} tufts / ${s.triangles} tris high, ${low.stats().triangles} tris low, refill ${t.lastFillMs} ms`;
});

test('RTS view centres grass on the view target; headset tier lowers the cap', () => {
  const m = createMeadowCover({scene: new THREE.Scene(), height});
  settle(m, camAt(0, 38, 30, 0, 0));
  const xs = instances(m), cx = xs.reduce((a, p) => a + p[0], 0) / xs.length, cz = xs.reduce((a, p) => a + p[2], 0) / xs.length;
  assert.ok(Math.hypot(cx, cz) < 6, `centred near the target (${cx.toFixed(1)}, ${cz.toFixed(1)})`);
  const renderer = {xr: {isPresenting: true}, getPixelRatio: () => 1, domElement: {height: 720}};
  const xr = createMeadowCover({scene: new THREE.Scene(), height, renderer}); settle(xr, camAt(0, 1.65, 8));
  assert.ok(xr.stats().xr && xr.stats().grass <= MEADOW_QUALITY.xr.grass);
});

test('fresh craters clear grass and re-height only touched cells; structures and deposits push it aside', () => {
  let edits = [];
  const m = createMeadowCover({scene: new THREE.Scene(), height: (x, z) => height(x, z, edits)});
  const cam = camAt(0, 1.65, 14); settle(m, cam);
  const crater = {id: 'c1', kind: 'lower', x: 6, z: 14, radius: 3, height: -1.5};
  edits = [crater]; const before = m.stats().rebuiltCells;
  m.terrainChanged({edits, dirty: [crater]}); settle(m, cam);
  const touched = m.stats().rebuiltCells - before;
  assert.ok(touched > 0 && touched <= 4, `only cells under the kernel rebuilt (${touched})`);
  for (const [x, y, z] of instances(m)) {
    assert.ok(disturbanceAt(x, z, edits) <= .3, 'no tufts on fresh earth');
    assert.ok(Math.abs(y + .02 - height(x, z, edits)) < 1e-4, 'rooted on the edited surface');
  }
  m.sync({inventions: {structures: [{type: 'storehouse', hp: 10, position: [-6, 0, 14]}, {type: 'foundation', hp: 10, position: [0, 0, 20]}]}, deposits: [{x: 4, z: 9}]}); settle(m, cam);
  for (const [x, , z] of instances(m)) {
    assert.ok(Math.hypot(x + 6, z - 14) > 1.5, 'clear of the storehouse');
    assert.ok(Math.max(Math.abs(x), Math.abs(z - 20)) > 3, 'clear of the foundation slab');
    assert.ok(Math.hypot(x - 4, z - 9) > 1, 'clear of the boulder');
  }
});

test('shader anchors exist in the installed three; materials and dispose are clean', () => {
  for (const a of ['#include <common>', '#include <begin_vertex>']) assert.ok(ShaderLib.standard.vertexShader.includes(a), a);
  for (const a of ['#include <common>', '#include <color_fragment>', '#include <normal_fragment_begin>', '#include <emissivemap_fragment>', '#include <lights_fragment_end>']) assert.ok(ShaderLib.physical.fragmentShader.includes(a), a);
  const scene = new THREE.Scene(), m = createMeadowCover({scene, height});
  for (const [o, name] of [[m.objects.grass, 'grass'], [m.objects.flowers, 'flowers']]) {
    const shader = {uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader};
    o.material.onBeforeCompile(shader);
    assert.ok(shader.vertexShader.includes('aMeadowPos') && shader.fragmentShader.includes('vMeadowTint'), `${name} patched`);
    assert.ok(!/\bflat\b/.test(shader.vertexShader.replace(/flatShading|FLAT_SHADED/g, '')), 'no GLSL-reserved identifiers');
    assert.equal(o.raycast(), undefined, 'never a raycast target');
  }
  assert.equal(scene.children.length, 4); m.dispose(); assert.equal(scene.children.length, 0);
});

console.log(results.join('\n'));
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
if (failed) process.exitCode = 1;
