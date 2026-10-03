import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {settlementView} from '../shared/resources.js';
const advance=(sim,n)=>{for(let i=0;i<n;i++)sim.step();};
function world(role='god'){const sim=createSimulation();sim.addPlayer({id:'solo',role});let seq=0;return {sim,command:(action,rest={})=>sim.command('solo',{type:'action',seq:++seq,action,...rest}),cast:(spell,point)=>sim.command('solo',{type:'cast',seq:++seq,spell,point})};}

test('one God summons real workers which fell timber, mine finite ore and return cargo',()=>{
 const {sim,command}=world();assert.equal(command('forgeSummon').ok,true);assert.equal(command('forgeSummon').ok,true);
 assert.equal(sim.snapshot().players[0].mana,50);
 advance(sim,5400);const s=sim.snapshot();
 assert.ok(s.settlement.stock.wood>=6);assert.ok(s.settlement.stock.stone>=4);
 assert.ok(s.harvestedTrees.some(t=>t.cuts===3));assert.ok(s.deposits.some(d=>d.depleted));
 assert.equal(s.players[0].resources.wood,0,'workers deliver to shared stores');
 assert.equal(command('forgeDefend').ok,true);assert.equal(command('forgeUpgrade').ok,true);
 assert.equal(sim.snapshot().settlement.defenses,1);assert.equal(sim.snapshot().settlement.level,1);
 const reloaded=loadSimulation(sim.checkpoint());assert.deepEqual(reloaded.snapshot(),sim.snapshot());
 advance(sim,300);advance(reloaded,300);assert.deepEqual(reloaded.snapshot(),sim.snapshot(),'worker navigation and cargo resume deterministically');
});
test('one Hero can recruit, deposit and develop the same forge without changing roles',()=>{
 const {sim,command}=world('hero');assert.equal(command('forgeSummon').ok,true);
 const initial=sim.checkpoint();initial.players[0].resources={wood:10,stone:6,gems:0};const live=loadSimulation(initial);let seq=initial.players[0].seq;
 for(const [kind,amount]of [['wood',10],['stone',6]])assert.equal(live.command('solo',{type:'action',seq:++seq,action:'forgeSupply',kind,amount}).ok,true);
 assert.equal(live.command('solo',{type:'action',seq:++seq,action:'forgeUpgrade'}).ok,true);
 assert.equal(live.snapshot().players[0].role,'hero');assert.equal(live.snapshot().settlement.level,1);
 const far=live.checkpoint();far.players[0].position=[30,0,30];const distant=loadSimulation(far);
 assert.equal(distant.command('solo',{type:'action',seq:++seq,action:'forgeSummon'}).code,'too_far');
});
test('solo God actual lightning clears a raid and checkpoint between final blow and reward is safe',()=>{
 const {sim,command,cast}=world();assert.equal(command('forgeEncounter').ok,true);
 const target=sim.snapshot().enemies[0];assert.equal(cast('lightning',target.position).ok,true);advance(sim,45);
 assert.equal(cast('lightning',sim.snapshot().enemies[0].position).ok,true);
 assert.equal(sim.snapshot().settlement.encounter.foes.length,0);
 const resumed=loadSimulation(sim.checkpoint());resumed.step();const earned=resumed.snapshot().settlement;
 assert.equal(earned.lastResult,'victory');assert.deepEqual(earned.stock,{wood:4,stone:3,gems:1});
 advance(resumed,120);assert.deepEqual(resumed.snapshot().settlement.stock,earned.stock,'no replay award');
 assert.equal(resumed.command('solo',{type:'action',seq:99,action:'forgeEncounter'}).code,'cooldown');
});
test('unanswered solo God raid reaches and damages forge; defeat gives no payout',()=>{
 const {sim,command}=world();command('forgeEncounter');advance(sim,1800);const s=sim.snapshot();
 assert.equal(s.settlement.lastResult,'defeat');assert.equal(s.settlement.completed,0);assert.deepEqual(s.settlement.stock,{wood:0,stone:0,gems:0});assert.equal(s.enemies.length,0);
});
test('workers and raid clocks pause when the room is empty',()=>{
 const {sim,command}=world();command('forgeSummon');command('forgeEncounter');sim.removePlayer('solo');const before=sim.snapshot().settlement;advance(sim,300);assert.deepEqual(sim.snapshot().settlement,before);
});
test('shared supplies advance existing expedition goals and spend once',()=>{
 const {sim,command}=world();command('forgeSummon');command('forgeSummon');advance(sim,3600);
 const start=sim.command('solo',{type:'adventure',seq:10,action:'start'});assert.equal(start.ok,true);
 const before=sim.snapshot().settlement.stock;const result=sim.command('solo',{type:'action',seq:11,action:'forgeContribute'});assert.equal(result.ok,true);
 const s=sim.snapshot();assert.equal(s.adventure.stock.wood,s.adventure.need.wood);assert.equal(s.adventure.stock.stone,s.adventure.need.stone);assert.equal(s.settlement.stock.wood,before.wood-s.adventure.need.wood);
 assert.equal(sim.command('solo',{type:'action',seq:11,action:'forgeContribute'}).code,'duplicate_sequence');
 assert.equal(sim.command('solo',{type:'action',seq:12,action:'forgeContribute'}).code,'not_needed');
});
test('worker cap, costs, cargo reassignment and hostile save fields are validated',()=>{
 const {sim,command}=world();for(let i=0;i<4;i++)assert.equal(command('forgeSummon').ok,true);assert.equal(command('forgeSummon').code,'worker_limit');assert.equal(command('forgeUpgrade').code,'insufficient_resources');
 const saved=sim.checkpoint();for(const mutate of [s=>s.settlement.stock.wood=-1,s=>s.settlement.stock.gems=1.5,s=>s.settlement.workers[0].position[0]=Infinity,s=>s.settlement.workers[0].cargo=999,s=>s.settlement.workers[0].id=s.players[0].id,s=>s.settlement.encounter={wave:1,elapsed:0,foes:['raid999'],killed:1},s=>s.settlement.extra=true]){const bad=structuredClone(saved);mutate(bad);assert.throws(()=>loadSimulation(bad),/settlement/);}
 const old=structuredClone(saved);delete old.settlement;assert.deepEqual(loadSimulation(old).snapshot().settlement.stock,{wood:0,stone:0,gems:0});
 const view=settlementView(sim.snapshot(),'solo');assert.equal(view.actions.find(a=>a.action==='forgeSummon').enabled,false);assert.equal(view.actions.find(a=>a.action==='forgeUpgrade').enabled,false);
});
test('solo God reaches tier three through gathering and earned raid gems, with no resource injection',()=>{
 const {sim,command,cast}=world();command('forgeSummon');command('forgeSummon');
 for(let i=0;i<18000&&sim.snapshot().settlement.level<3;i++){
  if(i%60===0){const s=sim.snapshot();command('forgeUpgrade');
   if(!s.settlement.defenses&&s.settlement.stock.wood>=10&&s.settlement.stock.stone>=7)command('forgeDefend');
   if(s.shrine.hp<30)command('forgeRepair');
   if(!s.settlement.encounter&&s.settlement.completed<5&&i>1800&&s.players[0].mana>=90&&s.shrine.hp>=90)command('forgeEncounter');
   if(s.settlement.encounter&&s.enemies.length)cast('lightning',s.enemies[0].position);
  }
  sim.step();
 }
 const s=sim.snapshot();assert.equal(s.settlement.level,3);assert.ok(s.settlement.completed>=3);assert.ok(s.settlement.delivered>=20);
});
test('solo Hero builds tier three and earns raid rewards through real melee without changing role',()=>{
 const sim=createSimulation();sim.addPlayer({id:'solo',role:'hero'});let seq=0;
 const action=(action,rest={})=>sim.command('solo',{type:'action',seq:++seq,action,...rest});
 action('forgeSummon');action('forgeSummon');action('equip',{tool:'hammer'});
 for(let i=0;i<24000&&sim.adventureWorld().settlement.level<3;i++){
  const s=sim.adventureWorld(),p=s.players[0];
  if(i%60===0){if(!s.settlement.defenses)action('forgeDefend');action('forgeUpgrade');if(s.shrine.hp<60)action('forgeRepair');for(const w of s.settlement.workers)if(w.job==='stone'&&w.phase==='no_resource')action('forgeAssign',{workerId:w.id,kind:'wood'});if(!s.settlement.encounter&&s.settlement.completed<6&&i>1800)action('forgeEncounter');}
  if(i%10===0&&!s.settlement.encounter){const dx=-p.position[0],dz=6.5-p.position[2],d=Math.hypot(dx,dz);sim.command('solo',{type:'input',seq:++seq,move:{x:d>1?dx/d:0,z:d>1?dz/d:0},yaw:Math.atan2(-dx,-dz)});}
  if(i%10===0&&s.settlement.encounter){const target=[...s.enemies].sort((a,b)=>Math.hypot(a.position[0]-p.position[0],a.position[2]-p.position[2])-Math.hypot(b.position[0]-p.position[0],b.position[2]-p.position[2]))[0];if(target){const dx=target.position[0]-p.position[0],dz=target.position[2]-p.position[2];sim.command('solo',{type:'input',seq:++seq,move:{x:0,z:0},yaw:Math.atan2(-dx,-dz)});if(Math.hypot(dx,dz)<2.8)action('strike',{targetId:target.id,point:[target.position[0],target.position[1]+1.15,target.position[2]],normal:[0,1,0],part:'torso'});}}
  sim.step();
 }
 const s=sim.snapshot();assert.equal(s.players[0].role,'hero');assert.equal(s.settlement.level,3,JSON.stringify({settlement:s.settlement,hero:s.players[0],enemies:s.enemies.map(e=>({position:e.position,hp:e.hp}))}));assert.ok(s.settlement.completed>=3);assert.ok(s.players[0].stats.kills>0);
});
