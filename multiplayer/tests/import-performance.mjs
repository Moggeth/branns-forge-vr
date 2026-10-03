import {createHash} from 'node:crypto';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
const setup=performance.now(),initial=createSimulation();for(let i=0;i<8;i++)initial.addPlayer({id:'hero'+i});
const state=initial.checkpoint();state.tick=1;
state.edits=Array.from({length:64},(_,i)=>({id:'edit'+i,kind:'raise',x:i%8*10-35,z:Math.floor(i/8)*10-35,radius:6,height:2}));
state.groves=Array.from({length:64},(_,i)=>({id:'grove'+i,x:i%8*10-35,z:Math.floor(i/8)*10-35,kind:'ring'}));
state.enemies=Array.from({length:64},(_,i)=>({id:'enemy'+i,position:[i%8*5-20,0,Math.floor(i/8)*5-20],yaw:0,hp:100,attackTick:-1000}));
state.harvestedTrees=worldTrees(state).slice(0,256).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(state,t.x,t.z)+1,felledTick:1,fallYaw:0}));
state.deposits=Array.from({length:80},(_,i)=>({id:'ore'+i,x:i%10*5-25,z:Math.floor(i/10)*5-20,kind:'stone',hits:0,maxHits:3,depleted:false}));
state.pickups=Array.from({length:256},(_,i)=>({id:'loot'+i,x:i%16*3-24,z:Math.floor(i/16)*3-24,y:0,kind:'wood',amount:3}));
state.bridges=Array.from({length:32},(_,i)=>({id:'bridge'+i,x:i%8*5-20,z:Math.floor(i/8)*5-10,y:1,yaw:0}));
const sim=loadSimulation(state),generationMs=performance.now()-setup,samples=[],began=performance.now();
const steps=Number(process.argv.find(a=>a.startsWith("--steps="))?.split("=")[1]||3600);
for(let i=0;i<steps;i++){const t=performance.now();sim.step();if(i%3===0)sim.snapshot();samples.push(performance.now()-t);}
samples.sort((a,b)=>a-b);console.log(JSON.stringify({steps,generationMs,elapsedMs:performance.now()-began,p95Ms:samples[Math.floor(samples.length*.95)],p99Ms:samples[Math.floor(samples.length*.99)],maxMs:samples.at(-1),snapshotBytes:Buffer.byteLength(JSON.stringify(sim.snapshot())),checkpointHash:createHash('sha256').update(JSON.stringify(sim.checkpoint())).digest('hex'),scope:'CPU simulation + 20Hz snapshot only; excludes GPU, WebRTC, physical headset'},null,2));
