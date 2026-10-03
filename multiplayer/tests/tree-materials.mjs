// Actual GLBs, shared surface/shadow ownership, promotion and scale invariants. No WebGL needed.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {createTreeMaterials} from '../client/tree-materials.js';
import {createTreeView} from '../client/tree-view.js';
import {createTreeBatches} from '../client/tree-batch.js';
import {worldTrees} from '../shared/world-content.js';
import {chopTree, trunkRadius} from '../shared/trees.js';
import {loadGLB} from './glb.mjs';
const t0 = performance.now(), results = [];
function test(name, f) { f(); results.push(name); }
const shader = kind => ({uniforms: {}, vertexShader: T.ShaderLib[kind].vertexShader, fragmentShader: T.ShaderLib[kind].fragmentShader});
const names = ['tree', 'tree_b', 'tree_young', 'tree_lod', 'tree_b_lod', 'tree_young_lod', 'endcap', 'log'];
const templates = new Map(names.map(n => [n, loadGLB(fileURLToPath(new URL(`../public/assets/${n}.glb`, import.meta.url)))]));
const state = () => ({seed: 7, tick: 100, groves: [], harvestedTrees: [], looseLogs: []});
const view = options => createTreeView({scene: new T.Scene(), templates, height: () => 0, ...options});
test('authored GLBs use orthogonal part matrices and common origin for stable bark/notch coordinates', () => {
 for (const [name, glb] of templates) {
  const root = glb.scene.getObjectByName('Tree'); if (!root) continue;
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert();
  root.traverse(o => { if (!o.isMesh) return; const m = inv.clone().multiply(o.matrixWorld), e = m.elements;
   const columns = [0, 4, 8].map(i => new T.Vector3(e[i], e[i+1], e[i+2]));
   assert.ok(Math.max(...columns.map(c => Math.abs(c.length() - 1))) < 1e-6, name);
   assert.ok(new T.Vector3().setFromMatrixPosition(m).length() < 1e-6, name);
  });
 }
});
test('templates remain untouched; cache shared by role; cutout shadows mirror masks and wind', () => {
 const mats = createTreeMaterials(), base = new T.MeshStandardMaterial({alphaTest: .4, map: new T.Texture(), alphaMap: new T.Texture()});
 const leaf = mats.material(base, 'leaf'), bark = mats.material(base, 'bark');
 assert.notEqual(leaf, base); assert.notEqual(leaf, bark); assert.equal(mats.material(base, 'leaf'), leaf); assert.equal(mats.material(leaf, 'leaf'), leaf);
 assert.equal(base.userData.treeMaterial, undefined); assert.equal(leaf.transparent, false); assert.equal(leaf.depthWrite, true);
 const mesh = mats.decorate(new T.Mesh(new T.BoxGeometry(), leaf));
 assert.equal(mesh.customDepthMaterial.alphaMap, base.alphaMap); assert.equal(mesh.customDistanceMaterial.alphaMap, base.alphaMap);
 const surface = shader('standard'), depth = shader('depth'), distance = shader('distance');
 leaf.onBeforeCompile(surface); mesh.customDepthMaterial.onBeforeCompile(depth); mesh.customDistanceMaterial.onBeforeCompile(distance);
 for (const s of [surface, depth, distance]) { assert.equal(s.uniforms.uTreeTime, mats.uniforms.uTreeTime); assert.match(s.vertexShader, /transpose\(mat3\(treeM\)\)/); }
 mats.update(3600.1); assert.equal(surface.uniforms.uTreeTime.value, 3600.1); mats.update(NaN); assert.equal(surface.uniforms.uTreeTime.value, 3600.1);
 assert.equal(bark.defines.TREE_SWAY, 0); assert.equal(bark.userData.treeDepth, undefined);
 let disposed = 0; for (const m of [leaf, bark, mesh.customDepthMaterial, mesh.customDistanceMaterial]) m.addEventListener('dispose', () => disposed++);
 mats.dispose(); mats.dispose(); assert.equal(disposed, 4); assert.equal(mats.stats().materials, 0);
 mesh.geometry.dispose(); base.map.dispose(); base.alphaMap.dispose(); base.dispose();
});
test('world-space wind conversion and inverse-transpose normals agree during nonuniform growth and fall', () => {
 for (const scale of [[.28,.2,.28], [.35,.74,.35], [.002,.002,.002], [1,1,1]]) for (const angle of [0,.03,1.5]) {
  const m = new T.Matrix4().compose(new T.Vector3(4,1,-9), new T.Quaternion().setFromEuler(new T.Euler(angle,.4,.1)), new T.Vector3(...scale)), e = m.elements;
  const cols = [0,4,8].map(i => new T.Vector3(e[i],e[i+1],e[i+2])), off = new T.Vector3(.07,.005,.021);
  const local = new T.Vector3(...cols.map(c => c.dot(off)/c.lengthSq()));
  const actual = local.clone().applyMatrix3(new T.Matrix3().setFromMatrix4(m)); assert.ok(actual.distanceTo(off)<1e-12);
  const n = new T.Vector3(1,1,1).normalize(), normal = n.clone().divide(new T.Vector3(...cols.map(c=>c.lengthSq()))).applyMatrix3(new T.Matrix3().setFromMatrix4(m)).normalize();
  assert.ok(normal.distanceTo(n.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(m)).normalize())<1e-12);
 }
});
test('batch growth and swap removal retain shared shadow materials and identity', () => {
 const mats = createTreeMaterials(), base = new T.MeshStandardMaterial(), g = new T.BoxGeometry(), group = new T.Group();
 const kit = mats.attach({parts:{Leaves:[{geometry:g, material:base, matrix:new T.Matrix4()}]}}), batches = createTreeBatches({group, minCapacity:1, decorate:mats.decorate});
 for (let i=0;i<500;i++) batches.place('t'+i,'tree','full',kit,new T.Matrix4().makeTranslation(i,0,0));
 batches.flush(); assert.equal(batches.meshes().length,1); assert.equal(mats.stats().materials,1);
 const mesh = batches.meshes()[0]; assert.equal(mesh.customDepthMaterial,kit.parts.Leaves[0].material.userData.treeDepth);
 batches.remove('t0'); assert.equal(batches.idOf({object:mesh,instanceId:0}),'t499'); assert.equal(mesh.count,499);
 batches.dispose(); assert.equal(mats.stats().materials,1); mats.dispose(); g.dispose(); base.dispose();
});
test('real trees preserve notch and fall materials; owned reload/disposal stays bounded', () => {
 const v = view(), s = state(); v.sync(s); v.tick(0,100); const before = v.stats().treeMaterials;
 const t = worldTrees(s)[0], ctx = {terrainHeight:()=>0};
 chopTree(s,t,[t.x+trunkRadius(t,1),1,t.z],[1,0,0],ctx); v.sync(s);
 const e = v.entity(t.id); assert.ok(e.wound); assert.equal(e.kit.trunkMaterial.userData.treeMaterial,'bark');
 assert.equal(e.full.byPart.Leaves[0].customDepthMaterial,e.full.byPart.Leaves[0].material.userData.treeDepth);
 for (let i=0;i<5&&!s.harvestedTrees[0].felledTick;i++) { s.tick+=30; chopTree(s,t,[t.x+trunkRadius(t,1),1,t.z],[1,0,0],ctx); }
 v.sync(s); v.tick(1000,s.tick+20); assert.ok(v.entity(t.id).felled);
 for (let i=0;i<4;i++) { v.reload(); assert.deepEqual(v.stats().treeMaterials,before); }
 v.dispose(); assert.equal(v.stats().treeMaterials.materials,0);
});
test('shared manager lifetime belongs to caller; zero wind and legacy fallback remain supported', () => {
 const mats = createTreeMaterials(), a=view({treeMaterials:mats}), b=view({treeMaterials:mats}); a.sync(state()); b.sync(state());
 const n=mats.stats().materials; a.dispose(); assert.equal(mats.stats().materials,n); b.reload(); b.dispose(); assert.equal(mats.stats().materials,n); mats.dispose();
 const still = view({windAmplitude:0}); still.sync(state()); const leaf=still.batches.meshes().find(m=>m.userData.part==='Leaves'), s=shader('standard');
 leaf.material.onBeforeCompile(s); assert.equal(s.uniforms.uTreeWindStrength.value,0); still.dispose();
 const old=view({treeMaterials:false}); old.sync(state()); assert.equal(old.stats().treeMaterials,null); old.dispose();
});
console.log(JSON.stringify({suite:'tree-materials',passed:results.length,checks:results,seconds:(performance.now()-t0)/1000}));
