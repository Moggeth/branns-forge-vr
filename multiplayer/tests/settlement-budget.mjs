import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
// Finishing a raid must leave every stock balance usable and saveable, including materials outside the reward.
{
 const raid=createSimulation();raid.addPlayer({id:'god',role:'god'});
 const initial=raid.adventureWorld();
 const stock=initial.settlement.stock;
 // A full communal store leaves raid rewards in settlement stock for the next transfer.
 for(const k of Object.keys(stock))initial.inventions.stockpiles.party[k]=999;
 Object.assign(stock,{iron:17,wood:998,starOre:2});
 initial.settlement.encounter={wave:1,elapsed:30,killed:2,foes:[]};
 assert.ok(raid.step().some(e=>e.kind==='forge_reward'));
 assert.equal(stock.wood,999);assert.equal(stock.stone,3);assert.equal(stock.gems,1);
 assert.equal(stock.iron,17);assert.equal(stock.starOre,2);
 const save=raid.checkpoint();
 assert.deepEqual(loadSimulation(save).checkpoint().settlement.stock,stock);
 const nonRewardKeys=Object.keys(stock).filter(k=>!['wood','stone','gems'].includes(k));
 for(const missing of [NaN,null]){
  const legacy=structuredClone(save);
  for(const k of nonRewardKeys)legacy.settlement.stock[k]=missing;
  const fixed=loadSimulation(legacy).checkpoint().settlement.stock;
  assert.equal(fixed.wood,999);assert.equal(fixed.stone,3);assert.equal(fixed.gems,1);
  assert.ok(nonRewardKeys.every(k=>fixed[k]===0));
 }
 const malformed=structuredClone(save);malformed.settlement.stock.iron=null;
 assert.throws(()=>loadSimulation(malformed),/settlement/i);
}
const initial=createSimulation();initial.addPlayer({id:'god',role:'god'});initial.addPlayer({id:'hero',role:'hero'});
for(let i=0;i<4;i++)assert.equal(initial.command('god',{type:'action',seq:i+1,action:'forgeSummon'}).ok,true);
const fixture=initial.checkpoint();
fixture.edits=Array.from({length:64},(_,i)=>({id:`budgetEarth${i}`,kind:i%2?'raise':'lower',x:-42+(i%8)*12,z:-42+Math.floor(i/8)*12,radius:6,height:i%2?2:-2}));
fixture.enemies=Array.from({length:64},(_,i)=>{const x=-38+(i%8)*10,z=-38+Math.floor(i/8)*10;return createEnemy(`budgetEnemy${i}`,[x,terrainHeight(fixture,x,z),z],i%4?'skeleton':'golem');});
const sim=loadSimulation(fixture),samples=[],start=performance.now();
for(let i=0;i<1200;i++){const before=performance.now();sim.step();samples.push(performance.now()-before);}
const elapsed=performance.now()-start,sorted=[...samples].sort((a,b)=>a-b),mean=elapsed/1200,p95=sorted[Math.floor(sorted.length*.95)],p99=sorted[Math.floor(sorted.length*.99)];
assert.equal(sim.snapshot().settlement.workers.length,4);assert.equal(sim.snapshot().edits.length,64);assert.equal(sim.snapshot().enemies.length,64);
assert.ok(mean<16.667,`60Hz mean budget exceeded: ${mean}ms`);assert.ok(p95<16.667,`60Hz p95 budget exceeded: ${p95}ms`);
loadSimulation(sim.checkpoint());
console.log(JSON.stringify({case:'64 enemies + 4 workers + 64 edits + God and Hero',ticks:1200,elapsedSeconds:+(elapsed/1000).toFixed(6),meanMs:+mean.toFixed(4),p95Ms:+p95.toFixed(4),p99Ms:+p99.toFixed(4),maxMs:+sorted.at(-1).toFixed(4)}));
