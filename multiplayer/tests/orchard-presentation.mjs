// Pure Node checks for client/orchard-presentation.js against the installed three (no WebGL here).
// Run: node tests/environment-budget.mjs   (THREE_ROOT=<dir containing node_modules/three> to override)
// Verifies shader-anchor patching against real ShaderLib, budgets, edit response, far-only backdrop,
// non-colliding helpers, shadow texel snapping and dispose restoration. Times are measured, not asserted fakes.
import {register} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const threeRoot = process.env.THREE_ROOT || path.resolve(here, '../node_modules/three');
const threeUrl = pathToFileURL(path.join(threeRoot, 'build/three.module.js')).href;
const addonsUrl = pathToFileURL(path.join(threeRoot, 'examples/jsm/')).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return {url: ${JSON.stringify(threeUrl)}, shortCircuit: true};
  if (spec.startsWith('three/addons/')) return {url: ${JSON.stringify(addonsUrl)} + spec.slice(13), shortCircuit: true};
  return next(spec, ctx);
}`));
const THREE = await import('three');
const O = await import(pathToFileURL(path.resolve(here, '../client/orchard-presentation.js')).href);
const M = await import('../client/mountain-ground-treatment.js');

const results = []; let failed = 0;
const test = (name, fn) => { const t0 = performance.now(); try { const note = fn(); results.push(`ok   ${name}${note ? '  ' + note : ''}  (${(performance.now() - t0).toFixed(1)} ms)`); } catch (e) { failed++; results.push(`FAIL ${name}: ${e.message}`); } };

function terrainHeight(x, z, edits = []) { // copy of reference/client/game.js terrainHeight
  let h = .45 * Math.sin(x * .09) * Math.cos(z * .07);
  for (const e of edits) { const t = Math.min(1, Math.max(0, 1 - Math.hypot(x - e.x, z - e.z) / Math.max(.01, e.radius))); h += e.height * t * t * (3 - 2 * t); }
  return h;
}
function fixture(opts = {}) {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xc6e0ed, 0x5e5139, 1.2); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3ad, 2.2); sun.position.set(-22, 38, 15); scene.add(sun);
  const geo = new THREE.PlaneGeometry(120, 120, 160, 160); geo.rotateX(-Math.PI / 2);
  const stock = new THREE.MeshStandardMaterial({color: 0x667b43});
  const ground = new THREE.Mesh(geo, stock); scene.add(ground);
  const renderer = {capabilities: {getMaxAnisotropy: () => 16}, shadowMap: {enabled: false, type: THREE.PCFShadowMap}, toneMappingExposure: 1};
  const state = {edits: []};
  const camera = new THREE.PerspectiveCamera(70, 1, .05, 180);
  const p = O.createOrchardPresentation({scene, renderer, ground, sun, height: (x, z) => terrainHeight(x, z, state.edits), camera, ...opts});
  return {scene, hemi, sun, ground, stock, renderer, state, camera, p};
}
const compile = material => { const sh = {vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {}}; material.onBeforeCompile(sh); return sh; };

test('shader anchors exist in installed three ShaderLib.physical', () => {
  for (const a of O.SHADER_ANCHORS.vertex) assert.ok(THREE.ShaderLib.physical.vertexShader.includes(a), a);
  for (const a of O.SHADER_ANCHORS.fragment) assert.ok(THREE.ShaderLib.physical.fragmentShader.includes(a), a);
  assert.ok(THREE.ShaderChunk.beginnormal_vertex.includes('vec3 objectNormal'), 'objectNormal declared');
  return `three ${THREE.REVISION}`;
});
for (const quality of ['high', 'low']) test(`patched ${quality} shader is structurally sound`, () => {
  const {p} = fixture({quality});
  M.applyMountainGroundTreatment(p.material);
  const sh = compile(p.material);
  assert.equal(p.material.userData.mountainTreatment.patched,true,'production ground treatment chains onto orchard');
  assert.equal(sh.uniforms.mtnDapple,M.MOUNTAIN_GROUND_LIGHT);
  M.setMountainGroundLight({time:7201,strength:2});
  assert.equal(sh.uniforms.mtnDapple.value.x,1);
  assert.equal(sh.uniforms.mtnDapple.value.y,1);
  M.setMountainGroundLight({strength:0});
  assert.equal(sh.uniforms.mtnDapple.value.y,0,'night removes daylight flecks');
  assert.equal(p.stats().shaderPatched, true);
  for (const a of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>']) assert.ok(!sh.fragmentShader.includes(a), `${a} replaced`);
  for (const inc of sh.fragmentShader.matchAll(/#include <(\w+)>/g)) assert.ok(THREE.ShaderChunk[inc[1]] !== undefined, `chunk ${inc[1]} exists`);
  const opens = (sh.fragmentShader.match(/\{/g) || []).length, closes = (sh.fragmentShader.match(/\}/g) || []).length; assert.equal(opens, closes, 'brace balance');
  for (const u of ['orchardMask', 'orchardGrassMap', 'orchardSoilNormal', 'orchardMaskRect']) assert.ok(sh.uniforms[u], `uniform ${u}`);
  assert.ok(sh.vertexShader.includes('vOrchardWorld = (modelMatrix'), 'world-space varying (no camera-space coordinates)');
  assert.ok(sh.fragmentShader.includes(`#define ORCHARD_DETAIL ${quality === 'low' ? 1 : 2}`));
  p.dispose();
});

test('budgets: draw calls, triangles, shadow map, mask bake time', () => {
  const {p, renderer, state} = fixture();
  const s = p.stats(); let fullMs = 0;
  assert.ok(s.addedDrawCalls <= 4, `draw calls ${s.addedDrawCalls}`);
  const tris = Object.values(s.addedTriangles).reduce((a, b) => a + b, 0); assert.ok(tris <= 15000, `triangles ${tris}`);
  assert.ok(s.shadowMapSize <= 1024 && renderer.shadowMap.enabled);
  const times = []; for (let i = 0; i < 7; i++) { state.edits = [{id: 'e' + i, x: i * 3 - 9, z: 12, radius: 2.5, height: i % 2 ? 1.5 : -1.5}]; p.groundChanged({edits: state.edits}); times.push(p.stats().maskBakeMs); }
  times.sort((a, b) => a - b); const median = times[3];
  assert.equal(p.stats().maskBakeKind, 'edits', 'edit-only changes skip the static channels');
  const full = O.bakeSurfaceMask({edits: state.edits}, 192), inc = O.bakeSurfaceMask({edits: []}, 192); O.bakeDisturbedChannel(state.edits, 192, O.GROUND_HALF, inc);
  let maxDiff = 0; for (let i = 0; i < full.length; i++) maxDiff = Math.max(maxDiff, Math.abs(full[i] - inc[i])); assert.ok(maxDiff <= 1, `incremental == full bake (max diff ${maxDiff})`);
  p.groundChanged({deposits: [{x: 5, z: 5, depleted: true}]});
  assert.equal(p.stats().maskPending, true); assert.equal(p.stats().maskBakeKind, 'queued');
  for (let i = 0; i < 4096 && p.stats().maskPending; i++) p.update(1 / 60);
  assert.equal(p.stats().maskPending, false); fullMs = p.stats().maskBakeMs; assert.equal(p.stats().maskBakeKind, 'full');
  assert.ok(median < 120, `median bake ${median} ms`);
  p.dispose();
  return `tris=${JSON.stringify(s.addedTriangles)} drawCalls=${s.addedDrawCalls} mask=${s.maskSize}^2 edit-bake median=${median.toFixed(2)}ms max=${times[6].toFixed(2)}ms full=${fullMs.toFixed(1)}ms (Node, this machine)`;
});

test('incremental ecosystem bake equals full bake with bounded sample work', () => {
  const trees = Array.from({length: 535}, (_, i) => ({x: (i * 17 % 110) - 55, z: (i * 31 % 110) - 55}));
  const ctx = {trees, deposits: [{x: 9, z: 7}], edits: [{x: -12, z: 8, radius: 4, height: -2}]};
  const job = O.createSurfaceMaskJob(ctx, 192);
  assert.equal(job.step(Infinity, 16), false);
  assert.deepEqual(job.data.slice(64), new Uint8Array(job.data.length - 64), 'only requested samples touched');
  let frames = 1, maxMs = 0;
  while (!job.done && frames < 4096) { const t = performance.now(); job.step(); maxMs = Math.max(maxMs, performance.now() - t); frames++; }
  assert.equal(job.done, true); assert.ok(frames >= 72, 'no monolithic runtime bake');
  assert.deepEqual(job.data, O.bakeSurfaceMask(ctx, 192));
  return `${frames} slices; max=${maxMs.toFixed(2)}ms totalCPU=${job.cpuMs.toFixed(2)}ms`;
});
test('new ecosystem request replaces pending bake and preserves newest terrain edit', () => {
  const {p, state} = fixture();
  p.groundChanged({trees: [{x: 2, z: 3}]}); p.update(1/60);
  const trees = [{x: -20, z: 3}], deposits = [{x: 15, z: 8}];
  p.groundChanged({trees, deposits});
  state.edits = [{x: 35, z: 30, radius: 5, height: -3}]; p.groundChanged({edits: state.edits});
  for (let i = 0; i < 4096 && p.stats().maskPending; i++) p.update(1/60);
  assert.equal(p.stats().maskPending, false);
  const mask = p.material.userData.orchardUniforms.orchardMask.value.image.data;
  assert.deepEqual(mask, O.bakeSurfaceMask({trees, deposits, edits: state.edits}, p.stats().maskSize));
  p.groundChanged({trees: []}); p.dispose(); assert.equal(p.stats().maskPending, false);
});

test('low quality: shadows off unless explicitly requested', () => {
  const a = fixture({quality: 'low'}); assert.equal(a.p.stats().shadowMapSize, 0); assert.equal(a.renderer.shadowMap.enabled, false); a.p.dispose();
  const b = fixture({quality: 'low', shadows: true}); assert.equal(b.p.stats().shadowMapSize, 1024); b.p.dispose();
});
test('backdrop is far-only, outside walk bound 55, and non-colliding', () => {
  const {p, scene} = fixture();
  const pos = p.objects.backdrop.geometry.attributes.position; let minR = Infinity;
  for (let i = 0; i < pos.count; i++) minR = Math.min(minR, Math.hypot(pos.getX(i), pos.getZ(i)));
  assert.ok(minR > O.WALK_BOUND + 20, `backdrop min radius ${minR.toFixed(1)}`);
  const sk = p.objects.skirt.geometry.attributes.position; let minCheb = Infinity;
  for (let i = 0; i < sk.count; i++) minCheb = Math.min(minCheb, Math.max(Math.abs(sk.getX(i)), Math.abs(sk.getZ(i))));
  assert.ok(minCheb >= 59 && minCheb < 60, `skirt starts under ground edge (${minCheb.toFixed(2)})`);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(1, -.05, 0).normalize()); ray.far = 500;
  const hits = ray.intersectObjects([p.objects.sky, p.objects.skirt, p.objects.backdrop, p.objects.puffs], true);
  assert.equal(hits.length, 0, 'presentation meshes ignore raycasts');
  p.dispose(); return `backdrop minR=${minR.toFixed(1)} skirt inner=${minCheb.toFixed(2)}`;
});
test('paths, clearing, deposits and meadow classify as intended', () => {
  const {p} = fixture();
  const at = (x, z) => p.surfaceAt(x, z).material;
  assert.equal(at(0, 0), 'path', 'forge clearing'); assert.equal(at(.4, 5.5), 'path', 'forge->tree ring path');
  assert.equal(at(5, 5), 'stone', 'deposit'); assert.equal(at(-30, -32), 'grass'); assert.equal(at(40, 10), 'grass');
  let path = 0, n = 0; for (let x = -55; x <= 55; x += 1) for (let z = -55; z <= 55; z += 1) { n++; if (at(x, z) !== 'grass') path++; }
  assert.ok(path / n < .08, `bare fraction ${(path / n * 100).toFixed(1)}% stays meadow-dominant`);
  p.dispose(); return `bare=${(path / n * 100).toFixed(2)}%`;
});
test('runtime edits: mask and classification respond, then revert', () => {
  const {p, state} = fixture();
  const before = p.surfaceAt(30, 30); assert.equal(before.material, 'grass');
  state.edits = [{id: 'w', x: 30, z: 31.2, radius: 2.5, height: 1.5}]; assert.equal(p.groundChanged({edits: state.edits}), true);
  const flank = p.surfaceAt(30, 30); assert.ok(flank.slope > .1 && flank.material !== 'grass', `flank ${flank.material} slope ${flank.slope.toFixed(3)}`);
  state.edits = [{id: 'c', x: -30, z: -20, radius: 2.5, height: -1.5}]; p.groundChanged({edits: state.edits});
  assert.ok(p.surfaceAt(-30, -20).disturbed > .3, 'crater floor churned');
  assert.equal(p.groundChanged({edits: state.edits}), false, 'unchanged signature skips rebake');
  state.edits = []; p.groundChanged({edits: state.edits}); assert.equal(p.surfaceAt(30, 30).material, 'grass');
  p.dispose();
});
test('macro tint field: varied, smooth (not confetti), deterministic', () => {
  const v = []; let rough = 0, n = 0;
  for (let x = -60; x <= 60; x += 2) for (let z = -60; z <= 60; z += 2) { const d = O.dryness(x, z); v.push(d); rough += Math.abs(O.dryness(x + .5, z) - d); n++; }
  const mean = v.reduce((a, b) => a + b) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  assert.ok(sd > .15, `variety sd ${sd.toFixed(3)}`); assert.ok(rough / n < .06, `0.5 m change ${(rough / n).toFixed(4)}`);
  assert.equal(O.hash2(-7, 12), O.hash2(-7, 12)); assert.ok(Math.min(...v) >= 0 && Math.max(...v) <= 1);
  return `mean=${mean.toFixed(2)} sd=${sd.toFixed(2)} mean|d(0.5m)|=${(rough / n).toFixed(4)}`;
});
test('shadow follow is texel-snapped (no shimmer on sub-texel moves)', () => {
  const {p, sun, camera} = fixture();
  camera.position.set(3, 1.7, 8); camera.lookAt(3, 1.7, 0); camera.updateMatrixWorld(); p.update(1 / 60, camera);
  const a = sun.target.position.clone(); const texel = 2 * p.stats().shadowExtent / sun.shadow.mapSize.x;
  camera.position.x += texel * .2; camera.updateMatrixWorld(); p.update(1 / 60, camera);
  const lateral = sun.target.position.clone().sub(a); const dirn = sun.position.clone().sub(sun.target.position).normalize();
  const perp = lateral.clone().sub(dirn.clone().multiplyScalar(lateral.dot(dirn)));
  assert.ok(perp.length() < 1e-6 || Math.abs(perp.length() / texel - Math.round(perp.length() / texel)) < 1e-3, `moved ${perp.length()} not multiple of texel ${texel}`);
  camera.position.set(0, 34, 22); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); p.update(1 / 60, camera);
  assert.equal(p.stats().shadowExtent, 34, 'RTS extent'); p.dispose();
  return `texel=${(texel * 100).toFixed(1)}cm FPS, ${(68 / 1024 * 100).toFixed(1)}cm RTS`;
});
test('contact hook: bounded pooled puffs + material metadata', () => {
  const {p, camera} = fixture();
  for (let i = 0; i < 200; i++) p.contact(0, 2 + (i % 5) * .1, {strength: 1});
  p.update(1 / 60, camera); assert.ok(p.stats().puffs <= 48, `live ${p.stats().puffs}`);
  const meta = p.contact(-40, 40, {visual: false}); assert.ok(['grass', 'path', 'soil', 'stone'].includes(meta.material) && meta.tint.length === 3);
  for (let i = 0; i < 90; i++) p.update(1 / 60, camera); assert.equal(p.stats().puffs, 0, 'puffs expire');
  p.dispose();
});
test('legacy game.js texture assignment is adopted, not double-applied', () => {
  const {p, ground, camera} = fixture();
  const t = new THREE.Texture(); ground.material.map = t; p.update(0, camera);
  assert.equal(ground.material.map, null); assert.equal(ground.material.userData.orchardUniforms.orchardGrassMap.value, t); assert.equal(t.repeat.x, 1);
  p.dispose();
});
test('dispose restores scene, lights, renderer and ground material', () => {
  const f = fixture(); const fogBefore = null;
  f.p.dispose();
  assert.equal(f.ground.material, f.stock); assert.equal(f.scene.fog, fogBefore); assert.equal(f.sun.castShadow, false); assert.equal(f.renderer.shadowMap.enabled, false);
  assert.equal(f.scene.children.filter(o => /^orchard-/.test(o.name)).length, 0); assert.equal(f.hemi.intensity, 1.2);
});

console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
