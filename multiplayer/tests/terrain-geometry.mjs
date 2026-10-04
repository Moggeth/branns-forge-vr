import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTerrainGeometryUpdater} from '../client/terrain-geometry.js';
import {terrainHeight,terrainRenderVertex,terrainDirtyEdits,createSunderRupture} from '../shared/terrain.js';
const begin=performance.now(),grid=()=>new THREE.PlaneGeometry(120,120,160,160).rotateX(-Math.PI/2);
const actual=grid(),expected=grid(),updater=createTerrainGeometryUpdater(actual);
let previous={edits:[],tick:0},compared=0;
function same(a,b,message='grid equality'){assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))assert.fail(`${message} component ${i}: ${a[i]} != ${b[i]}`);}
function oracle(geometry,state,dirty=null){
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);if(!dirty||dirty.some(e=>Math.hypot(x-e.x,z-e.z)<=e.radius+.75))p.setY(i,terrainRenderVertex(state,x,z,false,terrainHeight(state,x,z,false)));}
  p.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
}
function check(state,full=false){
  const dirty=full?null:terrainDirtyEdits(previous.edits,state.edits,previous.tick,state.tick);
  updater.update((x,z)=>terrainRenderVertex(state,x,z,false,terrainHeight(state,x,z,false)),dirty);oracle(expected,state,dirty);
  same(actual.attributes.position.array,expected.attributes.position.array,'positions match original grid exactly');
  same(actual.attributes.normal.array,expected.attributes.normal.array,'normals match full Three recomputation exactly');
  assert.deepEqual(actual.boundingBox,expected.boundingBox);assert.deepEqual(actual.boundingSphere,expected.boundingSphere);
  previous=structuredClone(state);compared++;
}
check(previous,true);
const edits=Array.from({length:8},(_,i)=>({id:`e${i}`,kind:'raise',x:i*2-5,z:i%2*3-2,radius:2+i%3,height:i%2?-2:3}));
check({edits,tick:1});check({edits:edits.map((e,i)=>i===2?{...e,x:e.x+5,height:4}:e),tick:2});
check({edits:previous.edits.slice(1),tick:3});check({edits:[],tick:4});
for(const x of [-60,60])for(const z of [-60,60])check({edits:[{id:'edge',kind:'raise',x,z,radius:3,height:2}],tick:5});
const rupture=createSunderRupture('r',[0,0],[16,0],10);
for(let tick=10;tick<130;tick+=3)check({edits:[{id:'rupture',kind:'sunder',x:8,z:0,radius:4,height:-2,rupture}],tick});
// Foundations and baked terrain intentionally request a full refresh. An empty
// edit set must also clear old earthworks, rather than leave stale normals.
check({tick:150,edits:[],inventions:{structures:[{id:'f',type:'foundation',hp:100,position:[0,1,0]}]}},true);
check({tick:151,edits:[]},true);
check({tick:152,edits:[{id:'wide',kind:'raise',x:0,z:0,radius:65,height:2}]});
assert.equal(updater.stats().normals,actual.attributes.normal.count,'dense changes use full normal pass');
check({tick:153,edits:[]},true);
check({tick:154,edits:[{id:'small',kind:'raise',x:1,z:1,radius:2,height:2}]});
assert.equal(actual.attributes.position.updateRanges.length,0,'full pending upload must not become partial before render');
assert.equal(actual.attributes.normal.updateRanges.length,0);
// Multiple snapshots before a GPU upload must preserve every pending dirty run.
actual.attributes.position.onUploadCallback();actual.attributes.normal.onUploadCallback();actual.attributes.position.clearUpdateRanges();actual.attributes.normal.clearUpdateRanges();
check({tick:160,edits:[{id:'a',kind:'raise',x:-30,z:-30,radius:2,height:2}]});
const pending=actual.attributes.position.updateRanges.map(r=>({...r}));
check({tick:161,edits:[...previous.edits,{id:'b',kind:'raise',x:30,z:30,radius:2,height:2}]});
for(const range of pending)assert.ok(actual.attributes.position.updateRanges.some(r=>r.start===range.start&&r.count===range.count),'retain earlier snapshots until render upload');
const v=actual.attributes.position.version;check(previous);assert.equal(actual.attributes.position.version,v,'no upload for unchanged terrain');
// Representative local rising/sinking earthwork. Timings are observations, not
// hardware-dependent pass gates; geometry, samples and upload volume are gates.
const states=Array.from({length:60},(_,i)=>({tick:i,edits:[{id:'bench',kind:'raise',x:4,z:3,radius:3,height:Math.sin(i*.1)*3}]}));
function bench(f){const times=[];for(let pass=0;pass<2;pass++)for(const state of states){const t=performance.now();f(state);times.push(performance.now()-t);}times.sort((a,b)=>a-b);return {meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)]};}
const old=grid(),fast=grid(),edit=createTerrainGeometryUpdater(fast);edit.update((x,z)=>terrainRenderVertex({edits:[]},x,z,false));oracle(old,{edits:[]});fast.attributes.position.onUploadCallback();fast.attributes.normal.onUploadCallback();
const before=bench(s=>oracle(old,s,s.edits)),after=bench(s=>{edit.update((x,z)=>terrainRenderVertex(s,x,z,false,terrainHeight(s,x,z,false)),s.edits);fast.attributes.position.clearUpdateRanges();fast.attributes.normal.clearUpdateRanges();});
same(old.attributes.position.array,fast.attributes.position.array);same(old.attributes.normal.array,fast.attributes.normal.array);
assert.ok(edit.stats().sampled<200);assert.ok(edit.stats().normals<200);
console.log(JSON.stringify({comparisons:compared,vertices:actual.attributes.position.count,before,after,lastLocalUpdate:edit.stats(),elapsedMs:performance.now()-begin}));
actual.dispose();expected.dispose();old.dispose();fast.dispose();
