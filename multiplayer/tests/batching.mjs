// node tests/batching.mjs — instanced intact-forest batching on the real authored GLBs (headless Three, no WebGL).
// Draw counts are counted scene draws (visible meshes with instances), not GPU measurements.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import * as T from 'three';
import * as R from '../shared/trees.js';
import {worldTrees} from '../shared/world-content.js';
import {createTreeView} from '../client/tree-view.js';
import {loadGLB} from './glb.mjs';

const ART = process.env.BRANN_TREE_ART || new URL('../public/assets/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NAMES = ['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod', 'log', 'endcap'];
const results = [], timings = {}; let failed = 0;
const test = (name, fn) => { const t0 = performance.now(); try { fn(); results.push(`ok   ${name} (${(performance.now()-t0).toFixed(1)} ms)`); } catch (e) { failed++; results.push(`FAIL ${name}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`); } };
const time = (label, fn, n = 1) => { const t0 = performance.now(); let r; for (let i = 0; i < n; i++) r = fn(); timings[label] = +((performance.now() - t0)/n).toFixed(3); return r; };
const height = (x, z) => .45*Math.sin(x*.13) + .35*Math.cos(z*.11) + .02*x; // non-flat terrain: positions must follow it
const loadAll = (names = NAMES) => { const m = new Map(); for (const n of names) if (existsSync(ART + n + '.glb')) m.set(n, loadGLB(ART + n + '.glb')); return m; };
const templates = time('load 8 GLBs (ms)', () => loadAll());
// 535 trees: 25 world trees + 60 ring groves (8) + 6 small groves (5) on a deterministic grid inside the 120 m map.
function groves(n = 66) { const out = []; for (let i = 0; i < n; i++) { const gx = i % 9, gz = Math.floor(i/9); out.push({id: `g${i + 1}`, kind: i < 60 ? 'ring' : 'copse', x: -48 + gx*12 + (gz % 2)*3, z: -50 + gz*13}); } return out; }
const state = (extra = {}) => ({seed: 7, tick: 100, groves: groves(), harvestedTrees: [], looseLogs: [], ...extra});
const tplResources = tpl => { const g = new Set(), m = new Set(); for (const v of tpl.values()) v.scene.traverse(o => { if (o.isMesh) { g.add(o.geometry); for (const x of [].concat(o.material)) m.add(x); } }); return {g, m}; };
function makeView(tpl = templates, camPos = [0, 1.6, 0]) { const scene = new T.Scene(), camera = new T.PerspectiveCamera(); camera.position.fromArray(camPos); scene.add(camera); scene.updateMatrixWorld(true); const view = createTreeView({scene, templates: tpl, height, camera}); return {scene, camera, view}; }
const moveCam = (ctx, x, z) => { ctx.camera.position.set(x, 1.6, z); ctx.camera.updateMatrixWorld(true); };
// id -> instance matrices (every part mesh of its batch) for identity comparisons.
function snapshotIds(view) { const out = new Map(), m = new T.Matrix4(); for (const b of view.batches.batches()) b.ids.forEach((id, slot) => out.set(id, b.meshes.map(im => im.getMatrixAt(slot, m).toArray().join(',')).join(';'))); return out; }
function auditSlots(view, s) { // every slot maps to exactly one live tree, and its root matrix is that tree's (x, floor, z, scale)
 const byId = new Map(worldTrees(s).map(t => [t.id, t])), seen = new Set(), m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
 for (const b of view.batches.batches()) { for (const im of b.meshes) assert.equal(im.count, b.ids.length, 'all part meshes of a batch share the slot count');
  b.ids.forEach((id, slot) => { assert.ok(!seen.has(id), 'id in two slots ' + id); seen.add(id); const t = byId.get(id); assert.ok(t, 'slot for dead id ' + id);
   assert.deepEqual(view.batches.slotOf(id), {variant: R.VARIANTS[t.variant], level: b.level, slot, key: b.key});
   m.fromArray(b.roots, slot*16).decompose(p, q, sc); assert.ok(Math.abs(p.x - t.x) < 1e-5 && Math.abs(p.z - t.z) < 1e-5 && Math.abs(p.y - height(t.x, t.z)) < 1e-5, 'root origin = trunk axis at terrain for ' + id);
   assert.ok(Math.abs(sc.x - R.treeScale(t)) < 1e-5 && Math.abs(sc.y - sc.x) < 1e-6, 'uniform authored scale'); assert.ok(q.angleTo(new T.Quaternion()) < 1e-6, 'intact trees are unrotated');
   b.meshes.forEach((im, k) => { const want = m.clone().multiply(b.parts[k].matrix).toArray(), got = im.getMatrixAt(slot, new T.Matrix4()).toArray(); assert.ok(want.every((x, i) => Math.abs(x - got[i]) < 1e-5), 'part matrix = root * authored part'); }); }); }
 return seen;
}
const ray = new T.Raycaster();
function shoot(view, origin, target) { view.group.updateMatrixWorld(true); const d = new T.Vector3().subVectors(target, origin).normalize(); ray.set(origin, d); ray.far = 50; const hits = ray.intersectObjects(view.targets(), false).filter(h => view.surfaceVisible(h)); return hits.length ? view.resolveTarget(hits[0]) : null; }
const ctx = makeView(), {view} = ctx, S = state();
const all = worldTrees(S);
// ray probes need a clear 2 m around the trunk (the fixture deliberately has a few overlapping God-grown trees)
const clear = t => all.every(o => o === t || Math.hypot(o.x - t.x, o.z - t.z) > 2);

test('fixture: 535 deterministic shared worldTrees, all three variants, inside the 120 m map', () => { assert.equal(all.length, 535); assert.equal(new Set(all.map(t => t.id)).size, 535); for (const v of [0, 1, 2]) assert.ok(all.filter(t => t.variant === v).length > 120);
 assert.ok(all.every(t => Math.abs(t.x) < 60 && Math.abs(t.z) < 60)); assert.deepEqual(worldTrees(state()), all); });
test('535 intact trees: <=45 intact draws (variant x LOD x part batches), exact root origins/scale, no individual entities', () => {
 time('cold sync 535 (ms)', () => view.sync(S)); view.tick(1000, 100);
 const st = view.stats(); assert.equal(st.trees, 535); assert.equal(st.intact, 535); assert.equal(st.individual, 0); assert.deepEqual(st.missingAssets, []);
 assert.ok(st.intactDraws <= 45, 'intact draws ' + st.intactDraws); assert.ok(st.drawCalls <= 45, 'total draws ' + st.drawCalls); assert.ok(st.lod > 200 && st.lod < 535, 'LOD mix ' + st.lod);
 assert.equal(st.intactDraws, 3*5 + 3*4, 'full kit 5 parts, authored LOD 4 parts per variant'); assert.equal(st.shaderPrograms, 2); auditSlots(view, S);
 results.push(`     stats: ${JSON.stringify({drawCalls: st.drawCalls, intactDraws: st.intactDraws, batches: st.batches, lod: st.lod, triangles: st.triangles, programs: st.shaderPrograms})}`);
 for (const b of view.batches.batches()) for (const im of b.meshes) for (const p of b.parts) if (im.geometry === p.geometry) assert.ok(tplResources(templates).g.has(im.geometry), 'shared template geometry, not copies'); });
test('wind: one shared leaf material per variant for batches and entities; per-instance phase in the shader', () => { const leaves = view.batches.meshes().filter(m => m.userData.part === 'Leaves');
 assert.ok(leaves.every(m => m.material.userData.treeWind)); const shader = {uniforms: {}, vertexShader: '#include <begin_vertex>\n'}; leaves[0].material.onBeforeCompile(shader);
 assert.match(shader.vertexShader, /USE_INSTANCING[\s\S]*instanceMatrix\)\[3\]\.xz/); assert.ok(shader.uniforms.uTreeWind); view.tick(2500, 100); assert.equal(shader.uniforms.uTreeWind.value, 2.5); });
function variantProbe(level) { // ray at 1 m toward the trunk axis from 0.9 m out on each axis side, for three trees per variant at `level`
 for (const v of [0, 1, 2]) { const picks = all.filter(t => clear(t) && t.variant === v && view.batches.slotOf(t.id)?.level === level).slice(0, 3); assert.equal(picks.length, 3, `variant ${v} ${level}`);
  for (const t of picks) for (const [sx, sz] of [[1, 0], [0, 1], [-.6, -.8]]) { const f = height(t.x, t.z), axis = new T.Vector3(t.x, f + 1, t.z), o = new T.Vector3(t.x + sx*.9, f + 1, t.z + sz*.9);
   const r = shoot(view, o, axis); assert.ok(r, `hit ${t.id}`); assert.equal(r.id, t.id); assert.equal(r.instanced, true);
   const rad = Math.hypot(r.point[0] - t.x, r.point[2] - t.z), want = R.trunkRadius(t, 1); assert.ok(Math.abs(rad - want)/want < (level === 'lod' ? .2 : .1), `impact radius ${rad.toFixed(3)} vs ${want.toFixed(3)} (${level})`);
   assert.ok(Math.abs(r.point[1] - (f + 1)) < 1e-6); assert.ok(r.normal[0]*sx + r.normal[2]*sz > .7, 'world normal faces the shooter');
   // R.chopTree accepts the resolved impact as an in-range chop on the logical tree.
   const s = {tick: 1, harvestedTrees: []}; const c = R.chopTree(s, t, r.point, r.normal, {terrainHeight: height}); assert.equal(c.events[0].cuts, 1); assert.equal(s.harvestedTrees[0].id, t.id); } }
}
test('raycast: full-detail trunk hits resolve to the logical tree with the actual trunk impact point, all variants', () => variantProbe('full'));
test('raycast: authored-LOD trunk hits resolve too (far trees remain choppable targets)', () => variantProbe('lod'));
test('raycast: canopy is never an axe target (rays through leaves miss; leaves do exist there)', () => { for (const v of [0, 1, 2]) { const t = all.find(x => clear(x) && x.variant === v && view.batches.slotOf(x.id).level === 'full'), f = height(t.x, t.z), y = f + t.height*.8;
 const o = new T.Vector3(t.x + 3.5, y, t.z + .3), aim = new T.Vector3(t.x, y, t.z + .3), r = shoot(view, o, aim); assert.ok(!r || r.id !== t.id, 'canopy hit resolved ' + t.id);
 ray.set(o, aim.clone().sub(o).normalize()); const leafHits = ray.intersectObjects(view.batches.meshes().filter(m => m.userData.part !== 'Trunk' && m.count), false).filter(h => view.batches.idOf(h) === t.id); assert.ok(leafHits.length > 0, 'canopy geometry present on that ray'); } });
let cutId, before;
test('cut one: only that tree de-instances to a carved entity; every other instance is bit-identical; dirty upload bounded', () => {
 const t = all.find(x => clear(x) && x.variant === 1 && view.batches.slotOf(x.id).level === 'full'); cutId = t.id; before = snapshotIds(view); view.batches.resetCounters();
 for (const im of view.batches.meshes()) im.instanceMatrix.clearUpdateRanges();
 const f = height(t.x, t.z), cut = {id: t.id, cuts: 1, cutHeight: f + 1, fallYaw: Math.PI/2, felledTick: 0, landed: false};
 time('sync with 1 new wound (ms)', () => view.sync({...S, harvestedTrees: [cut]}));
 const st = view.stats(); assert.equal(st.intact, 534); assert.equal(st.individual, 1); assert.equal(st.wounded, 1); assert.ok(!view.batches.has(t.id)); assert.ok(view.entity(t.id).wound);
 assert.ok(st.drawCalls - st.intactDraws <= 6, 'one wounded tree costs its own few draws'); assert.equal(st.intactDraws, 27);
 const after = snapshotIds(view); for (const [id, m] of before) if (id !== t.id) assert.equal(after.get(id), m, 'instance changed ' + id);
 const c = view.batches.counters(); assert.ok(c.writes === 0 && c.moves <= 1, JSON.stringify(c));
 for (const im of view.batches.meshes()) { const n = im.instanceMatrix.updateRanges.reduce((a, r) => a + r.count, 0); assert.ok(n <= 16, 'update range ' + n + ' floats'); }
 assert.ok(view.entity(t.id).root.position.equals(new T.Vector3(t.x, f, t.z)), 'entity takes over at the identical root origin');
 // the carved notch is the target now: a ray into the notch side (+X, fallYaw pi/2) hits the entity, resolved by targetId
 const r = shoot(view, new T.Vector3(t.x + 1, f + 1.05, t.z), new T.Vector3(t.x, f + 1.05, t.z)); assert.equal(r.id, t.id); assert.equal(r.instanced, false);
 const back = shoot(view, new T.Vector3(t.x - 1, f + 1, t.z), new T.Vector3(t.x, f + 1, t.z)); assert.equal(back.id, t.id); auditSlots(view, S); });
test('fell then restore: felled entity keeps stump; record removal re-instances at the identical matrix', () => { const t = all.find(x => x.id === cutId), f = height(t.x, t.z);
 view.sync({...S, tick: 200, harvestedTrees: [{id: t.id, cuts: 3, cutHeight: f + 1, fallYaw: Math.PI/2, felledTick: 150, landed: false}]}); view.tick(3000, 200);
 let st = view.stats(); assert.equal(st.felled, 1); assert.equal(st.intact, 534); assert.ok(!view.targets().some(m => m.userData.targetId === t.id), 'felled tree is not an axe target');
 view.sync(S); st = view.stats(); assert.equal(st.intact, 535); assert.equal(st.individual, 0); assert.equal(st.ownedGeometries, 1, 'only the chip box remains owned');
 assert.equal(snapshotIds(view).get(t.id), before.get(t.id)); auditSlots(view, S); });
test('grow / remove / rebuild: new grove grows per instance, removals and reload never mix ids', () => { const base = snapshotIds(view), g = {id: 'g99', kind: 'ring', x: 30, z: 52}, S2 = {...S, groves: [...S.groves, g]};
 view.tick(10000, 100); view.sync(S2); const fresh = worldTrees(S2).filter(t => t.id.startsWith('g99-')); assert.equal(fresh.length, 8);
 const sc = (id, out = new T.Vector3()) => { view.batches.rootOf(id).decompose(new T.Vector3(), new T.Quaternion(), out); return out.x; };
 view.tick(10100, 100); for (const t of fresh) assert.ok(sc(t.id) < .1*R.treeScale(t), 'growing from small'); assert.equal(view.stats().growing, 8);
 view.tick(10700, 100); for (const t of fresh) { const k = sc(t.id)/R.treeScale(t); assert.ok(k > .3 && k < .9, 'mid-growth ' + k); }
 view.tick(11500, 100); for (const t of fresh) assert.ok(Math.abs(sc(t.id) - R.treeScale(t)) < 1e-6); assert.equal(view.stats().growing, 0);
 let now = snapshotIds(view); for (const [id, m] of base) assert.equal(now.get(id), m, 'growth touched ' + id); auditSlots(view, S2);
 const S3 = {...S2, groves: S2.groves.filter(x => x.id !== 'g31')}; view.sync(S3); now = snapshotIds(view); assert.equal(view.stats().intact, 535 - 8 + 8);
 for (const [id, m] of base) if (!id.startsWith('g31-')) assert.equal(now.get(id), m, 'removal moved ' + id); else assert.ok(!now.has(id)); auditSlots(view, S3);
 const keep = snapshotIds(view); time('reload (rebuild kits + batches) (ms)', () => view.reload(templates)); assert.deepEqual([...snapshotIds(view).entries()].sort(), [...keep.entries()].sort(), 'reload rebuilds the same id -> matrix map');
 view.sync(S); assert.equal(view.stats().growing, 8, 're-added grove regrows'); view.tick(13000, 100); auditSlots(view, S); });
test('LOD: hysteresis + step threshold; stationary camera costs zero writes; long move converges within the per-frame budget', () => {
 view.tick(20000, 100); view.batches.resetCounters(); for (let i = 0; i < 120; i++) view.tick(20000 + i*16, 100); assert.deepEqual(view.batches.counters(), {writes: 0, moves: 0});
 timings['steady tick 535 (ms)'] = (() => { const t0 = performance.now(); for (let i = 0; i < 200; i++) view.tick(22000 + i, 100); return +((performance.now() - t0)/200).toFixed(4); })();
 const lodOf = id => view.batches.slotOf(id).level, d = t => Math.hypot(t.x, t.z);
 for (const t of all) { if (d(t) > 28.01) assert.equal(lodOf(t.id), 'lod', t.id); if (d(t) < 23.99) assert.equal(lodOf(t.id), 'full', t.id); }
 moveCam(ctx, .6, 0); view.batches.resetCounters(); view.tick(23000, 100); assert.equal(view.batches.counters().writes, 0, 'sub-step camera motion re-evaluates nothing');
 // oscillating across a boundary inside the hysteresis band does not churn
 moveCam(ctx, 1.5, 0); view.tick(23016, 100); const sw = view.stats().lodSwitches; for (let i = 0; i < 20; i++) { moveCam(ctx, i % 2 ? 1.5 : 2.6, 0); view.tick(23032 + i*16, 100); } assert.ok(view.stats().lodSwitches - sw <= 6, 'churn ' + (view.stats().lodSwitches - sw));
 moveCam(ctx, 40, 30); let frames = 0, maxWrites = 0; const t0 = performance.now(); do { view.batches.resetCounters(); view.tick(24000 + frames*16, 100); maxWrites = Math.max(maxWrites, view.batches.counters().writes); frames++; } while (view.batches.counters().writes && frames < 20);
 timings['LOD long-move convergence total (ms)'] = +(performance.now() - t0).toFixed(3); timings['LOD frames to converge'] = frames; timings['LOD max writes/frame'] = maxWrites;
 assert.ok(maxWrites <= 128, 'budget'); for (const t of all) { const dd = Math.hypot(t.x - 40, t.z - 30); if (dd > 28.01) assert.equal(lodOf(t.id), 'lod'); if (dd < 23.99) assert.equal(lodOf(t.id), 'full'); }
 assert.ok(view.stats().intactDraws <= 45); auditSlots(view, S); moveCam(ctx, 0, 0); for (let i = 0; i < 10; i++) view.tick(25000 + i*16, 100); });
test('steady resync without changes writes nothing (CPU transforms only on terrain/grove/cut/LOD change)', () => { view.batches.resetCounters(); time('steady resync 535 (ms)', () => view.sync(S), 20); assert.deepEqual(view.batches.counters(), {writes: 0, moves: 0});
 const t = all[0]; view.sync({...S, edits: [1]}); /* same height fn ignores edits: key unchanged */ assert.equal(view.batches.counters().writes, 0); });
test('terrain change rewrites only the affected trees', () => { const local = (x, z, edits) => height(x, z) + (edits?.length && Math.hypot(x + 2, z - 6) < 3 ? .5 : 0);
 const c2 = makeView(templates, [0, 1.6, 0]); c2.view.sync(S); c2.view.tick(1, 100); c2.view.batches.resetCounters(); const v2 = createTreeView({scene: new T.Scene(), templates, height: local}); v2.sync(S); v2.batches.resetCounters();
 v2.sync({...S, edits: [{}]}); const changed = all.filter(t => Math.hypot(t.x + 2, t.z - 6) < 3).length; assert.ok(changed > 0); assert.equal(v2.batches.counters().writes, changed); v2.dispose(); c2.view.dispose(); });
test('determinism: two views of the same state produce identical id -> matrix maps', () => { const c2 = makeView(); c2.view.sync(S); c2.view.tick(1000, 100); const a = snapshotIds(c2.view), b = makeView(); b.view.sync(S); b.view.tick(1000, 100);
 assert.deepEqual([...a.entries()].sort(), [...snapshotIds(b.view).entries()].sort()); c2.view.dispose(); b.view.dispose(); });
test('atomic assets: a missing variant GLB draws none of that variant (no fallback); missing LOD keeps full detail', () => {
 const tpl = loadAll(NAMES.filter(n => n !== 'tree_b' && n !== 'tree_young_lod')), c = makeView(tpl); c.view.sync(S); c.view.tick(1000, 100); const st = c.view.stats();
 assert.ok(st.missingAssets.includes('tree_b')); assert.equal(st.intact, all.filter(t => t.variant !== 1).length); assert.ok(!c.view.batches.batches().some(b => b.variant === 'tree_b'));
 assert.ok(all.filter(t => t.variant === 2).every(t => c.view.batches.slotOf(t.id).level === 'full')); c.view.dispose(); });
test('ownership: reload and dispose free batch instance buffers, owned geometry and wind materials; never template geometry/materials', () => {
 const tpl = loadAll(), {g, m} = tplResources(tpl), freed = []; for (const x of [...g, ...m]) x.addEventListener('dispose', () => freed.push(x.name || x.type));
 const c = makeView(tpl); c.view.sync({...S, harvestedTrees: [{id: 'tree1', cuts: 2, cutHeight: height(-2, 6) + 1, fallYaw: 0, felledTick: 0, landed: false}]}); c.view.tick(1000, 100);
 const inst = c.view.batches.meshes(), instFreed = new Set(); for (const im of inst) im.addEventListener('dispose', () => instFreed.add(im));
 const wind = new Set(inst.filter(im => im.material.userData.treeWind).map(im => im.material)); let windFreed = 0; for (const w of wind) w.addEventListener('dispose', () => windFreed++);
 c.view.reload(tpl); assert.equal(instFreed.size, inst.length, 'old batch InstancedMeshes disposed on reload'); assert.equal(windFreed, wind.size); assert.deepEqual(freed, []);
 const st = c.view.stats(); assert.equal(st.wounded, 1); assert.equal(st.intact, 534);
 c.view.dispose(); assert.deepEqual(freed, [], 'template resources untouched'); assert.equal(c.view.group.parent, null); assert.equal(c.view.stats().ownedGeometries, 0); assert.equal(c.view.batches.meshes().length, 0);
 for (const x of g) assert.ok(x.attributes.position.array.length > 0); });
test('raycast cost against 535 instanced trunks', () => { const t = all.filter(clear)[200], f = height(t.x, t.z); const o = new T.Vector3(t.x + .9, f + 1, t.z), aim = new T.Vector3(t.x, f + 1, t.z); time('axe raycast vs targets() (ms)', () => shoot(view, o, aim), 50); assert.equal(shoot(view, o, aim).id, t.id); });

ctx.view.dispose();
console.log(results.join('\n')); console.log('timings', JSON.stringify(timings, null, 1)); console.log(failed ? `${failed} FAILED` : 'all batching tests passed'); process.exit(failed ? 1 : 0);
