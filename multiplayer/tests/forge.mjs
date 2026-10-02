import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {FORGE_BOXES,FORGE_WORK_POINT,forgeFloor,resolveForge} from '../shared/forge-collision.js';
const start=performance.now();
assert.deepEqual(JSON.parse(readFileSync(new URL('../shared/forge-layout.json',import.meta.url))),JSON.parse(readFileSync(new URL('../../assets/asset-lab/wayfarer-forge/collision.json',import.meta.url))));
const atWork=[...FORGE_WORK_POINT];resolveForge(atWork,0);assert.deepEqual(atWork,FORGE_WORK_POINT,'front work area must remain accessible');
assert.equal(forgeFloor(0,1,0,0),.18,'walk onto plinth');
assert.equal(forgeFloor(0,1,4,4),4.18,'plinth moves with terrain');
assert.equal(forgeFloor(0,8,4,.2),.2,'spawn floor unchanged');
for(const box of FORGE_BOXES.filter(b=>b.name!=='Plinth')){
  const p=[(box.min[0]+box.max[0])/2,box.min[1],(box.min[2]+box.max[2])/2];
  const before=[...p];resolveForge(p,0);
  assert.notDeepEqual(p,before,`escape ${box.name}`);
  assert.deepEqual(resolveForge([...p],0),p,'one pass must clear all overlapping boxes');
}
const sim=createSimulation({room:'FORGE_TEST'});sim.addPlayer({id:'hero',name:'Hero'});
const save=sim.checkpoint();save.players[0].position=[.3,.18,-.3];const restored=loadSimulation(save);restored.step();
const player=restored.snapshot().players[0];assert.ok(Math.hypot(player.position[0]-.3,player.position[2]+.3)>.1,'restored embedded player escapes');
// Sustained movement from the open front must stop against the actual hearth.
const walkSave=sim.checkpoint();walkSave.players[0].position=[.3,terrainHeight(walkSave,.3,2),2];const walk=loadSimulation(walkSave);
for(let i=1;i<=180;i++){walk.command('hero',{type:'input',seq:i,move:{x:0,z:-1},yaw:0});walk.step();}
const end=walk.snapshot().players[0].position;assert.ok(end[2]>=.599&&end[2]<=.602,`hearth stop at ${end}`);
assert.equal(end[1],.18,'stable step height');
// Raising the ground must not leave the authoritative strike target at old Y=0.
const raisedSave=sim.checkpoint();raisedSave.edits=[{id:'terrain1',kind:'raise',x:0,z:0,radius:6,height:2},{id:'terrain2',kind:'raise',x:0,z:0,radius:6,height:2}];
raisedSave.players[0].position=[.35,4.18,1.4];const raised=loadSimulation(raisedSave);
for(let seq=1;seq<=4;seq++){
  const hit=raised.command('hero',{type:'action',action:'strike',seq,targetId:'shrine',point:[.35,5.27,-.21],normal:[0,0,1]});
  assert.ok(hit.events.some(e=>e.id==='shrine'),'raised forge accepts surface damage');
  if(seq<4)for(let i=0;i<30;i++)raised.step();
}
assert.equal(raised.snapshot().shrine.hp,0);
for(let i=0;i<480;i++)raised.step();assert.equal(raised.snapshot().shrine.hp,100,'eight-second recovery survives new presentation');
console.log(JSON.stringify({passed:true,checks:'source parity, work area, terrain/plinth, eight-box escape, restored actor, 180-step wall contact',elapsedSeconds:(performance.now()-start)/1000}));
