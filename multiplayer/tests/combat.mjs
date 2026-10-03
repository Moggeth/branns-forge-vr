import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy,partPosition} from '../shared/combat.js';
import {SPELLS} from '../shared/spells.js';
const begin=performance.now();
function fixture(kind='skeleton') {const s=createSimulation();s.addPlayer({id:'h'});s.addPlayer({id:'g',role:'god'});const c=s.checkpoint();c.enemies=[createEnemy('enemy',[0,terrainHeight(c,0,6),6],kind)];return loadSimulation(c);}
function action(s,seq,action,extra={}){return s.command('h',{type:'action',seq,action,...extra});}
const advance=(s,n)=>{for(let i=0;i<n;i++)s.step();};
const localHit=(targetId,part,point)=>({targetId,part,point,normal:[0,0,1],localPoint:[0,0,0],localQuaternion:[0,0,0,1],boneName:part});
function fireAt(s,part,seq=1) {const p=s.snapshot().players[0],e=s.snapshot().enemies[0],at=partPosition(e,part),origin=[p.position[0],at[1],p.position[2]],delta=at.map((n,i)=>n-origin[i]),length=Math.hypot(...delta);assert.equal(action(s,seq,'equip',{tool:'crossbow'}).ok,true);assert.equal(action(s,seq+1,'fire',{origin,direction:delta.map(n=>n/length)}).ok,true);advance(s,3);const shot=s.snapshot().projectiles[0];return {shot,at,hit:{...localHit(e.id,part,at),projectileId:shot.id}};}

// A supplied distant/off-path hit never damages an enemy, and guests cannot report hits.
let s=fixture(),shot=fireAt(s,'torso');
assert.equal(s.projectileContact({...shot.hit,point:[30,1,30]}).code,'invalid_contact');
assert.equal(action(s,3,'projectileHit',shot.hit).code,'host_required');
assert.equal(s.projectileContact(shot.hit).ok,true);
assert.equal(s.snapshot().enemies[0].hp,52);
assert.equal(s.snapshot().embeds[0].boneName,'torso');
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());

// A body shot is not a one-hit kill, but repeated body damage can finish a fight.
let body=fixture();for(let i=0;i<3;i++){const saved=body.checkpoint();saved.players[0].attackTick=-1000;saved.enemies[0].position=[0,0,6];body=loadSimulation(saved);const bodyShot=fireAt(body,'torso',i*3+1);assert.equal(body.projectileContact(bodyShot.hit).ok,true);if(i<2)assert.ok(body.snapshot().enemies.length);}
assert.equal(body.snapshot().enemies.length,0);assert.equal(body.snapshot().embeds.length,3);

// Invalid release payloads are rejected rather than throwing out the host loop.
assert.equal(action(s,90,'release',{direction:{x:0}}).code,'invalid_action');

// Headshot death preserves each embedded arrow and transfers its exact bone-local pose.
s=fixture();shot=fireAt(s,'head');assert.equal(s.projectileContact(shot.hit).ok,true);
assert.equal(s.snapshot().enemies.length,0);assert.equal(s.snapshot().detachedParts.length,6);
const head=s.snapshot().detachedParts.find(d=>d.part==='head');assert.equal(s.snapshot().embeds[0].targetId,head.id);
assert.deepEqual(s.snapshot().embeds[0].localQuaternion,[0,0,0,1]);
const restored=loadSimulation(s.checkpoint());advance(s,120);advance(restored,120);assert.deepEqual(s.snapshot(),restored.snapshot());

// Two structural axe hits detach an arm; grab, ownership, throw and role cleanup persist.
s=fixture();let cp=s.checkpoint();cp.enemies[0].hp=100;s=loadSimulation(cp);
let pt=partPosition(s.snapshot().enemies[0],'leftArm');assert.equal(action(s,1,'strike',{tool:'axe',...localHit('enemy','leftArm',pt)}).ok,true);advance(s,27);
pt=partPosition(s.snapshot().enemies[0],'leftArm');assert.equal(action(s,2,'strike',{tool:'axe',...localHit('enemy','leftArm',pt)}).ok,true);
let arm=s.snapshot().detachedParts[0];assert.equal(arm.part,'leftArm');assert.equal(action(s,3,'grab',{id:arm.id}).ok,true);assert.equal(s.snapshot().players[0].tool,'limb');
assert.equal(action(s,4,'release',{throw:true,direction:[0,0,-1]}).ok,true);assert.equal(s.snapshot().detachedParts[0].velocity[2],-12);
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());

// Golems resist headshots and the curved solver turns in the declared axis direction.
s=fixture('golem');shot=fireAt(s,'head');assert.equal(s.projectileContact(shot.hit).ok,true);assert.ok(s.snapshot().enemies[0].hp>0);
function curveFlight(curve,draw){const r=createSimulation();r.addPlayer({id:'h'});action(r,1,'equip',{tool:'bow'});action(r,2,'fire',{origin:[0,2,8],direction:[0,0,-1],curve,draw});advance(r,30);return r.snapshot().projectiles[0];}
assert.ok(curveFlight([0,.8,0],1).position[0]<-2);assert.ok(curveFlight([0,0,0],1).position[2]<curveFlight([0,0,0],.2).position[2]);

// Every tray spell has a working host command and a presentation event.
for(const spell of SPELLS){const r=createSimulation();r.addPlayer({id:'g',role:'god'});const result=r.command('g',{type:'cast',seq:1,spell:spell.id,point:[5,0,5],...(spell.target==='line'?{start:[2,0,5],end:[8,0,5]}:{})});assert.equal(result.ok,true,spell.id);assert.ok(result.events.some(e=>e.kind==='spell'&&e.spell===spell.id),spell.id);assert.deepEqual(loadSimulation(r.checkpoint()).snapshot(),r.snapshot());advance(r,60);assert.deepEqual(loadSimulation(r.checkpoint()).snapshot(),r.snapshot());}

// New nested save fields cannot bypass caps or inject bad transforms.
s=fixture();shot=fireAt(s,'head');s.projectileContact(shot.hit);const safe=s.checkpoint();
for(const bad of [c=>c.detachedParts[0].velocity=[Infinity,0,0],c=>c.detachedParts[0].quaternion=[0,0,0,0],c=>c.detachedParts[0].heldBy='unknown',c=>c.embeds[0].targetId='absent',c=>c.embeds[0].localPoint=[1e9,0,0],c=>c.detachedParts=Array(97).fill(c.detachedParts[0])]){const c=structuredClone(safe);bad(c);assert.throws(()=>loadSimulation(c));}

// Complete mesh bounds survive transfer/save, even with a limb's pivot at its hip.
s=fixture();shot=fireAt(s,'head');const poses=Object.fromEntries(['head','torso','leftArm','rightArm','leftLeg','rightLeg'].map(part=>[part,{position:partPosition(s.snapshot().enemies[0],part),quaternion:[0,0,0,1],localBounds:{min:[-.2,part.endsWith('Leg')?-1.3:-.3,-.2],max:[.2,.3,.2]}}]));
assert.equal(s.projectileContact({...shot.hit,partPoses:poses}).ok,true);advance(s,120);const leg=s.snapshot().detachedParts.find(d=>d.part==='leftLeg');assert.deepEqual(leg.localBounds,poses.leftLeg.localBounds);assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());
const clean=s.checkpoint();clean.detachedParts[0].unknown={nested:['unbounded']};clean.embeds[0].unknown=clean.detachedParts[0].unknown;assert.equal(loadSimulation(clean).checkpoint().detachedParts[0].unknown,undefined);assert.equal(loadSimulation(clean).checkpoint().embeds[0].unknown,undefined);

// Terrain lines stay connected and reserve every edit atomically before spending mana.
let r=createSimulation();r.addPlayer({id:'g',role:'god'});assert.equal(r.command('g',{type:'cast',seq:1,spell:'wall',point:[0,0,0],start:[-9,0,0],end:[9,0,0]}).ok,true);assert.equal(r.snapshot().edits.length,9);
cp=r.checkpoint();cp.players[0].castTick=-1000;cp.edits=Array.from({length:60},(_,i)=>({id:`edit${i}`,kind:'raise',x:0,z:0,radius:6,height:2}));r=loadSimulation(cp);const mana=r.snapshot().players[0].mana;assert.equal(r.command('g',{type:'cast',seq:2,spell:'wall',point:[0,0,0],start:[-9,0,0],end:[9,0,0]}).ok,true,'a full edit list bakes instead of refusing');assert.ok(r.snapshot().players[0].mana<mana);assert.ok(r.snapshot().edits.length<=48);

// Saves from the first import wave acquire defaults without changing old content.
const old=createSimulation().checkpoint();delete old.projectiles;delete old.embeds;delete old.detachedParts;old.enemies=[{id:'old',position:[0,0,0],yaw:0,hp:100,attackTick:-1000}];const upgraded=loadSimulation(old);assert.equal(upgraded.snapshot().enemies[0].kind,'skeleton');assert.deepEqual(upgraded.snapshot().projectiles,[]);
console.log(`combat: pass (${((performance.now()-begin)/1000).toFixed(3)} s)`);
