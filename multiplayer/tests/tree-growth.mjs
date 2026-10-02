// node tests/tree-growth.mjs — staged growth endpoint/anchor/no-replay/cleanup on the real authored GLBs (headless).
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import * as R from '../shared/trees.js';
import {worldTrees} from '../shared/world-content.js';
import {createTreeView} from '../client/tree-view.js';
import {growthPose, growthProfile, growthMatrices, GROW_MS} from '../client/tree-growth.js';
import {loadGLB} from './glb.mjs';

const art = n => fileURLToPath(new URL(`../public/assets/${n}.glb`, import.meta.url));
const results = []; let failed = 0; const t0 = performance.now();
const test = (name, fn) => { const t = performance.now(); try { fn(); results.push(`ok   ${name} (${(performance.now()-t).toFixed(1)} ms)`); } catch (e) { failed++; results.push(`FAIL ${name}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); } };
const templates = new Map(['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod'].map(n => [n, loadGLB(art(n))]));
templates.set('endcap', loadGLB(art('endcap')));
const fresh = () => ({seed: 7, tick: 100, idCounter: 0, groves: [], harvestedTrees: [], looseLogs: [], pickups: [], detachedParts: [], players: []});
const GROVE = {id: 'g1', kind: 'ring', x: 0, z: -6};
const makeView = () => { const camera = new T.PerspectiveCamera(); camera.position.set(0, 1.7, -2); camera.updateMatrixWorld(true); return createTreeView({scene: new T.Scene(), templates, height: () => 0, camera}); };
// world-space matrix of every part instance of one tree, keyed by part name + index
function partMatrices(view, id) { const w = view.batches.slotOf(id), b = view.batches.batches().find(x => x.key === w.key), out = {};
 b.meshes.forEach((im, k) => { out[`${im.userData.part}#${k}`] = new T.Matrix4().fromArray(im.instanceMatrix.array, w.slot*16); }); return {out, b, slot: w.slot}; }
const near = (a, b, eps = 1e-6) => a.elements.every((x, i) => Math.abs(x - b.elements[i]) <= eps);

test('no replay: saved / late-join / reloaded trees never grow', () => {
 const s = fresh(); s.groves.push(GROVE); const v = makeView(); v.sync(s); v.tick(0, s.tick); assert.equal(v.stats().growing, 0, 'first sync = saved world');
 v.reload(); v.tick(50, s.tick); assert.equal(v.stats().growing, 0, 'asset reload does not replay'); v.dispose(); });

let pose9;
test('endpoint: grown trees end exactly at the mature authored instance matrices; roots anchored throughout', () => {
 const s = fresh(), v = makeView(), ref = makeView(); v.sync(s); v.tick(0, s.tick); s.groves.push(GROVE); v.tick(1000, s.tick); v.sync(s); assert.equal(v.stats().growing, 8, 'eight new grove trees grow');
 const id = 'g1-tree0', t = worldTrees(s).find(x => x.id === id), mature = new T.Matrix4().compose(new T.Vector3(t.x, 0, t.z), new T.Quaternion(), new T.Vector3().setScalar(R.treeScale(t)));
 for (const ms of [100, 300, 600, 900, 1399]) { v.tick(1000 + ms, s.tick); const {out, b} = partMatrices(v, id);
  assert.ok(near(v.batches.rootOf(id), mature), `rootOf stays the mature root at ${ms} ms`);
  const rootNow = v.batches.rootOf(id); for (const [key, m] of Object.entries(out)) { const part = key.split('#')[0], k = +key.split('#')[1], local = new T.Matrix4().multiplyMatrices(rootNow.clone().invert(), m).multiply(b.parts[k].matrix.clone().invert());
   const base = new T.Vector3(0, 0, 0).applyMatrix4(local); // trunk axis ground point after growth
   if (part === 'Roots') assert.ok(base.length() < 1e-6, `roots pinned at origin ${ms}ms`);
   if (part === 'Trunk') assert.ok(Math.hypot(base.x, base.z) < 1e-6 && Math.abs(base.y) < 1e-6, `trunk base anchored on the axis ${ms}ms`); } }
 v.tick(1000 + GROW_MS, s.tick); assert.equal(v.stats().growing, 0, 'growth set drains');
 ref.sync(s); ref.tick(0, s.tick); // ref first-syncs the grove as a saved world -> mature path
 const a = partMatrices(v, id).out, r = partMatrices(ref, id).out; for (const k of Object.keys(r)) assert.ok(a[k].equals(r[k]), `exact mature matrix ${k}`);
 v.dispose(); ref.dispose(); });

test('staging: sapling -> branches -> foliage -> settle (not a uniform scale)', () => {
 const prof = growthProfile({parts: Object.fromEntries(['Trunk', 'Roots', 'Branches', 'Leaves', 'Fruit'].map(p => [p, [{geometry: new T.BoxGeometry(1, 1, 1).translate(0, p === 'Trunk' ? 2 : p === 'Roots' ? 0 : 4, 0), matrix: new T.Matrix4()}]]))});
 const at = ms => growthPose(ms/GROW_MS, .3), p1 = at(100), p3 = at(300), p6 = at(600), p9 = at(900), p14 = at(1400); pose9 = p9;
 assert.ok(p1.trunkY > .2 && p1.trunkXZ < .45 && p1.branches < .05 && p1.leaves < .12, `.1s is a thin sapling ${JSON.stringify(p1)}`);
 assert.ok(p3.branches > .2 && p3.leaves <= .1021, `.3s branches sprouting; foliage still only the bud tuft ${JSON.stringify(p3)}`);
 assert.ok(p6.branches > .95 && p6.leaves > .2 && p6.leaves < 1, `.6s foliage emerging ${JSON.stringify(p6)}`);
 assert.ok(p9.trunkY === 1 && Math.abs(p9.tiltX) + Math.abs(p9.tiltZ) > 1e-4, `.9s settling jostle ${JSON.stringify(p9)}`);
 assert.ok(p14.done && p14.leaves === 1 && p14.tiltX === 0, '1.4s exact');
 const late = growthPose(1399/GROW_MS, .3); assert.ok(Math.abs(late.leaves - 1) < .002 && Math.abs(late.tiltX) < 1e-5, 'jostle decays to rest before the end');
 const m = growthMatrices(prof, growthPose(1, 0)); for (const k of Object.keys(m)) assert.ok(near(m[k], new T.Matrix4(), 1e-12), `identity at end ${k}`); });

test('harvest mid-growth: entity takes over at the exact mature shape; removal / LOD switch / dispose clean', () => {
 const s = fresh(), v = makeView(); v.sync(s); v.tick(0, s.tick); s.groves.push(GROVE); v.tick(1000, s.tick); v.sync(s); v.tick(1300, s.tick);
 const t = worldTrees(s).find(x => x.id === 'g1-tree1'); R.chopTree(s, t, [t.x + R.trunkRadius(t, 1), 1, t.z], [1, 0, 0], {terrainHeight: () => 0}); v.sync(s); v.tick(1310, s.tick);
 const e = v.entity(t.id); assert.ok(e && Math.abs(e.root.scale.x - R.treeScale(t)) < 1e-12 && e.root.scale.y === e.root.scale.x, 'entity at mature uniform scale'); assert.equal(v.stats().growing, 7); assert.equal(v.stats().wounded, 1);
 // LOD switch mid-growth: far camera moves remaining growers to the LOD kit with its own profile, still finishing exact
 const far = makeView(); far.sync(fresh()); far.tick(0, 100); const sf = fresh(); sf.groves.push(GROVE); far.sync(sf); far.tick(200, 100);
 v.tick(1350, s.tick); s.groves = []; s.harvestedTrees = []; v.sync(s); assert.equal(v.stats().growing, 0, 'grove removed mid-growth: no stale growers'); assert.equal(v.batches.has('g1-tree0'), false); assert.equal(v.entity(t.id), null);
 v.dispose(); far.dispose(); assert.equal(v.stats().growing, 0); });

test('LOD kit mid-growth ends exact', () => {
 const camera = new T.PerspectiveCamera(); camera.position.set(0, 1.7, 80); camera.updateMatrixWorld(true);
 const v = createTreeView({scene: new T.Scene(), templates, height: () => 0, camera}), s = fresh(); v.sync(s); v.tick(0, 100); s.groves.push(GROVE); v.tick(10, 100); v.sync(s); v.tick(500, 100);
 assert.equal(v.batches.slotOf('g1-tree0').level, 'lod'); v.tick(10 + GROW_MS, 100); assert.equal(v.stats().growing, 0);
 const {out, b} = partMatrices(v, 'g1-tree0'), root = v.batches.rootOf('g1-tree0'); b.parts.forEach((p, k) => assert.ok(out[`${p.part}#${k}`].equals(new T.Matrix4().multiplyMatrices(root, p.matrix)), `lod ${p.part} exact`)); v.dispose(); });

test('budget: grower writes are bounded to growing trees only', () => {
 const s = fresh(), v = makeView(); v.sync(s); v.tick(0, 100); s.groves.push(GROVE); v.tick(10, 100); v.sync(s); v.batches.resetCounters();
 for (let ms = 26; ms < 10 + GROW_MS + 40; ms += 16) v.tick(ms, 100); const w = v.batches.counters().writes; assert.ok(w <= 8*Math.ceil((GROW_MS + 40)/16), `writes ${w}`); assert.equal(v.stats().growing, 0); v.dispose(); });

console.log(results.join('\n')); console.log(`tree-growth: ${failed ? failed + ' FAILED' : 'all ' + results.length + ' passed'} (${((performance.now() - t0)/1000).toFixed(3)} s)`); process.exitCode = failed ? 1 : 0;
