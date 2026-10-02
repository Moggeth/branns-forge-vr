// node tests/meteor-creature.test.mjs   (no installs: uses existing multiplayer three)
import assert from 'node:assert/strict';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const THREE = await import(pathToFileURL(path.resolve(here, '../node_modules/three/build/three.module.js')).href);
const {createMeteorCreaturePresentation, unfurlWeights, meteorAge, METEOR_TIMELINE} = await import(pathToFileURL(path.resolve(here, '../client/meteor-creature.js')).href);

// Fixture mirroring golem.glb / meteor.glb node + material names (verified from GLB JSON).
const mat = name => { const m = new THREE.MeshStandardMaterial({color: 0x888888}); m.name = name; return m; };
const box = (name, m, y = 0) => { const g = new THREE.BoxGeometry(.4, .6, .4); g.translate(0, y, 0); const mesh = new THREE.Mesh(g, m); mesh.name = name; return mesh; };
function golemTemplate() {
  const M = {main: mat('Stone_Main'), dark: mat('Stone_Dark'), glow: mat('Glow'), moss: mat('Moss')};
  const golem = new THREE.Group(); golem.name = 'Golem';
  const node = (name, pos, ...kids) => { const n = new THREE.Group(); n.name = name; n.position.set(...pos); kids.forEach(k => n.add(k)); return n; };
  const elbowL = node('ElbowL', [0, -.5, 0], box('ForearmL', M.dark, -.3)), elbowR = node('ElbowR', [0, -.5, 0], box('ForearmR', M.dark, -.3));
  golem.add(node('ArmL', [-.7, 2.0, 0], box('UpperArmL', M.main, -.25), elbowL), node('ArmR', [.7, 2.0, 0], box('UpperArmR', M.main, -.25), elbowR));
  golem.add(node('BodyCore', [0, 1.6, 0], box('BodyCoreMesh', M.main), box('CoreGlow', M.glow), box('ChestPlate', M.moss)));
  golem.add(node('Head', [0, 2.3, 0], box('HeadMesh', M.main, .2)), node('LegL', [-.3, .9, 0], box('LegLMesh', M.dark, -.45)), node('LegR', [.3, .9, 0], box('LegRMesh', M.dark, -.45)));
  const scene = new THREE.Group(); scene.add(golem); return {scene, animations: [], M};
}
function meteorTemplate() {
  const g = new THREE.Group(); g.name = 'Meteor';
  for (const n of ['GeoRock', 'GeoInterior', 'GeoStarGem', 'GeoSeam']) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(n === 'GeoStarGem' ? .2 : 1), mat(n)); g.add(m); }
  return {scene: g, animations: []};
}
function actor(template, data) {
  const root = new THREE.Group(), visual = new THREE.Group(), model = template.scene.clone(true);
  visual.add(model); root.add(visual); root.position.set(4, 0, -2); root.rotation.y = .7;
  const scene = new THREE.Scene(); scene.add(root); scene.updateMatrixWorld(true);
  return {root, visual, data, enemy: true, scene};
}
const snapshotPose = v => { const out = []; v.traverse(n => out.push(n.name, ...n.quaternion.toArray(), ...n.position.toArray())); return out.map(x => typeof x === 'number' ? +x.toFixed(9) : x).join(','); };
const draws = root => { let n = 0; root.traverse(o => { if ((o.isMesh) && o.visible && (function vis(x) { for (; x; x = x.parent) if (!x.visible) return false; return true; })(o)) n++; }); return n; };

const golem = golemTemplate(), meteor = meteorTemplate();
const P = createMeteorCreaturePresentation({THREE, assets: {golem, meteor}});
let failures = 0; const test = (name, fn) => { try { fn(); console.log('ok', name); } catch (e) { failures++; console.error('FAIL', name, e.message); } };

test('ordinary golem untouched', () => {
  const e = actor(golem, {id: 'g1', kind: 'golem'}); const before = snapshotPose(e.visual), drawsBefore = draws(e.root);
  assert.equal(P.apply(e, 100), null); assert.equal(snapshotPose(e.visual), before); assert.equal(draws(e.root), drawsBefore);
  e.visual.traverse(n => { if (n.isMesh) assert.ok(!n.material.name.includes('meteor')); });
});

test('unfurl timeline: sealed -> unfurling -> mature, weights monotone-ish to 0', () => {
  assert.equal(unfurlWeights(0).arms, 1); assert.equal(unfurlWeights(METEOR_TIMELINE.unfurlEnd).arms, 0);
  assert.ok(Math.abs(unfurlWeights(5).body) < 1e-9);
  assert.equal(meteorAge({meteorBorn: true, unfurlTick: 600}, 660), 1);
});

test('meteor golem: <=4 extra draws, decorations outside combat visual, bone hierarchy intact', () => {
  const e = actor(golem, {id: 'm1', kind: 'golem', meteorBorn: true, unfurlTick: 1000});
  const base = draws(e.visual), parents = []; e.visual.traverse(n => parents.push(n.name + '<' + n.parent?.name));
  for (let t = 1000; t <= 1000 + 60 * 4; t += 3) {
    P.beforeMotion(e); const r = P.apply(e, t);
    assert.ok(P.extraDrawCount(e) <= 4, `draws ${P.extraDrawCount(e)} at ${t}`);
    assert.equal(draws(e.root) - base, P.extraDrawCount(e));
    if (t === 1000) assert.equal(r.phase, 'sealed');
  }
  const after = []; e.visual.traverse(n => after.push(n.name + '<' + n.parent?.name)); assert.deepEqual(after, parents);
  e.visual.traverse(n => assert.ok(!n.userData.meteorDecor, 'decor under combat visual'));
  for (const d of P.records.get(e).decor) assert.equal(d.userData.ignoreCombat, true);
});

test('pose layer is undoable and leaves no drift (enemy-motion restore contract)', () => {
  const e = actor(golem, {id: 'm2', kind: 'golem', meteorBorn: true, unfurlTick: 0});
  const rest = snapshotPose(e.visual);
  P.beforeMotion(e); P.apply(e, 30); assert.notEqual(snapshotPose(e.visual), rest, 'tucked');
  P.beforeMotion(e); assert.equal(snapshotPose(e.visual), rest, 'beforeMotion restores exact base');
  for (let t = 30; t < 400; t++) { P.beforeMotion(e); P.apply(e, t); }
  P.beforeMotion(e); assert.equal(snapshotPose(e.visual), rest, 'mature pose == ordinary golem pose');
  P.apply(e, 400); assert.equal(snapshotPose(e.visual), rest, 'mature apply writes no pose');
});

test('late join at authoritative tick does not replay', () => {
  const e = actor(golem, {id: 'm3', kind: 'golem', meteorBorn: true, unfurlTick: 100});
  const rest = snapshotPose(e.visual); const r = P.apply(e, 100 + 60 * 30);
  assert.equal(r.phase, 'mature'); assert.equal(snapshotPose(e.visual), rest);
  const rec = P.records.get(e); assert.equal(rec.shell.visible, false); assert.equal(rec.shards.visible, false); assert.equal(rec.crystals.visible, true);
  assert.equal(P.extraDrawCount(e), 1);
  e.visual.traverse(n => { if (n.isMesh) assert.ok(n.material.name.includes('meteor-mature'), n.name); });
});

test('shared materials across creatures, no per-frame allocation', () => {
  const a = actor(golem, {id: 'a', kind: 'golem', meteorBorn: true, unfurlTick: 0}), b = actor(golem, {id: 'b', kind: 'golem', meteorBorn: true, unfurlTick: 0});
  P.apply(a, 10); P.apply(b, 20);
  assert.equal(a.visual.getObjectByName('BodyCoreMesh').material, b.visual.getObjectByName('BodyCoreMesh').material);
  const origClone = THREE.Material.prototype.clone; let clones = 0; THREE.Material.prototype.clone = function () { clones++; return origClone.call(this); };
  const origQ = THREE.Quaternion; let geo = 0; const origGeo = THREE.BufferGeometry.prototype.clone; THREE.BufferGeometry.prototype.clone = function () { geo++; return origGeo.call(this); };
  for (let t = 20; t < 200; t++) { P.beforeMotion(a); P.apply(a, t); P.beforeMotion(b); P.apply(b, t + 7); }
  THREE.Material.prototype.clone = origClone; THREE.BufferGeometry.prototype.clone = origGeo;
  assert.equal(clones, 0); assert.equal(geo, 0); void origQ;
  // Template materials never mutated.
  for (const m of Object.values(golem.M)) assert.equal(m.color.getHex(), 0x888888);
});

test('remove restores original materials and detaches decor; visual swap reattaches', () => {
  const e = actor(golem, {id: 'r', kind: 'golem', meteorBorn: true, unfurlTick: 0});
  P.apply(e, 30); const rec = P.records.get(e);
  e.visual = e.visual.clone(true); P.apply(e, 31); assert.notEqual(P.records.get(e), rec, 'reattached to new visual');
  assert.equal(rec.shell.parent, null);
  P.remove(e); assert.equal(e.root.children.filter(c => c.userData.meteorDecor).length, 0);
  e.visual.traverse(n => { if (n.isMesh) assert.ok(!n.material.name.includes('meteor')); });
});

P.dispose();
console.log(failures ? `${failures} FAILED` : 'all meteor-creature tests passed');
process.exit(failures ? 1 : 0);
