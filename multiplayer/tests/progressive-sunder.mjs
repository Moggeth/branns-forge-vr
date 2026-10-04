import assert from 'node:assert/strict';
import * as T from 'three';
import {createSimulation as createBaseSimulation,loadSimulation} from '../shared/simulation.js';
import {terrainHeight,baseHeight,terrainFrameKey,terrainDirtyEdits,sunderFront,hasActiveTerrain} from '../shared/terrain.js';
import {createDeformationField} from '../client/terrain-deformation-field.js';
import {createSpellPresentation} from '../client/spell-presentation.js';
import {createWorldContent} from '../client/world-content-view.js';
import {createOrchardPresentation,disturbanceAt} from '../client/orchard-presentation.js';
// Put this terrain/VFX fixture inside friendly influence; the old endpoint at
// (22,10) was outside the new starting influence introduced by inventions.
const createSimulation=()=>{const s=createBaseSimulation();s.adventureWorld().inventions.structures.find(b=>b.id==='party-influence').position=[0,0,-25];return s;};
const start=performance.now(),step=(s,n)=>{for(let i=0;i<n;i++)s.step();};
// Only horizontal distance controls a spatial line, regardless of target terrain Y.
{
 const s=createSimulation();s.addPlayer({id:'g',role:'god'});const before=s.checkpoint();
 assert.equal(s.command('g',{type:'cast',seq:1,spell:'sunder',point:[10,0,10],start:[10,0,10],end:[10,4,10]}).ok,false);
 assert.deepEqual(s.checkpoint().edits,before.edits);assert.equal(s.snapshot().players[0].mana,100);
 assert.equal(s.command('g',{type:'cast',seq:2,spell:'sunder',point:[10,0,10],start:[8,-5,10],end:[12,5,10]}).ok,true);
 assert.equal(s.snapshot().edits.length,2);assert.doesNotThrow(()=>loadSimulation(s.checkpoint()));
}

const sim=createSimulation();sim.addPlayer({id:'g',role:'god'});sim.addPlayer({id:'h'});
const result=sim.command('g',{type:'cast',seq:1,spell:'sunder',point:[16,0,10],start:[10,0,10],end:[22,0,10]});
assert.equal(result.ok,true);let current=sim.snapshot();const event=result.events.find(e=>e.kind==='spell'),rupture=event.rupture;
assert.ok(rupture);assert.deepEqual(rupture.start,[10,10]);assert.deepEqual(rupture.end,[22,10]);
for(const x of [10,16,22])assert.equal(terrainHeight(current,x,10),baseHeight(x,10),'no instantaneous final deformation');
const field=createDeformationField({size:192,half:60,height:(x,z)=>terrainHeight(current,x,z,false),baseHeight});
field.setEdits(current.edits,current.tick);field.flush();assert.equal(field.sample(22,10).d,0);
const scene=new T.Scene(),fx=createSpellPresentation({scene,height:(x,z)=>terrainHeight(current,x,z),tickSeconds:1/60,getTerrainTick:()=>current.tick});
fx.sync(current);assert.equal(fx.stats().events,1,'snapshot alone recreates active rupture');assert.equal(fx.play(event),false,'event after snapshot dedupes');
step(sim,18);current=sim.snapshot();fx.sync(current);fx.update(300,.016);
assert.ok(terrainHeight(current,12,10)<baseHeight(12,10)-.5);assert.equal(terrainHeight(current,22,10),baseHeight(22,10));
assert.equal(fx.stats().ruptureFronts[0].fraction,sunderFront(rupture,current.tick).fraction,'visible front uses exact same tick');
field.setEdits(current.edits,current.tick);field.flush();assert.equal(field.sample(22,10).d,0);
assert.equal(disturbanceAt(22,10,current.edits,current.tick),0,'no finished soil ahead of rupture');
const migrated=loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));assert.deepEqual(migrated.snapshot(),current);
const middle=sim.checkpoint();
for(const corrupt of [c=>c.edits[0].rupture.startTick=c.tick+1,c=>c.edits[0].rupture.durationTicks=0,c=>c.edits[0].rupture.start=[999,10],c=>c.edits[0].rupture.end=[10,10],c=>c.edits[0].rupture.id='',c=>c.edits[1].rupture={...c.edits[1].rupture,startTick:1}]){const c=structuredClone(middle);corrupt(c);assert.throws(()=>loadSimulation(c));}
const extra=structuredClone(middle);extra.edits[0].rupture.unknown={payload:'discard'};assert.equal(loadSimulation(extra).checkpoint().edits[0].rupture.unknown,undefined);
step(sim,18);step(migrated,18);current=sim.snapshot();assert.deepEqual(migrated.snapshot(),current);
assert.ok(terrainHeight(current,16,10)<baseHeight(16,10));assert.equal(terrainHeight(current,22,10),baseHeight(22,10));
const previousTick=current.tick,previousEdits=current.edits;
step(sim,rupture.durationTicks-current.tick);step(migrated,rupture.durationTicks-migrated.snapshot().tick);current=sim.snapshot();
assert.deepEqual(current,migrated.snapshot());assert.ok(terrainDirtyEdits(previousEdits,current.edits,previousTick,current.tick).length>0);
const legacy={...current,edits:current.edits.map(({rupture,...e})=>e)};
// Concurrent casts reserve all final edits immediately; overlapping heights stay bounded.
{
 const s=createSimulation();for(const id of ['a','b'])s.addPlayer({id,role:'god'});
 for(const id of ['a','b'])assert.equal(s.command(id,{type:'cast',seq:1,spell:'sunder',point:[16,0,10],start:[10,0,10],end:[22,0,10]}).ok,true);
 assert.equal(s.snapshot().edits.length,10);const restored=loadSimulation(s.checkpoint());
 step(s,72);step(restored,72);assert.deepEqual(s.snapshot(),restored.snapshot());
 for(let x=8;x<24;x+=.2)assert.ok(terrainHeight(s.snapshot(),x,10)-baseHeight(x,10)>=-6.000001);
 const capped=s.checkpoint();while(capped.edits.length<63)capped.edits.push({id:'cap'+capped.edits.length,kind:'raise',x:30,z:30,radius:6,height:2});
 // Unlimited terrain: a full list folds its oldest settled edits into the baked ground instead of refusing.
 const full=loadSimulation(capped),before=full.checkpoint(),probe=[[30,30],[34,27],[12,10]].map(([x,z])=>terrainHeight(full.snapshot(),x,z));
 assert.equal(full.command('a',{type:'cast',seq:2,spell:'sunder',point:[16,0,10],start:[10,0,10],end:[22,0,10]}).ok,true);
 const after=full.snapshot();assert.ok(after.edits.length<=48&&after.terrainBake?.rev===1,'old edits baked');assert.ok(after.players[0].mana<before.players[0].mana);
 [[30,30],[34,27]].forEach(([x,z],i)=>assert.ok(Math.abs(terrainHeight(after,x,z)-probe[i])<.001,'baked ground keeps its height'));
 const again=loadSimulation(full.checkpoint());step(full,140);step(again,140);assert.deepEqual(full.snapshot(),again.snapshot(),'baked terrain survives checkpoint restore');
}

for(let x=8;x<=24;x+=.3)assert.equal(terrainHeight(current,x,10),terrainHeight(legacy,x,10),'completed earth is permanently identical to final state');
// Settled earth stays quiet (no render work) until the chasm begins to close at the end of its lifetime.
assert.equal(terrainFrameKey(current.edits,current.tick+1),terrainFrameKey(current.edits,current.edits[0].wall.expireTick));assert.notEqual(terrainFrameKey(current.edits,current.tick+1),terrainFrameKey(current.edits,current.edits[0].wall.expireTick+10));
assert.equal(hasActiveTerrain(current.edits,current.tick+1),false);
field.setEdits(current.edits,current.tick);field.flush();assert.ok(field.sample(20,10).d<-.5);
const late=new T.Scene(),lateFX=createSpellPresentation({scene:late,height:()=>0,tickSeconds:1/60});lateFX.sync(current);assert.equal(lateFX.stats().events,0,'completed joins do not replay a rupture');lateFX.dispose();
// A paused/rewound checkpoint restarts from its saved front, not a stuck clock or full line.
current=middle;fx.sync(current);fx.update(600,.016);assert.equal(fx.stats().ruptureFronts[0].fraction,sunderFront(rupture,current.tick).fraction);
fx.dispose();assert.equal(scene.children.length,0);
// The actual Three terrain support remains identical at every progressive stage.
const geometry=new T.PlaneGeometry(120,120,160,160);geometry.rotateX(-Math.PI/2);const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial()),ray=new T.Raycaster();mesh.updateMatrixWorld(true);let maxError=0;
for(const tick of [0,9,18,36,60,72]){current={...middle,tick};const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,terrainHeight(current,p.getX(i),p.getZ(i),false));geometry.computeBoundingSphere();geometry.computeBoundingBox();for(const x of [9.7,10.2,12.4,15.8,18.2,21.8,23.1]){ray.set(new T.Vector3(x,100,10.1),new T.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit);maxError=Math.max(maxError,Math.abs(hit.point.y-terrainHeight(current,x,10.1,false)));}}
assert.ok(maxError<1e-6);geometry.dispose();mesh.material.dispose();
// Existing tree/ore/prop roots move with the snapshot surface; mining IDs stay stable.
{
 const scene=new T.Scene(),template=new T.Group();template.add(new T.Mesh(new T.BoxGeometry(1,1,1).translate(0,.5,0),new T.MeshBasicMaterial()));
 const templates=new Map([['boulder',{scene:template}],['bank',{scene:template}],['grass_tuft',{scene:template}]]);
 const content=createWorldContent({scene,templates,height:(x,z)=>terrainHeight(current,x,z,false)});
 const blank={...middle,tick:0,edits:[]};current=blank;content.sync(blank);const scatter=scene.children.find(n=>n.isInstancedMesh&&n.count>0);assert.ok(scatter);const matrix=new T.Matrix4();scatter.getMatrixAt(0,matrix);assert.ok(Math.hypot(matrix.elements[12],matrix.elements[14])>1,'fresh empty-edits scatter receives its transforms');
 current={...middle,tick:0,deposits:[{id:'ore',kind:'stone',x:13,z:10,hits:0,maxHits:3,depleted:false}]};content.sync(current);
 const target=content.targets().find(x=>x.userData.targetId==='ore');assert.ok(target);const before=target.position.y;
 current={...current,tick:36};content.sync(current);assert.equal(content.targets().find(x=>x.userData.targetId==='ore'),target);assert.ok(target.position.y<before-.5);assert.equal(target.position.y,terrainHeight(current,13,10,false));content.dispose();template.children[0].geometry.dispose();template.children[0].material.dispose();
}
// Temporal soil changes update bounded patches without rebaking the whole mask.
const orchardScene=new T.Scene(),sun=new T.DirectionalLight(),ground=new T.Mesh(new T.PlaneGeometry(120,120,2,2),new T.MeshStandardMaterial());orchardScene.add(sun,ground);
current={...middle,tick:0};const orchard=createOrchardPresentation({scene:orchardScene,ground,sun,quality:'low',height:(x,z)=>terrainHeight(current,x,z,false),baseHeight,edits:[],loadTextures:false});
orchard.groundChanged({edits:current.edits,terrainTick:0});orchard.flushDeformation();const bakes=orchard.stats().maskBakes;assert.equal(typeof bakes,'number');let maxFrame=0,maxQueue=0;
for(let tick=1;tick<=rupture.durationTicks;tick++){current={...middle,tick};const t=performance.now();orchard.groundChanged({edits:current.edits,terrainTick:tick});orchard.update(1/60,null);maxFrame=Math.max(maxFrame,performance.now()-t);maxQueue=Math.max(maxQueue,orchard.stats().deformation.temporalTexels);}
orchard.flushDeformation();assert.equal(orchard.stats().maskBakes,bakes,'temporal updates do not force a full static mask bake');assert.equal(orchard.stats().deformation.pending,false);assert.ok(maxQueue<192*192/4);orchard.dispose();ground.geometry.dispose();ground.material.dispose();
console.log(JSON.stringify({suite:'progressive-sunder',pass:true,durationTicks:rupture.durationTicks,maxTerrainTriangleError:maxError,maxTemporalOrchardFrameMs:maxFrame,maxQueuedTemporalTexels:maxQueue,elapsedSeconds:(performance.now()-start)/1000}));
