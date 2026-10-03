import assert from 'node:assert/strict';
import * as T from 'three';
import {createTerrainRaycaster} from '../client/terrain-ray.js';
import {terrainHeight,createSunderRupture} from '../shared/terrain.js';
const started=performance.now(),geometry=new T.PlaneGeometry(120,120,160,160);geometry.rotateX(-Math.PI/2);
const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial()),threeRay=new T.Raycaster();mesh.updateMatrixWorld(true);
let state={edits:[],tick:0},calls=0;const fast=createTerrainRaycaster({height:(x,z)=>{calls++;return terrainHeight(state,x,z,false);}});
let checks=0,maxError=0;const timings=[];
assert.equal(createTerrainRaycaster({height:()=>NaN}).segment([0,10,0],[0,-10,0]),null);
assert.equal(fast.segment([1e308,0,0],[-1e308,0,0]),null);
function compare(from,to,{normal=true}={}){
 const d=new T.Vector3(...to).sub(new T.Vector3(...from)),length=d.length();threeRay.set(new T.Vector3(...from),d.normalize());threeRay.near=0;threeRay.far=length;
 const original=threeRay.intersectObject(mesh)[0]||null,hit=fast.segment(from,to);checks++;
 assert.equal(!!hit,!!original,JSON.stringify({from,to,hit,original:original?.point.toArray()}));
 if(hit){const error=new T.Vector3(...hit.point).distanceTo(original.point);maxError=Math.max(maxError,error);assert.ok(error<1e-6,'same exact first point');assert.ok(Math.abs(hit.distance-original.distance)<1e-6);if(normal)assert.ok(new T.Vector3(...hit.normal).distanceTo(original.face.normal)<1e-5,'same front-face normal');}
 assert.ok(fast.stats().lastCells<=323);
}
function rebuild(){const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,terrainHeight(state,p.getX(i),p.getZ(i),false));geometry.computeBoundingBox();geometry.computeBoundingSphere();fast.invalidateTerrain();}
const rupture=createSunderRupture('r',[-8,0,5],[8,0,5],0);
for(const phase of ['empty','many',0,24,60,92,12]){
 state={tick:typeof phase==='number'?phase:0,edits:phase==='empty'?[]:phase==='many'?Array.from({length:64},(_,i)=>({id:'e'+i,kind:i%2?'raise':'lower',x:i%8*3-12,z:Math.floor(i/8)*3-12,radius:6,height:i%2?2:-2})):Array.from({length:8},(_,i)=>({id:'r'+i,kind:'sunder',x:-8+16*i/7,z:5,radius:2.5,height:-1.5,rupture}))};rebuild();
 for(let i=0;i<160;i++){const x=Math.sin(i*18.71)*69,z=Math.cos(i*23.83)*69;compare([x,24,z],[x+Math.sin(i)*25,-9,z+Math.cos(i)*25]);}
 for(const x of [-60,-59.25,-.75,0,.75,59.25,60])for(const z of [-60,0,60])compare([x,30,z],[x,-20,z],{normal:false});
 compare([-70,30,-70],[70,-10,70],{normal:false});compare([60,30,60],[-60,-10,-60],{normal:false});
 compare([10,-30,10],[10,30,10]);compare([70,30,70],[70,-20,70]);compare([0,2,0],[0,2,0]);
 for(const a of [[0,NaN,0],[0,0],null])assert.equal(fast.segment(a,[0,0,0]),null);
}
// Cached grids update after in-place same-count edits and rewind, not only additions.
state={edits:[{id:'x',kind:'raise',x:5,z:5,radius:6,height:2}],tick:0};rebuild();const old=fast.segment([5,20,5],[5,-20,5]);state.edits[0].height=-2;rebuild();const changed=fast.segment([5,20,5],[5,-20,5]);assert.ok(changed.point[1]<old.point[1]-3);compare([5,20,5],[5,-20,5]);
// Repeated reads consume no new height queries; work scales with crossed cells.
state={edits:[],tick:0};rebuild();const from=[5,1,5],to=[5,1,4.825];fast.segment(from,to);const samples=calls;
for(const count of [1,10,100,500]){const t=performance.now();for(let i=0;i<count;i++)fast.segment(from,to);timings.push({count,elapsedMs:performance.now()-t});assert.equal(calls,samples);}
const baselineStart=performance.now();for(let i=0;i<100;i++){threeRay.set(new T.Vector3(...from),new T.Vector3(0,0,-1));threeRay.far=.175;threeRay.intersectObject(mesh);}const threeMs=(performance.now()-baselineStart)/100;
const fastStart=performance.now();for(let i=0;i<10000;i++)fast.segment(from,to);const fastMs=(performance.now()-fastStart)/10000;
assert.ok(fast.stats().vertexCapacity===161*161);geometry.dispose();mesh.material.dispose();
console.log(JSON.stringify({suite:'terrain-ray',checks,maxError,threeMeanMs:threeMs,gridMeanMs:fastMs,queryBatches:timings,stats:fast.stats(),elapsedSeconds:(performance.now()-started)/1000},null,2));
