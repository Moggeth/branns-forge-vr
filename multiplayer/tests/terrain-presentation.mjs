// node multiplayer/tests/terrain-presentation.test.mjs  [--update-golden]
// Deterministic deformation-field regression, bounded-job/budget checks, v1 mask parity, shader patch + disposal.
import assert from 'node:assert/strict'; import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {createDeformationField, editTexelRect} from '../client/terrain-deformation-field.js';
import * as V2 from '../client/orchard-presentation.js';
import {FIXTURE_EDITS, fixtureHeight} from './fixtures/terrain-data.js';
const HERE = path.dirname(fileURLToPath(import.meta.url)), GOLDEN = path.join(HERE, 'terrain-field.golden.json');
const results = []; const test = async (name, fn) => { const t = performance.now(); try { await fn(); results.push([name, 'ok', +(performance.now() - t).toFixed(1)]); } catch (e) { results.push([name, 'FAIL', e.message]); } };
const base = (x, z) => fixtureHeight(x, z, []);
const makeField = (edits, size = 384) => { const f = createDeformationField({size, half: 60, height: (x, z) => fixtureHeight(x, z, edits), baseHeight: base}); f.setEdits(edits); return f; };

await test('field is deterministic and matches golden checksum', () => {
  const a = makeField(FIXTURE_EDITS), b = makeField(FIXTURE_EDITS); a.flush(); b.flush();
  const ha = crypto.createHash('sha256').update(Buffer.from(a.data.buffer)).digest('hex'), hb = crypto.createHash('sha256').update(Buffer.from(b.data.buffer)).digest('hex');
  assert.equal(ha, hb);
  if (process.argv.includes('--update-golden')) fs.writeFileSync(GOLDEN, JSON.stringify({sha256: ha, size: 384, edits: FIXTURE_EDITS.length}, null, 1));
  assert.equal(ha, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).sha256, 'deformation field changed; rerun with --update-golden only if intended');
});
await test('field values follow authoritative height (sunder depth, raise peak, ejecta ring, untouched far field)', () => {
  const f = makeField(FIXTURE_EDITS); f.flush();
  const s = FIXTURE_EDITS.find(e => e.kind === 'sunder'), at = f.sample(s.x, s.z), exact = fixtureHeight(s.x, s.z, FIXTURE_EDITS) - base(s.x, s.z);
  assert.ok(Math.abs(at.d - exact) < .06, `sunder d ${at.d} vs ${exact}`); assert.ok(at.d < -1.3);
  assert.ok(Math.abs(at.base - base(s.x, s.z)) < .01);
  const r = FIXTURE_EDITS.find(e => e.kind === 'raise'); assert.ok(Math.abs(f.sample(r.x + 2, r.z).peak - 2) < .02);
  const l = FIXTURE_EDITS.find(e => e.kind === 'lower'); assert.ok(f.sample(l.x + l.radius * 1.12, l.z).ejecta > .4, 'ejecta ring outside lower');
  const far = f.sample(40, 40); assert.deepEqual([far.d, far.peak, far.ejecta], [0, 0, 0]);
});
await test('setEdits only queues; each new edit touches only its own rect', () => {
  let calls = 0; const edits = [FIXTURE_EDITS[0]];
  const f = createDeformationField({size: 384, half: 60, height: (x, z) => (calls++, fixtureHeight(x, z, edits)), baseHeight: base});
  f.setEdits(edits); assert.equal(calls, 0); f.flush();
  const r = editTexelRect(edits[0], 384, 60); assert.equal(f.texelsDone, (r[2] - r[0] + 1) * (r[3] - r[1] + 1));
  const before = f.texelsDone; edits.push(FIXTURE_EDITS[1]); f.setEdits(edits); f.flush();
  const r2 = editTexelRect(edits[1], 384, 60); assert.equal(f.texelsDone - before, (r2[2] - r2[0] + 1) * (r2[3] - r2[1] + 1));
});
await test('removing an edit restores undeformed texels', () => {
  const edits = FIXTURE_EDITS.slice(0, 2), f = createDeformationField({size: 192, half: 60, height: (x, z) => fixtureHeight(x, z, edits), baseHeight: base});
  f.setEdits(edits); f.flush(); edits.splice(1, 1); f.setEdits(edits); f.flush();
  const l = FIXTURE_EDITS[1]; assert.equal(f.sample(l.x, l.z).d, 0); assert.ok(f.sample(FIXTURE_EDITS[0].x, FIXTURE_EDITS[0].z).d > 1.9);
});
await test('time-budgeted step stays near budget for a 64-edit worst case', () => {
  const many = Array.from({length: 64}, (_, i) => ({id: 'm' + i, x: -40 + (i % 8) * 11, z: -40 + Math.floor(i / 8) * 11, radius: 6, height: i % 2 ? 2 : -2}));
  const f = makeField(many), times = [];
  while (f.pending) { const t = performance.now(); f.step(1.5); times.push(performance.now() - t); }
  // p99 rather than max: one GC pause or scheduler stall on a shared CI runner is not a budget overrun.
  times.sort((a, b) => a - b); const p99 = times[Math.floor(times.length * 0.99)], max = times.at(-1);
  assert.ok(p99 < 3.0, `p99 step ${p99.toFixed(2)} ms (max ${max.toFixed(2)} ms)`); results.push(['  64-edit drain', `${times.length} steps`, `p99 ${p99.toFixed(2)} ms, max ${max.toFixed(2)} ms, total ${f.cpuMs.toFixed(1)} ms`]);
});
await test('v1 surface mask/classification unchanged (frozen shipped checksums)', () => {
  const V1 = JSON.parse(fs.readFileSync(path.join(HERE,'fixtures/terrain-surface-v1.json'),'utf8'));
  const hash = a => crypto.createHash('sha256').update(a).digest('hex');
  // The checksums freeze the hand-placed orchard; the keep roads (KEEP_PATHS, 2026-10-09) were added on top of it.
  const L=V2.ORCHARD_LAYOUT,ctx={edits:FIXTURE_EDITS,layout:{...L,paths:L.paths.slice(0,L.paths.length-V2.KEEP_PATHS.length)}};
  assert.equal(hash(V2.bakeSurfaceMask(ctx,96)),V1.mask);
  const a=new Uint8Array(96*96*4);V2.bakeDisturbedChannel(FIXTURE_EDITS,96,60,a);assert.equal(hash(a),V1.disturbed);
  assert.deepEqual(V2.classifySurface(-5,-8,(x,z)=>fixtureHeight(x,z,FIXTURE_EDITS),ctx),V1.classification);
  for(const k of V1.exports)assert.ok(k in V2,`named export ${k} preserved`);
});
await test('shader patch applies to three 0.186 standard chunks for every quality/strata level', () => {
  for (const quality of ['high', 'medium', 'low']) for (const strata of [0, 1, 2]) {
    const report = {}, m = V2.createOrchardGroundMaterial({quality, report, strata}), sh = {vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}};
    m.onBeforeCompile(sh); assert.equal(report.patched, true, `${quality}/${strata} missing ${report.missing}`);
    assert.ok(sh.fragmentShader.includes(`#define ORCHARD_STRATA ${strata}`)); assert.ok('orchardDeform' in sh.uniforms && 'orchardFeatures' in sh.uniforms);
    assert.ok(m.customProgramCacheKey().endsWith(`-s${strata}`)); m.dispose();
  }
});
function rig(extra = {}) {
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), geo = new THREE.PlaneGeometry(120, 120, 8, 8), oldMat = new THREE.MeshStandardMaterial(), ground = new THREE.Mesh(geo, oldMat);
  scene.add(sun, ground); const h = (x, z) => fixtureHeight(x, z, FIXTURE_EDITS);
  const o = V2.createOrchardPresentation({scene, ground, sun, height: h, baseHeight: base, edits: FIXTURE_EDITS, loadTextures: false, ...extra}); return {scene, ground, oldMat, o};
}
await test('presentation drains deformation under budget via update(), then disposes every owned texture', () => {
  const {scene, ground, oldMat, o} = rig(); const textures = new Set();
  for (const u of Object.values(o.material.userData.orchardUniforms)) if (u.value?.isTexture) textures.add(u.value);
  let frames = 0, max = 0; while (o.stats().deformation.pending && frames < 500) { const t = performance.now(); o.update(1 / 60, null); max = Math.max(max, performance.now() - t); frames++; }
  const st = o.stats().deformation; assert.equal(st.enabled, true); assert.equal(st.pending, false); assert.ok(st.uploads >= 1);
  results.push(['  update() drain', `${frames} frames`, `max ${max.toFixed(2)} ms/frame (mask+deform)`]);
  const disposed = new Set(); for (const t of textures) t.addEventListener('dispose', () => disposed.add(t));
  const before = scene.children.length; o.dispose(); assert.equal(disposed.size, textures.size, `${disposed.size}/${textures.size} textures disposed`);
  assert.equal(ground.material, oldMat); assert.ok(scene.children.length < before); o.dispose(); // idempotent
});
await test('feature toggles and fallbacks: no baseHeight / deformation:false keep v1 shading path (strata 0)', () => {
  const a = rig({baseHeight: null}); assert.equal(a.o.stats().deformation.reason, 'no baseHeight'); assert.equal(a.o.material.userData.orchardStrata, 0); a.o.dispose();
  const b = rig({deformation: false}); assert.equal(b.o.stats().deformation.reason, 'disabled'); b.o.dispose();
  const c = rig({quality: 'low'}); assert.equal(c.o.material.userData.orchardStrata, 1); assert.equal(c.o.stats().deformation.size, 192);
  c.o.setFeatures({wet: 0, ejecta: 0}); assert.deepEqual(c.o.material.userData.orchardUniforms.orchardFeatures.value.toArray(), [1, 0, 0, 1]); c.o.dispose();
});
for (const r of results) console.log(r.join('  |  '));
const failed = results.filter(r => r[1] === 'FAIL').length; console.log(failed ? `${failed} FAILED` : 'all terrain presentation tests passed'); process.exit(failed ? 1 : 0);
