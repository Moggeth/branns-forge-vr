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
for(let i=0;i<90;i++)sim.step();// the v2 wall rises behind its front; settle before measuring
const snapshot=sim.snapshot();content.sync(snapshot);content.tick(0,snapshot.tick);
const wallBudget=content.stats().crystalWalls;assert.equal(wallBudget.segments,7);assert.ok(wallBudget.draws>=4&&wallBudget.draws<=6,'crystal batches in use + ore batch + crust + glow strip per wall');
const wallDeposits=snapshot.deposits.filter(d=>d.special==='pick_wall');
const instancesOf=id=>content.targets().filter(n=>n.userData.wallTargets).flatMap(m=>m.userData.wallTargets.map((t,i)=>t===id?{m,i}:null).filter(Boolean));
for(const d of wallDeposits)assert.ok(instancesOf(d.id).length>0,'every segment has tagged instances');
scene.updateMatrixWorld(true);
for(const d of wallDeposits){const floor=height(d.x,d.z,snapshot.edits);let top=-Infinity;
 for(const {m,i} of instancesOf(d.id)){if(m.name==='CrystalCrust')continue;const a=m.geometry.attributes.position,matrix=m.matrixWorld.clone(),instance=new T.Matrix4();m.getMatrixAt(i,instance);matrix.multiply(instance);
  for(let k=0;k<a.count;k++){const p=new T.Vector3().fromBufferAttribute(a,k).applyMatrix4(matrix);top=Math.max(top,p.y);assert.ok(Math.hypot(p.x-d.x,p.z-d.z)<1.9,'crystal stays inside its segment envelope');}}
 assert.ok(top>floor+.1&&top<floor+2.3,'crystal tip remains exposed and mineable');
}
const ray=new T.Raycaster();
const first=wallDeposits.at(-1);
{const {m,i}=instancesOf(first.id).find(x=>x.m.name!=='CrystalCrust'),q=new T.Matrix4();m.getMatrixAt(i,q);const at=new T.Vector3().setFromMatrixPosition(q);ray.set(new T.Vector3(at.x,at.y+4,at.z),new T.Vector3(0,-1,0));}
const wallHit=ray.intersectObjects(content.targets(),false)[0];assert.ok(wallHit);assert.equal(content.resolveTarget(wallHit).id,first.id);
// Live damage removes actual crystals; snapshots alone recreate their exact surviving geometry.
const left=70-Math.floor(10*2/first.maxHits);// two hits on a 3..5-hit mineral remove that share of its 10 pieces
const damaged=structuredClone(snapshot);damaged.deposits.find(d=>d.id===first.id).hits=2;content.sync(damaged);content.tick(700,damaged.tick);
assert.equal(content.stats().crystalWalls.crystals,left);
assert.equal(content.targets().filter(m=>m.name.startsWith('CrystalBatch_')||m.name==='CrystalOre').reduce((n,m)=>n+m.count,0),left);
const compare=new T.Scene(),late=createCrystalWall({THREE:T,scene:compare,height});late.sync(damaged);late.update(0,damaged.tick);
assert.equal(late.stats().crystals,left);assert.equal(late.stats().shards,0,'late join invents no flying chips');
// The same deposit can be restored to an earlier checkpoint without keeping hidden damage.
content.sync(snapshot);content.tick(800,snapshot.tick);assert.equal(content.stats().crystalWalls.crystals,70);
// Reanchor existing geometry after terrain changes.
const crystalY=()=>{const {m,i}=instancesOf(first.id).find(x=>x.m.name.startsWith('CrystalBatch_')||x.m.name==='CrystalOre'),q=new T.Matrix4();m.getMatrixAt(i,q);return new T.Vector3().setFromMatrixPosition(q).y;};
const raised=structuredClone(snapshot);raised.edits.push({id:'raiseTest',kind:'raise',x:first.x,z:first.z,radius:6,height:2});
const before=crystalY();content.sync(raised);content.tick(900,raised.tick);assert.ok(crystalY()>before+1.5,'crystals ride the ground');
// Mining it out shatters its crystals and sinks its earth; the authority then retires edit+deposit.
const mined=structuredClone(snapshot);Object.assign(mined.deposits.find(d=>d.id===first.id),{hits:first.maxHits,depleted:true});mined.edits.find(e=>e.id===first.editId).wall.expireTick=mined.tick;
content.sync(mined);content.tick(1000,mined.tick+1);assert.equal(content.stats().crystalWalls.crystals,60);assert.ok(content.stats().crystalWalls.shards>0,'mined segment bursts into shards');
mined.edits=mined.edits.filter(e=>e.id!==first.editId);mined.deposits=mined.deposits.filter(d=>d.id!==first.id);mined.tick+=40;content.sync(mined);content.tick(1700,mined.tick);
assert.ok(!instancesOf(first.id).length,'retired segment leaves no tagged geometry');

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
