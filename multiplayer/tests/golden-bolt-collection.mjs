import assert from 'node:assert/strict';
import {collectTarget} from '../shared/resources.js';
import {nearestCollectible,goldenBoltPickup} from '../shared/collection-target.js';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
const began=performance.now();
const fixture=()=>{
 const p={id:'h',role:'hero',hp:100,position:[10,0,10],resources:{gold:0}};
 const embed={id:'q99',kind:'bolt',golden:true,targetId:'world',part:'torso',point:[10,1,9],localPoint:[10,1,9],localQuaternion:[0,0,0,1],normal:[0,0,1]};
 return {p,embed,s:{players:[p],enemies:[],embeds:[embed],pickups:[],looseLogs:[],detachedParts:[]}};
};
const ctx={terrainHeight:()=>0};
{
 const f=fixture();assert.equal(nearestCollectible(f.s,f.p,ctx).id,f.embed.id);
 const action={targetId:f.embed.id,amount:999};assert.equal(collectTarget(f.s,f.p,action,ctx).ok,true);
 assert.equal(f.p.resources.gold,1);assert.equal(f.s.embeds.length,0);assert.equal(collectTarget(f.s,f.p,action,ctx).ok,false);
 assert.equal(f.p.resources.gold,1);assert.equal(nearestCollectible(f.s,f.p),null);
}
for(const mutate of [f=>f.p.resources.gold=999,f=>f.p.position[0]=30,f=>f.p.hp=0,f=>f.p.role='god',f=>delete f.embed.golden,f=>f.embed.kind='arrow']){
 const f=fixture();mutate(f);const before=f.p.resources.gold;assert.equal(collectTarget(f.s,f.p,{targetId:f.embed.id},ctx).ok,false);assert.equal(f.s.embeds.length,1);assert.equal(f.p.resources.gold,before);
}
{
 const f=fixture();const wall={terrainHeight:(s,x,z)=>z<9.8&&z>9.3?5:0};assert.equal(collectTarget(f.s,f.p,{targetId:f.embed.id},wall).ok,false);
 assert.equal(nearestCollectible(f.s,f.p,{visible:()=>false}),null);
 f.s.projectiles=[f.embed];f.s.embeds=[];assert.equal(nearestCollectible(f.s,f.p),null,'in-flight bolts cannot be farmed');
}
{
 const f=fixture();f.embed.targetId='limb';f.embed.localPoint=[1,0,0];f.s.detachedParts=[{id:'limb',position:[10,1,10],quaternion:[0,Math.SQRT1_2,0,Math.SQRT1_2]}];
 const q=goldenBoltPickup(f.s,f.embed);assert.ok(Math.abs(q.x-10)<1e-12);assert.ok(Math.abs(q.z-9)<1e-12);assert.equal(collectTarget(f.s,f.p,{targetId:f.embed.id},ctx).ok,true);
}
{
 const sim=createSimulation({seed:41});sim.addPlayer({id:'h'});const saved=sim.checkpoint(),f=fixture();
 const y=terrainHeight(saved,10,9);saved.players[0].position=[10,y,10];f.embed.point[1]=f.embed.localPoint[1]=y+1;saved.embeds=[f.embed];
 const live=loadSimulation(saved),m={type:'action',seq:1,action:'collectTarget',targetId:f.embed.id};
 assert.equal(live.command('h',m).ok,true);assert.equal(live.command('h',m).code,'duplicate_sequence');
 const reloaded=loadSimulation(live.checkpoint()).snapshot();assert.equal(reloaded.players[0].resources.gold,1);assert.equal(reloaded.embeds.length,0);
}
console.log(`golden-bolt-collection: reward, replay, cap, role, range, occlusion, moving remains and save checks pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
