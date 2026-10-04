// Diagnostic CPU load, not a claim about WAN latency or physical phone GPU speed.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createSimulation,MAX_PLAYERS,terrainHeight} from '../shared/simulation.js';
import {BATTLE,stepBattle,battleBot} from '../shared/battle-mode.js';
import {createEnemy} from '../shared/combat.js';
const sim=createSimulation({legacyBattle:true,seed:4}),world=sim.adventureWorld(),sequence=Array(MAX_PLAYERS).fill(0);
for(let i=0;i<MAX_PLAYERS;i++){
 assert.ok(sim.addPlayer({id:`load${i}`,name:`Player ${i}`}).ok);
 const p=world.players[i];p.side=i%2?'rivals':'party';
 p.position=[(i%8-3.5)*2,0,(Math.floor(i/8)-1.5)*2];p.position[1]=terrainHeight(world,p.position[0],p.position[2]);
 sim.command(p.id,{type:'action',action:'equip',tool:'crossbow',seq:++sequence[i]});
}
assert.ok(sim.command('load0',{type:'battle',action:'start',seq:++sequence[0]}).ok);
for(let i=0;i<8;i++){world.battle.nextWaveTick=world.tick;stepBattle(world,{createEnemy,terrainHeight,nextId:(s,p)=>p+(++s.idCounter)},[]);}
assert.equal(world.enemies.filter(battleBot).length,BATTLE.botCap);
const samples=[],start=performance.now();let maxEnemies=0,maxProjectiles=0,events=0;
for(let tick=0;tick<1200;tick++){
 for(let i=0;i<MAX_PLAYERS;i++){
  const p=world.players[i];
  if(tick%3===0)sim.command(p.id,{type:'input',seq:++sequence[i],move:[Math.sin((tick+i*9)/50)*.6,Math.cos((tick+i*9)/50)*.6],yaw:i*.2});
  if(tick%90===i%30)sim.command(p.id,{type:'action',action:'fire',seq:++sequence[i],origin:[p.position[0],p.position[1]+1.5,p.position[2]],direction:[-Math.sin(p.yaw),0,-Math.cos(p.yaw)]});
 }
 const before=performance.now();events+=sim.step().length;samples.push(performance.now()-before);
 maxEnemies=Math.max(maxEnemies,world.enemies.length);maxProjectiles=Math.max(maxProjectiles,world.projectiles.length);
}
assert.equal(world.players.length,32);assert.ok(maxEnemies<=64);assert.ok(world.enemies.filter(battleBot).length<=BATTLE.botCap);
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({players:32,botCap:BATTLE.botCap,ticks:samples.length,maxEnemies,maxProjectiles,events,
 meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],p99Ms:samples[Math.floor(samples.length*.99)],maxMs:samples.at(-1),ticksOverBudget:samples.filter(t=>t>1000/60).length,elapsedSeconds:(performance.now()-start)/1000}));
