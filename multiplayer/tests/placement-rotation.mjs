import assert from 'node:assert/strict';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {STRUCTURES,validateInventionPlacement,inventionAction} from '../shared/inventions.js';
const start=performance.now();let count=0;
for(const role of ['hero','god'])for(const kind of Object.keys(STRUCTURES).filter(k=>k!=='forge'))for(const yaw of [-31.2,-Math.PI-.01,0,Math.PI+.01,31.2]){
 const sim=createSimulation();sim.addPlayer({id:'builder',role});const s=sim.adventureWorld(),p=s.players[0];s.tick=1;s.landmarks=false;s.deposits=[];s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:.5,felledTick:1,fallYaw:0,landed:true}));p.position=[18,0,6];for(const k of Object.keys(p.resources))p.resources[k]=100;
 const m={action:'inventionBuild',kind,position:[18,0,0],yaw},ctx={terrainHeight:()=>0};
 assert.equal(validateInventionPlacement(s,p,m,ctx).ok,true,`${role}/${kind}/${yaw} preview`);
 assert.equal(inventionAction(s,p,m,ctx).ok,true,`${role}/${kind}/${yaw} authority`);
 const b=s.inventions.structures.at(-1);assert.ok(Math.abs(b.yaw)<=Math.PI);if(kind!=='foundation'){assert.ok(Math.abs(Math.sin(b.yaw)-Math.sin(yaw))<1e-10);assert.ok(Math.abs(Math.cos(b.yaw)-Math.cos(yaw))<1e-10);}
 loadSimulation(sim.checkpoint());count++;
 for(const invalid of [NaN,Infinity,100001,'0'])assert.equal(validateInventionPlacement(s,p,{...m,yaw:invalid},ctx).ok,false);
}
console.log(JSON.stringify({suite:'placement-rotation',count,seconds:(performance.now()-start)/1000,pass:true}));
