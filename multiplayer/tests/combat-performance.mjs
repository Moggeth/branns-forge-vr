import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
const start=performance.now(),initial=createSimulation();for(let i=0;i<8;i++)initial.addPlayer({id:'hero'+i});
const s=initial.checkpoint();s.enemies=Array.from({length:64},(_,i)=>createEnemy('e'+i,[i%8*5-20,0,Math.floor(i/8)*5-20],i%3?'skeleton':'golem'));
s.projectiles=Array.from({length:96},(_,i)=>({id:'q'+i,ownerId:'hero'+i%8,kind:'arrow',position:[0,8,0],previousPosition:[0,8,0],velocity:[Math.sin(i)*8,1,Math.cos(i)*8],curve:[0,.5,0],bornTick:0,trail:[[0,8,0]]}));
const sim=loadSimulation(s),samples=[];let snapshotBytes=0,wireBytes=0;
for(let i=0;i<120;i++){const t=performance.now();sim.step();if(i%3===0){const snapshot=sim.snapshot();snapshotBytes=Math.max(snapshotBytes,Buffer.byteLength(JSON.stringify(snapshot)));snapshot.projectiles=snapshot.projectiles.map(({trail,...p})=>p);wireBytes=Math.max(wireBytes,Buffer.byteLength(JSON.stringify(snapshot)));};samples.push(performance.now()-t);}
samples.sort((a,b)=>a-b);console.log(JSON.stringify({elapsedMs:performance.now()-start,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),snapshotBytes,wireBytes,scope:'CPU only: 8 heroes, 64 mixed enemies, 96 curved arrows; includes20Hz JSON, excludes renderer/network'},null,2));
