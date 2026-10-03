import assert from 'node:assert/strict';
import * as T from 'three';
import {loadGLB} from './glb.mjs';
import {createWorldContent} from '../client/world-content-view.js';
import {createCrystalWall} from '../client/crystal-wall.js';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
const begin=performance.now();
const height=(x,z,edits=[])=>terrainHeight({edits},x,z,false);
const scene=new T.Scene(),templates=new Map(['boulder','meteor'].map(n=>[n,loadGLB(new URL(`../public/assets/${n}.glb`,import.meta.url))]));
const content=createWorldContent({scene,templates,height});
let sim=createSimulation();sim.addPlayer({id:'hero'});let c=sim.checkpoint();c.players[0].position=[10,height(10,10),10];c.players[0].tool='pick';sim=loadSimulation(c);
assert.equal(sim.command('hero',{type:'action',action:'special',seq:1}).ok,true);
const snapshot=sim.snapshot();content.sync(snapshot);content.tick(0);
const wallBudget=content.stats().crystalWalls;assert.equal(wallBudget.segments,7);assert.equal(wallBudget.draws,28);
const wallDeposits=snapshot.deposits.filter(d=>d.special==='pick_wall');
assert.equal(content.targets().filter(n=>wallDeposits.some(d=>n.userData.targetId===d.id)).length,7);
scene.updateMatrixWorld(true);
for(const d of wallDeposits){const target=content.targets().find(n=>n.userData.targetId===d.id),floor=height(d.x,d.z,snapshot.edits);let top=-Infinity;
 target.traverse(m=>{if(!m.isMesh)return;const a=m.geometry.attributes.position;for(let j=0;j<(m.isInstancedMesh?m.count:1);j++){const matrix=m.matrixWorld.clone();if(m.isInstancedMesh){const instance=new T.Matrix4();m.getMatrixAt(j,instance);matrix.multiply(instance);}for(let i=0;i<a.count;i++){const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(matrix);top=Math.max(top,p.y);assert.ok(Math.hypot(p.x-d.x,p.z-d.z)<1.5,'crystal stays inside authority horizontal contact envelope');}}});
 assert.ok(top>floor+.1&&top<floor+2,'crystal tip remains exposed and mineable');
}
const ray=new T.Raycaster();
const first=wallDeposits[0],group=content.targets().find(n=>n.userData.targetId===first.id);
ray.set(new T.Vector3(first.x,height(first.x,first.z,snapshot.edits)+3,first.z),new T.Vector3(0,-1,0));
const wallHit=ray.intersectObject(group,true)[0];assert.ok(wallHit);assert.equal(content.resolveTarget(wallHit).id,first.id);
// Live damage removes actual crystals, snapshots alone recreate their exact surviving geometry.
const damaged=structuredClone(snapshot);damaged.deposits.find(d=>d.id===first.id).hits=2;content.sync(damaged);content.tick(700);
assert.equal(content.stats().crystalWalls.crystals,57);assert.equal(content.targets().flatMap(g=>g.children).filter(m=>m.name.startsWith('CrystalBatch_')).reduce((n,m)=>n+m.count,0),57);
const compare=new T.Scene(),late=createCrystalWall({THREE:T,scene:compare,height});late.sync(damaged);assert.equal(late.stats().debris,0);
const liveNames=group.children.map(n=>n.name),lateNames=late.targets()[0].children.map(n=>n.name);assert.deepEqual(liveNames,lateNames);
// The same deposit can be restored to an earlier checkpoint without keeping hidden damage.
content.sync(snapshot);assert.equal(content.stats().crystalWalls.crystals,63);
// Reanchor existing geometry after terrain changes, and collapse it on the authoritative edit removal.
const raised=structuredClone(snapshot);raised.edits.push({id:'raiseTest',kind:'raise',x:first.x,z:first.z,radius:6,height:2});
const before=content.targets().find(n=>n.userData.targetId===first.id).position.y;content.sync(raised);
assert.ok(content.targets().find(n=>n.userData.targetId===first.id).position.y>before+1.9);
raised.deposits.find(d=>d.id===first.id).depleted=true;raised.edits=raised.edits.filter(e=>e.id!==first.editId);content.sync(raised);
assert.ok(!content.targets().some(n=>n.userData.targetId===first.id));

// Real imported boulder and meteor meshes lose cells, preserving scale/materials and honest ray hits.
for(const kind of ['stone','meteor']) {
 const id=`test_${kind}`,base={...snapshot,edits:[],deposits:[{id,kind,x:10,z:10,hits:0,maxHits:kind==='stone'?3:5,depleted:false}]};content.sync(base);
 const original=content.targets().find(n=>n.userData.targetId===id),scale=original.scale.toArray(),materials=[];original.traverse(n=>{if(n.isMesh)materials.push([n.material.uuid,n.material.version]);});
 const expectedBounds=new T.Box3().setFromObject(original);
 const centre=expectedBounds.getCenter(new T.Vector3()),radius=expectedBounds.getSize(new T.Vector3()).length();scene.updateMatrixWorld(true);
 const shoot=i=>{const y=1-2*(i+.5)/100,r=Math.sqrt(1-y*y),a=i*2.39996,d=new T.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);ray.set(centre.clone().addScaledVector(d,radius),d.negate());return ray.intersectObject(original,true)[0];};
 const intactDepth=Array.from({length:100},(_,i)=>shoot(i).distance);
 const hitState=structuredClone(base);hitState.deposits[0].hits=1;content.sync(hitState);content.tick(1000);scene.updateMatrixWorld(true);
 const fracture=content.stats().fractures[0];assert.ok(fracture.removed>=2);assert.deepEqual(original.scale.toArray(),scale);
 let recessed=0;
 for(let i=0;i<100;i++){const y=1-2*(i+.5)/100,r=Math.sqrt(1-y*y),a=i*2.39996,d=new T.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);ray.set(centre.clone().addScaledVector(d,radius),d.negate());const hit=ray.intersectObject(original,true)[0];assert.ok(hit);if(hit.distance>intactDepth[i]+.01)recessed++;assert.equal(content.resolveTarget(hit).id,id);assert.equal(hit.object.visible,true);assert.notEqual(hit.object.userData.fractureHidden,true);}
 assert.ok(recessed>=5,'removed chunks expose deeper physical crater surfaces');
 const retained=[];original.traverse(n=>{if(n.isMesh&&n.userData.fractureHidden)retained.push([n.material.uuid,n.material.version]);});assert.deepEqual(retained,materials);
 // Restoring an old checkpoint rebuilds intact geometry rather than retaining removed cells.
 content.sync(base);assert.equal(content.stats().fractures.length,0);
 // Late join at damage starts in the final damaged shape without invented flying chips.
 const other=createWorldContent({scene:new T.Scene(),templates,height});other.sync(hitState);assert.equal(other.stats().fractures[0].chips,0);other.dispose();
}
late.dispose();content.dispose();assert.ok(!scene.children.some(n=>/CrystalWall/.test(n.name)));
console.log(JSON.stringify({suite:'mining-geometry',passed:true,checks:'actual GLB fracture, raycasts, crystal envelope, damage/reload/collapse',wallBudget,elapsedSeconds:(performance.now()-begin)/1000}));
