// node tests/trees.mjs  — pure rules + real authored GLB geometry + headless view (no WebGL needed).
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import * as R from '../shared/trees.js';
import {worldTrees} from '../shared/world-content.js';
import {bakeTriangles, buildNotch, buildFelled, audit, fitEndcapUV} from '../client/tree-carve.js';
import {createTreeView} from '../client/tree-view.js';
import {loadGLB} from './glb.mjs';

const art = n => fileURLToPath(new URL(`../public/assets/${n}.glb`, import.meta.url));
const results = []; let failed = 0;
const test = (name, fn) => { const t0 = performance.now(); try { fn(); results.push(`ok   ${name} (${(performance.now()-t0).toFixed(1)} ms)`); } catch (e) { failed++; results.push(`FAIL ${name}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); } };
const ground = () => 0, terrainHeight = (s, x, z) => ground(x, z);
const fresh = () => ({seed: 7, tick: 100, idCounter: 0, groves: [], harvestedTrees: [], looseLogs: [], pickups: [], detachedParts: [], players: [{id: 'p1', role: 'hero', yaw: 0, position: [-2, 0, 7.5], resources: {wood: 0}}]});
const ctx = {terrainHeight, nextId: (s, p) => `${p}${++s.idCounter}`, makePickup(kind, x, z, amount) { this.made.push({kind, amount}); }, made: []};
const tree1 = s => worldTrees(s)[0]; // tree1 at (-2, 6) h 5.8, variant 0
const hitPoint = (t, y, side = [0, 1]) => [t.x + side[0]*R.trunkRadius(t, y), y, t.z + side[1]*R.trunkRadius(t, y)];
function fell(s, t, side = [0, 1]) { for (let i = 0; i < 3; i++) R.chopTree(s, t, hitPoint(t, 1, side), [side[0], 0, side[1]], {terrainHeight: (x, z) => 0}); return s.harvestedTrees.find(h => h.id === t.id); }

test('contract radius + scale', () => { const t = {height: 6.002, variant: 0}; assert.equal(R.trunkRadius(t, 1), .2541); assert.ok(Math.abs(R.trunkRadius(t, .8) - (.2658+.2541)/2) < 1e-9); const big = {height: 12.004, variant: 0}; assert.ok(Math.abs(R.trunkRadius(big, 2) - .2541*2) < 1e-9); });
test('chops: side from impact, wound persists, 3rd fells, glance off-range', () => { const s = fresh(), t = tree1(s), c = {terrainHeight: () => 0};
 let r = R.chopTree(s, t, hitPoint(t, 1, [1, 0]), [1, 0, 0], c); const h = s.harvestedTrees[0]; assert.equal(h.cuts, 1); assert.ok(Math.abs(h.fallYaw - Math.PI/2) < 1e-9); assert.equal(r.events[0].cuts, 1);
 r = R.chopTree(s, t, hitPoint(t, 2.2, [1, 0]), [1, 0, 0], c); assert.equal(h.cuts, 1, 'far chop must not reset the persisted notch'); assert.ok(r.events[0].glance);
 r = R.chopTree(s, t, hitPoint(t, .1, [1, 0]), [1, 0, 0], c); assert.ok(r.events[0].glance, 'root flare is out of the authored cut range');
 R.chopTree(s, t, hitPoint(t, 1.1, [1, 0]), [1, 0, 0], c); r = R.chopTree(s, t, hitPoint(t, 1, [1, 0]), [1, 0, 0], c); assert.equal(h.cuts, 3); assert.equal(h.felledTick, 100); assert.equal(r.events[1].kind, 'tree_fell');
 assert.deepEqual(R.chopTree(s, t, hitPoint(t, 1), [0, 0, 1], c).events, []); assert.equal(R.chopTree(s, t, [t.x + 3, 1, t.z], [1, 0, 0], c).events.length, 0); });
test('notch depth: second chop deeper, at impact height', () => { const s = fresh(), t = tree1(s); R.chopTree(s, t, hitPoint(t, 1.2), [0, 0, 1], {terrainHeight: () => 0}); const h = s.harvestedTrees[0];
 const n1 = R.notchFor(t, h, 0); h.cuts = 2; const n2 = R.notchFor(t, h, 0); assert.ok(n2.depth > n1.depth*1.5); assert.ok(Math.abs(n1.height - 1.2) < 1e-9); });
test('fall: deterministic, monotonic, terrain contact, settle', () => { const s = fresh(), t = tree1(s), h = fell(s, t); let prev = -1, landed = null;
 for (let k = 100; k < 400; k++) { const f = R.treeFall(t, h, k, 0, ground); if (f.phase === 'falling') { assert.ok(f.angle >= prev); prev = f.angle; } else if (!landed) landed = f; }
 assert.ok(landed && landed.landTicks > 40 && landed.landTicks < 200, `land ticks ${landed?.landTicks}`); assert.ok(Math.abs(landed.end - R.landingAngle(t, h, 0, ground)) < 1e-12);
 assert.deepEqual(R.treeFall(t, h, 150, 0, ground), R.treeFall(t, h, 150, 0, ground)); const hill = (x, z) => Math.max(0, 6 - z)*.5; assert.ok(R.landingAngle(t, h, 0, hill) < R.landingAngle(t, h, 0, ground), 'rising terrain stops the fall earlier'); });
test('logs spawn once at landing; save/rejoin cannot duplicate', () => { const s = fresh(), t = tree1(s), h = fell(s, t), idx = R.createTreeIndex(), ev = [];
 let k = 0; for (; k < 400 && !h.landed; k++) { s.tick++; R.stepTrees(s, ctx, idx, ev); } assert.ok(h.landed); assert.equal(s.looseLogs.length, 3);
 const saved = structuredClone(s), restored = {...saved, harvestedTrees: R.restoreHarvested(saved, new Set(worldTrees(saved).map(t => t.id))), looseLogs: R.restoreLogs(saved, new Set())};
 for (let i = 0; i < 300; i++) { restored.tick++; R.stepTrees(restored, ctx, idx, []); } assert.equal(restored.looseLogs.length, 3);
 const old = structuredClone(saved); delete old.harvestedTrees[0].landed; assert.equal(R.restoreHarvested(old, new Set(worldTrees(old).map(t => t.id)))[0].landed, true, 'pre-log saves already got the wood pickup');
 for (const l of s.looseLogs) assert.ok(Math.abs(Math.hypot(...l.quaternion) - 1) < 1e-9); });
test('mid-fall save resumes the same pose; capacity full does not block', () => { const s = fresh(), t = tree1(s), h = fell(s, t), idx = R.createTreeIndex(); s.tick = 140;
 const copy = {...structuredClone(s), harvestedTrees: R.restoreHarvested(structuredClone(s), new Set(worldTrees(s).map(t => t.id)))}; assert.deepEqual(R.treeFall(t, copy.harvestedTrees[0], 140, 0, ground), R.treeFall(t, h, 140, 0, ground));
 s.looseLogs = Array.from({length: 47}, (_, i) => ({id: `log${900+i}`, sourceId: 'tree2', position: [0, .16, i - 23], quaternion: [0, 0, .7071067811865476, .7071067811865476], velocity: [0, 0, 0], angularVelocity: [0, 0, 0], heldBy: null, bornTick: 1, sleeping: true}));
 ctx.made.length = 0; for (let i = 0; i < 400 && !h.landed; i++) { s.tick++; R.stepTrees(s, ctx, idx, []); } assert.ok(h.landed); assert.equal(s.looseLogs.length, 48); assert.deepEqual(ctx.made, [{kind: 'wood', amount: 2}]); });
test('log grab/hold/throw/stow: 2.5 m reach, no auto-collect, sleeps', () => { const s = fresh(), p = s.players[0], idx = R.createTreeIndex();
 s.looseLogs.push({id: 'log1', sourceId: 'tree1', position: [-2, .16, 5.6], quaternion: [0, 0, .7071067811865476, .7071067811865476], velocity: [0, 0, 0], angularVelocity: [0, 0, 0], heldBy: null, bornTick: 1, sleeping: true});
 assert.equal(R.logAction(s, p, {action: 'interact'}), null, 'interact with empty hands never collects'); p.position = [-2, 0, 9.5]; assert.equal(R.logAction(s, p, {action: 'grab', id: 'log1'}).code, 'out_of_reach');
 p.position = [-2, 0, 7.6]; assert.ok(R.logAction(s, p, {action: 'grab', id: 'log1'}).ok); R.stepTrees(s, ctx, idx, []); const l = s.looseLogs[0]; assert.ok(Math.abs(l.position[1] - 1.1) < 1e-9 && l.heldBy === 'p1', 'held rigidly, no lag');
 assert.equal(R.logAction(s, p, {action: 'strike'}).code, 'hands_full'); assert.ok(R.logAction(s, p, {action: 'release', throw: true, direction: [0, 0, -1]}).ok); assert.ok(l.velocity[2] < -7);
 for (let i = 0; i < 600 && !l.sleeping; i++) { s.tick++; R.stepTrees(s, ctx, idx, []); } assert.ok(l.sleeping, 'thrown log comes to rest'); assert.ok(Math.abs(l.position[1] - R.logSupport(l, ground)) < 1e-6);
 p.position = [l.position[0], 0, l.position[2] + 1.5]; assert.ok(R.logAction(s, p, {action: 'grab', id: 'log1'}).ok); assert.ok(R.logAction(s, p, {action: 'interact'}).ok); assert.equal(p.resources.wood, 1); assert.equal(s.looseLogs.length, 0); });
test('strict restore rejects bad logs / harvest', () => { const s = fresh(), ids = () => new Set(worldTrees(s).map(t => t.id)), base = {id: 'log1', sourceId: 'tree1', position: [0, 1, 0], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0], heldBy: null, bornTick: 1, sleeping: false};
 for (const bad of [{...base, id: 'x'}, {...base, sourceId: 'nope'}, {...base, quaternion: [0, 0, 0, 2]}, {...base, heldBy: 'ghost'}, {...base, extra: 1}, {...base, bornTick: 999}]) assert.throws(() => R.restoreLogs({...s, looseLogs: [bad]}, new Set()));
 assert.throws(() => R.restoreLogs({...s, looseLogs: Array(49).fill(base)}, new Set())); assert.equal(R.restoreLogs({...s, looseLogs: [base]}, new Set()).length, 1);
 for (const bad of [{id: 'tree1', cuts: 3, cutHeight: 1, felledTick: 0, fallYaw: 0}, {id: 'tree1', cuts: 1, cutHeight: 1, felledTick: 0, fallYaw: 0, landed: true}, {id: 'zz', cuts: 1, cutHeight: 1, felledTick: 0, fallYaw: 0}]) assert.throws(() => R.restoreHarvested({...s, harvestedTrees: [bad]}, ids())); });
test('character collision: indexed trunks, stump height, no canopy box', () => { const s = fresh(), idx = R.createTreeIndex(); idx.update(s); const t = tree1(s);
 assert.ok(idx.near(t.x, t.z).some(n => n.id === t.id)); assert.ok(idx.near(40, 40).length < idx.all().length); const p = R.resolveTrees([t.x + .1, 0, t.z], idx, new Map(), ground); assert.ok(Math.hypot(p[0]-t.x, p[2]-t.z) >= R.trunkRadius(t, .3) + .28 - 1e-6);
 const q = R.resolveTrees([t.x + 1.2, 0, t.z], idx, new Map(), ground); assert.deepEqual(q, [t.x + 1.2, 0, t.z], 'canopy does not block');
 const h = fell(s, t), cuts = new Map([[t.id, h]]); assert.deepEqual(R.resolveTrees([t.x + .1, 1.1, t.z], idx, cuts, ground), [t.x + .1, 1.1, t.z], 'standing on the stump is allowed'); });

// ---- Real authored geometry.
const kits = Object.fromEntries(['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod', 'log', 'endcap'].map(n => [n, loadGLB(art(n))]));
const uvMap = fitEndcapUV(kits.endcap.scene.getObjectByName('EndCapMesh') || kits.endcap.scene.children[0]);
const trunkOf = v => { const root = kits[v].scene.getObjectByName('Tree'), m = []; root.getObjectByName('Trunk').traverse(c => c.isMesh && m.push(c)); return {root, tris: bakeTriangles(m[0], root)}; };
test('assets: root Tree, required parts, trunk axis at origin, endcap UV fit', () => { for (const v of ['tree', 'tree_b', 'tree_young']) { const {root, tris} = trunkOf(v); for (const p of ['Trunk', 'Roots', 'Branches', 'Leaves', 'Fruit']) assert.ok(root.getObjectByName(p), `${v}.${p}`);
  const ring = tris.flat().filter(x => Math.abs(x.p[1] - 1) < .01); const cx = ring.reduce((a, x) => a + x.p[0], 0)/ring.length, cz = ring.reduce((a, x) => a + x.p[2], 0)/ring.length; assert.ok(Math.hypot(cx, cz) < .02, `${v} axis ${cx},${cz}`); }
 assert.ok(uvMap); const [u0, v0] = uvMap(0, 0), [u1] = uvMap(1, 0); assert.ok(Math.abs(u1 - u0) > .3, 'endcap UV disc spans the texture'); });
const geomReport = [];
for (const v of ['tree', 'tree_b', 'tree_young']) {
 const {tris} = trunkOf(v), base = audit(tris), prof = R.TREE_PROFILES[v], tree = {height: prof.height, variant: R.VARIANTS.indexOf(v), x: 0, z: 0};
 for (const [cuts, yaw, y] of [[1, .7, 1.0], [2, .7, 1.0], [2, -2.4, .55], [2, 3.0, 1.55]]) test(`${v}: notch cuts=${cuts} yaw=${yaw} y=${y} watertight, UV, normals, winding`, () => {
  const n = R.notchFor(tree, {cuts, cutHeight: y, fallYaw: yaw}, 0), res = buildNotch(tris, n, uvMap), all = [...res.bark, ...res.wood], a = audit(all);
  assert.ok(Math.abs(a.openLength - base.openLength) < 1e-6 && a.openMaxY < -.09, `only the buried bottom ring may stay open: ${a.openLength} vs ${base.openLength}, maxY ${a.openMaxY}`); assert.equal(a.flipped, base.flipped); assert.equal(a.missingUV + a.badNormal, 0);
  assert.ok(res.upper.length > 3 && res.lower.length > 3); const inner = Math.min(...res.bark.flat().filter(x => Math.abs(x.p[1] - n.height) < .02).map(x => x.p[0]*n.normal[0] + x.p[2]*n.normal[2]).filter(sv => sv > -1)); assert.ok(inner < n.radius, 'surface moved inward');
  const remaining = all.flat().filter(x => Math.abs(x.p[1] - n.height) < 1e-4).map(x => x.p[0]*n.normal[0] + x.p[2]*n.normal[2]); assert.ok(Math.max(...remaining) <= n.hinge + 1e-4, 'nothing remains in front of the hinge at the notch height');
  if (cuts === 2 && yaw === .7 && y === 1) geomReport.push(`${v} notch2: bark ${res.bark.length} tris (from ${tris.length}), wood ${res.wood.length} tris`); });
 test(`${v}: felled split exact height, 2 caps radius-correct, closed`, () => { const n = R.notchFor(tree, {cuts: 2, cutHeight: 1.0, fallYaw: .3}, 0), f = buildFelled(tris, n, uvMap);
  const st = audit([...f.stump.bark, ...f.stump.wood]), top = audit([...f.top.bark, ...f.top.wood]); assert.equal(st.flipped + top.flipped, 2*base.flipped); assert.equal(st.missingUV + top.missingUV + st.badNormal + top.badNormal, 0);
  assert.equal(top.open.length, 0, 'falling section is closed'); assert.ok(Math.abs(st.openLength - base.openLength) < 1e-6 && st.openMaxY < -.09, 'stump open only at the buried bottom');
  for (const cap of [f.caps.stump, f.caps.top]) { const ys = cap.flat().map(x => x.p[1]); assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-6 && Math.abs(ys[0] - n.height) < 1e-6); const rmax = Math.max(...cap.flat().map(x => Math.hypot(x.p[0], x.p[2]))); assert.ok(Math.abs(rmax/n.radius - 1) < .08, `cap radius ${rmax} vs ${n.radius}`); }
  assert.ok(Math.max(...f.stump.bark.flat().map(x => x.p[1])) <= n.height + 1e-6 && Math.min(...f.top.bark.flat().map(x => x.p[1])) >= n.height - 1e-6); });
}

test('headless view: placement by root origin, notch swap, fall pose, logs, LOD, targets, stats', () => {
 const templates = new Map(Object.entries(kits)), scene = new T.Scene(), camera = new T.PerspectiveCamera(); camera.position.set(-2, 1.7, 9); scene.add(camera); camera.updateMatrixWorld(true);
 const view = createTreeView({scene, templates, height: () => 0, camera}), s = fresh(); view.sync(s); view.tick(0, s.tick); let st = view.stats();
 assert.equal(st.trees, worldTrees(s).length); assert.deepEqual(st.missingAssets, []); assert.ok(st.lod > 0, 'distant trees use authored LOD');
 const t = tree1(s), rootM = view.batches.rootOf('tree1'), c = new T.Vector3().setFromMatrixPosition(rootM); assert.equal(view.entity('tree1'), null, 'intact trees are instanced, not entities'); // batching patch
 assert.ok(Math.hypot(c.x - t.x, c.z - t.z) < .05, 'trunk axis lands exactly on the tree position (no bounds recentre)');
 R.chopTree(s, t, hitPoint(t, 1), [0, 0, 1], {terrainHeight: () => 0}); view.sync(s); view.tick(10, s.tick); const e = view.entity('tree1'), trunk = e.full.byPart.Trunk[0], original = e.kit.parts.Trunk[0].geometry; assert.notEqual(trunk.geometry, original); assert.ok(e.root.position.equals(c), 'entity takes over at the instanced root'); assert.equal(view.stats().wounded, 1); assert.ok(view.stats().chips > 0, 'chips originate at the cut');
 scene.updateMatrixWorld(true); const ray = new T.Raycaster(new T.Vector3(t.x, 1, t.z + 3), new T.Vector3(0, 0, -1)); const hit = ray.intersectObjects(view.targets(), false)[0]; assert.ok(hit && view.surfaceVisible(hit)); assert.ok(hit.point.z - t.z < R.trunkRadius(t, 1) - .02, `ray enters the carved notch (hit at ${(hit.point.z - t.z).toFixed(3)})`);
 R.chopTree(s, t, hitPoint(t, 1), [0, 0, 1], {terrainHeight: () => 0}); R.chopTree(s, t, hitPoint(t, 1), [0, 0, 1], {terrainHeight: () => 0}); view.sync(s); const h = s.harvestedTrees[0];
 const lt = R.treeFall(t, h, h.felledTick, 0, ground).landTicks; view.tick(20, h.felledTick + lt - 5); assert.ok(e.felled && e.felled.pivot.quaternion.w < Math.cos(.5), 'section well into its hinge fall'); geomReport.push(`fall land ticks for tree1: ${lt}`); assert.equal(view.stats().felled, 1); assert.ok(!view.targets().some(m => m.userData.targetId === 'tree1'));
 const idx = R.createTreeIndex(); for (let i = 0; i < 400 && !h.landed; i++) { s.tick++; R.stepTrees(s, ctx, idx, []); } view.sync(s); view.tick(30, s.tick); st = view.stats(); assert.equal(st.logs, 3); assert.equal(st.falling, 0);
 const log = s.looseLogs[0], gt = view.grabTarget([log.position[0], log.position[1] + 1.5, log.position[2]], [0, -1, 0]); assert.equal(gt?.id, log.id); assert.equal(view.grabTarget([log.position[0], log.position[1] + 3, log.position[2]], [0, -1, 0]), null, '2.5 m limit');
 const late = createTreeView({scene: new T.Scene(), templates, height: () => 0}); late.sync(s); late.tick(0, s.tick); assert.equal(late.stats().chips, 0, 'late join: no replayed feedback'); assert.equal(late.stats().felled, 1);
 geomReport.push(`view stats: ${JSON.stringify(view.stats())}`); view.reload(); assert.equal(view.stats().trees, worldTrees(s).length); view.dispose(); late.dispose();
 const noKit = createTreeView({scene: new T.Scene(), templates: new Map([['endcap', kits.endcap]]), height: () => 0}); noKit.sync(s); assert.equal(noKit.stats().trees, 0, 'no fake fallback trees'); assert.ok(noKit.stats().missingAssets.includes('tree')); });

console.log(results.join('\n')); console.log(geomReport.join('\n')); console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`); process.exitCode = failed ? 1 : 0;
