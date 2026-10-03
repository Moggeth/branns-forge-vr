import assert from 'node:assert/strict';
import * as T from 'three';
import {terrainHeight,rawTerrainHeight,TERRAIN_GRID} from '../shared/terrain.js';
const started=performance.now();
const geometry=new T.PlaneGeometry(120,120,160,160);geometry.rotateX(-Math.PI/2);
const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial()),ray=new T.Raycaster();mesh.updateMatrixWorld(true);
const variants=[[],[{kind:'raise',x:10.11,z:8.37,radius:6,height:2}],[{kind:'lower',x:10.11,z:8.37,radius:6,height:-2}],Array.from({length:7},(_,i)=>({kind:'pick_wall',x:10+.075*i*i,z:9.1-.8*i,radius:1,height:2.4})),Array.from({length:64},(_,i)=>({kind:'axe_sunder',x:10+i%3*.1,z:8,radius:1.35,height:-.12}))];
let maxError=0,queries=0;
for(const edits of variants) {
 const state={edits};
 const positions=geometry.attributes.position;
 // Exactly the renderer's current sampling path, including Float32 GPU positions.
 for(let i=0;i<positions.count;i++)positions.setY(i,terrainHeight(state,positions.getX(i),positions.getZ(i),false));
 geometry.computeBoundingSphere();geometry.computeBoundingBox();
 const points=[[0,0],[55,55],[-55,-55],[47.37,-23.71],[10,9.1],[10.31,8.47],[11.071,7.27],[-60,-60],[60,60]];
 for(let i=0;i<35;i++)points.push([8+((i*613)%130)/23,3+((i*397)%140)/19]);
 for(const [x,z] of points){ray.set(new T.Vector3(x,100,z),new T.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit,`mesh hit ${x},${z}`);const expected=terrainHeight(state,x,z,false),error=Math.abs(hit.point.y-expected);maxError=Math.max(maxError,error);assert.ok(error<1e-6,`triangle mismatch ${error} at ${x},${z}`);queries++;}
}
// Mutable edits of the same count must immediately change results (no stale cache).
const mutable={edits:[{kind:'raise',x:10,z:8,radius:6,height:2}]};const before=terrainHeight(mutable,10.3,8.2);mutable.edits[0].height=-2;assert.ok(terrainHeight(mutable,10.3,8.2)<before-3);
mutable.edits[0]={kind:'pick_wall',x:10.3,z:8.2,radius:1,height:2.4};assert.ok(terrainHeight(mutable,10.3,8.2)>before-1);
// Renderer vertices remain identical to analytic authoring; interpolation changes support between them only.
for(const [x,z] of [[0,0],[.75,0],[-59.25,54.75]])assert.equal(terrainHeight(mutable,x,z,false),Math.fround(rawTerrainHeight(mutable,x,z)));
const worst={edits:Array.from({length:64},(_,i)=>({kind:i%2?'lower':'raise',x:i%8*4-14,z:Math.floor(i/8)*4-14,radius:6,height:i%2?-2:2}))};
const start=performance.now();let sum=0;for(let i=0;i<10000;i++)sum+=terrainHeight(worst,(i*613%1000)/23-20,(i*397%1000)/23-20);
const elapsed=performance.now()-start;
assert.ok(Number.isFinite(sum));mesh.material.dispose();geometry.dispose();
console.log(JSON.stringify({suite:'terrain-triangles',pass:true,grid:TERRAIN_GRID,queries,maxError,uncachedWorst64Edits10000QueriesMs:elapsed,elapsedSeconds:(performance.now()-started)/1000}));
