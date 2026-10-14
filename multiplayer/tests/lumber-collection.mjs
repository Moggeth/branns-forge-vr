import assert from 'node:assert/strict';
import {collectTarget} from '../shared/resources.js';
import {nearestCollectible} from '../shared/collection-target.js';
import {logAction,POUCH_RULES,waistPouchPosition,restoreLogs,restoreHarvested} from '../shared/trees.js';
import {worldTrees} from '../shared/world-content.js';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createPickupHighlight} from '../client/pickup-highlight.js';
import * as T from 'three';
const start=performance.now();let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('ok '+name);};
const pose=position=>({position,quaternion:[0,0,0,1]});
function fixture(wood=0){
 const p={id:'h',role:'hero',hp:100,position:[10,0,10],yaw:0,resources:{wood,stone:0,gems:0},stats:{harvested:0},inputTick:100,head:pose([0,1.65,0]),hands:[pose([-.3,1,0]),pose([.3,.2,-.8])]};
 const log={id:'log1',sourceId:'tree1',position:[10.3,.2,9.2],quaternion:[0,0,-Math.SQRT1_2,Math.SQRT1_2],velocity:[0,0,0],angularVelocity:[0,0,0],heldBy:null,bornTick:0,sleeping:true};
 return {p,log,s:{tick:100,players:[p],pickups:[],looseLogs:[log],detachedParts:[]}};
}
const ctx={terrainHeight:()=>0};
const grab=f=>logAction(f.s,f.p,{action:'grab',id:f.log.id,interaction:'vr-grip',hand:1});
const pouch=f=>{f.s.tick+=POUCH_RULES.minTicks;f.p.inputTick=f.s.tick;f.p.hands[1]=pose(waistPouchPosition(f.p));};
const stow=f=>logAction(f.s,f.p,{action:'stowLog',id:f.log.id,amount:999});
check('direct collection is exactly once and ignores arbitrary amount',()=>{const f=fixture();assert.equal(collectTarget(f.s,f.p,{targetId:'log1',amount:999},ctx).ok,true);assert.equal(f.p.resources.wood,1);assert.equal(f.p.stats.harvested,1);assert.equal(collectTarget(f.s,f.p,{targetId:'log1'},ctx).code,'invalid_target');});
check('cap, distance, other holder, role and terrain visibility reject consumption',()=>{
 for(const modify of [f=>f.p.resources.wood=999,f=>f.p.position[0]+=10,f=>f.log.heldBy='other',f=>f.p.role='god']){const f=fixture();modify(f);assert.equal(collectTarget(f.s,f.p,{targetId:'log1'},ctx).ok,false);assert.equal(f.s.looseLogs.length,1);}
 const f=fixture();assert.equal(collectTarget(f.s,f.p,{targetId:'log1'},{terrainHeight:(s,x,z)=>z<9.8&&z>9.4?3:0}).ok,false);
});
check('nearest selector matches eligible target, held priority and visual filter',()=>{const f=fixture();f.s.pickups=[{id:'stone',kind:'stone',x:10,z:10.2,y:0,amount:2}];assert.equal(nearestCollectible(f.s,f.p).id,'stone');f.p.resources.stone=999;assert.equal(nearestCollectible(f.s,f.p).id,'log1');assert.equal(nearestCollectible(f.s,f.p,{visible:()=>false}),null);f.log.heldBy='h';assert.equal(nearestCollectible(f.s,f.p).id,'log1');});
check('tracked grip then waist pouch grants fixed two wood once',()=>{const f=fixture();assert.equal(grab(f).ok,true);assert.equal(stow(f).code,'invalid_pouch');pouch(f);const result=stow(f);assert.equal(result.ok,true);assert.equal(result.events[0].amount,2);assert.equal(f.p.resources.wood,2);assert.equal(f.p.stats.harvested,2);assert.equal(stow(f).ok,false);});
check('ordinary grab, distant tracked grip, stale poses cannot earn bonus',()=>{const f=fixture();assert.equal(logAction(f.s,f.p,{action:'grab',id:'log1'}).ok,true);pouch(f);assert.equal(stow(f).code,'invalid_pouch');assert.equal(logAction(f.s,f.p,{action:'interact'}).ok,true);assert.equal(f.p.resources.wood,1);
 const distant=fixture();distant.p.hands[1]=pose([0,2.3,0]);assert.equal(grab(distant).ok,false);
 const stale=fixture();assert.equal(grab(stale).ok,true);pouch(stale);stale.p.inputTick-=13;assert.equal(stow(stale).ok,false);
});
check('full bonus remains physical; normal collection still fits remaining slot',()=>{const f=fixture(998);grab(f);pouch(f);assert.equal(stow(f).code,'inventory_full');assert.equal(f.s.looseLogs.length,1);assert.equal(logAction(f.s,f.p,{action:'interact'}).ok,true);assert.equal(f.p.resources.wood,999);});
check('drop clears proof; save clone cannot replay bonus',()=>{const f=fixture();grab(f);pouch(f);const restored=structuredClone(f.s);assert.equal(logAction(restored,restored.players[0],{action:'stowLog',id:'log1'}).code,'invalid_pouch');assert.equal(logAction(f.s,f.p,{action:'release'}).ok,true);assert.equal(stow(f).ok,false);});
check('legacy logs and harvested trees remain compatible',()=>{assert.deepEqual(restoreLogs({seed:1,groves:[],tick:0},new Set()),[]);const tree=worldTrees({seed:1,groves:[]})[0];const restored=restoreHarvested({tick:1,harvestedTrees:[{id:tree.id,cuts:3,cutHeight:1,felledTick:1,fallYaw:0}]},new Set([tree.id]));assert.equal(restored[0].landed,true);});
check('authority sequence rejects replay and checkpoint resumes base value',()=>{const sim=createSimulation({seed:41});sim.addPlayer({id:'h'});const s=sim.checkpoint(),f=fixture();s.players[0].position=f.p.position;s.looseLogs=[{...f.log,sourceId:worldTrees(s)[0].id}];s.looseLogs[0].position[1]=terrainHeight(s,10.3,9.2)+.2;const live=loadSimulation(s);const m={type:'action',seq:1,action:'collectTarget',targetId:'log1',amount:99};assert.equal(live.command('h',m).ok,true);assert.equal(live.command('h',m).code,'duplicate_sequence');assert.equal(live.snapshot().players[0].resources.wood,1);assert.equal(loadSimulation(live.checkpoint()).snapshot().looseLogs.length,0);});
check('highlight shares one mesh/material and clears immediately',()=>{const scene=new T.Scene(),view=createPickupHighlight({scene}),f=fixture(),c=nearestCollectible(f.s,f.p);for(let i=0;i<100;i++)view.update(c,i*16,()=>0);assert.equal(scene.children.length,1);assert.equal(view.stats().targetId,'log1');assert.equal(scene.children[0].material.depthTest,true);view.update(null);assert.equal(view.stats().visible,false);view.dispose();assert.equal(scene.children.length,0);});
console.log(`lumber-collection: ${checks} checks passed in ${((performance.now()-start)/1000).toFixed(3)} s`);
