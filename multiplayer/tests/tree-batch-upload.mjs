// Exercise Three's real upload scheduler against an in-memory GL buffer. CPU
// matrices alone cannot detect a standing ghost left in a stale GPU instance.
import assert from 'node:assert/strict';
import * as T from 'three';
import {WebGLAttributes} from 'three/src/renderers/webgl/WebGLAttributes.js';
import {createTreeBatches} from '../client/tree-batch.js';
import {createTreeView} from '../client/tree-view.js';
import {worldTrees} from '../shared/world-content.js';
import {loadGLB} from './glb.mjs';

const started = performance.now();
let bound, uploaded = 0;
const gl = {FLOAT: 5126, createBuffer: () => ({}), bindBuffer: (_target, b) => {bound = b;},
 bufferData: (_target, data) => {bound.data = data.slice();},
 bufferSubData: (_target, offset, data, start = 0, count = data.length) => {
  bound.data.set(data.subarray(start, start + count), offset / data.BYTES_PER_ELEMENT); uploaded += count;
 }, deleteBuffer() {}};
const gpu = WebGLAttributes(gl), group = new T.Group();
const geometry = new T.BoxGeometry(.4, 2, .4), material = new T.MeshBasicMaterial();
const kit = {parts: {Trunk: [{geometry, material, matrix: new T.Matrix4()}], Leaves: [{geometry, material, matrix: new T.Matrix4().makeTranslation(0, 2, 0)}]}};
const batches = createTreeBatches({group, minCapacity: 4});
const put = (id, x, level = 'full') => batches.place(id, 'oak', level, kit, new T.Matrix4().makeTranslation(x, 0, 0));
function render(collection = batches) {for (const mesh of collection.meshes()) if (mesh.count) gpu.update(mesh.instanceMatrix, 34962);}
function coherent(label, collection = batches) {
 for (const b of collection.batches()) for (const mesh of b.meshes) if (mesh.count) {
  const actual = gpu.get(mesh.instanceMatrix).buffer.data;
  assert.deepEqual(actual.slice(0, mesh.count * 16), mesh.instanceMatrix.array.slice(0, mesh.count * 16), label + ': GPU and interaction positions disagree');
  for (let slot = 0; slot < b.ids.length; slot++) assert.equal(collection.idOf({object:mesh, instanceId:slot}), b.ids[slot]);
 }
}
for (let i = 0; i < 4; i++) put('tree' + i, i * 4);
batches.flush(); render(); coherent('initial forest');

// Harvest promotes tree0 out of the intact batch: tree3 fills its slot. A second
// snapshot/growth flush changes tree1 before render. Neither change may be lost.
batches.remove('tree0'); batches.flush();
put('tree1', 6); batches.flush(); render(); coherent('chop followed by growth');
assert.equal(batches.has('tree0'), false);
assert.equal(gpu.get(batches.targets()[0].instanceMatrix).buffer.data[12], 12, 'no standing instance left at the chopped tree origin');

// LOD movement and multiple harvests in one frame also swap slots before upload.
put('tree3', 12, 'lod'); batches.flush();
batches.remove('tree1'); batches.flush(); render(); coherent('LOD and second chop');
for (let i = 4; i < 12; i++) {put('tree' + i, i * 4); batches.flush();}
render(); coherent('capacity growth');

// Culled/offscreen batches may miss many renders. Pending ranges stay bounded
// while retaining every changed slot until the renderer actually consumes them.
for (let i = 0; i < 300; i++) {put('tree' + (4 + i % 8), i + 20); batches.flush();}
for (const mesh of batches.meshes()) assert.ok(mesh.instanceMatrix.updateRanges.length <= 1, 'bounded pending upload ranges');
render(); coherent('offscreen deferred updates');
uploaded = 0; put('tree4', 900); batches.flush(); render(); coherent('single next-frame update');
assert.equal(uploaded, 32, 'only one matrix per authored part uploaded after acknowledgement');
batches.clear(); geometry.dispose(); material.dispose();

// Run the actual authored forest through consecutive harvest snapshots without
// an intervening render, then finish the falls and restore a late-join view.
const names = ['tree','tree_b','tree_young','tree_lod','tree_b_lod','tree_young_lod','log','endcap'];
const templates = new Map(names.map(name => [name, loadGLB(new URL('../public/assets/' + name + '.glb', import.meta.url))]));
const state = {seed:41, tick:100, edits:[], groves:[], harvestedTrees:[], looseLogs:[], enemies:[]};
const view = createTreeView({scene:new T.Scene(), templates, height:()=>0});
view.sync(state); view.tick(1000, state.tick); render(view.batches);
const cutTrees = worldTrees(state).filter(t=>t.variant===0).slice(0,2);
for (const tree of cutTrees) {
 state.harvestedTrees.push({id:tree.id,cuts:1,cutHeight:1,fallYaw:0,felledTick:0,landed:false});
 view.sync(state);
}
render(view.batches); coherent('authored forest consecutive chops', view.batches);
for (const tree of cutTrees) {assert.ok(view.entity(tree.id)?.wound); assert.equal(view.batches.has(tree.id),false);}
for (const cut of state.harvestedTrees) {cut.cuts=3;cut.felledTick=100;cut.landed=true;}
state.tick=400;view.sync(state);view.tick(6000,400);render(view.batches);coherent('landed forest',view.batches);
for(const tree of cutTrees){assert.equal(view.entity(tree.id).felled.pivot.visible,false);assert.equal(view.batches.has(tree.id),false);}
view.reload(templates);view.tick(6016,400);render(view.batches);coherent('late loaded forest',view.batches);
for(const tree of cutTrees)assert.equal(view.batches.has(tree.id),false);
view.dispose();
console.log(JSON.stringify({cases:9, elapsedMs:performance.now()-started, result:'tree upload state matches interaction state, including authored harvest and reload'}));
