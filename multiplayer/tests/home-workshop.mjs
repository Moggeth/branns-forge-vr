// The back town's Workshop and Stores (2026-10-08): a Hero at their own keep's anvil smelts carried ore into bars,
// one every half second; a Hero at their own keep's Stores can bank everything they carry, as at the Forge.
import assert from 'node:assert/strict';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {STORES,WORKSHOP,atHomeStores,backTownSpot} from '../shared/home-workshop.js';
import {BACK_TOWN_VIEW} from '../client/back-town-view.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
let seq=0;const act=(sim,id,action,extra={})=>sim.command(id,{type:'action',action,seq:++seq,...extra});
const steps=(sim,n)=>{const ev=[];for(let i=0;i<n;i++)ev.push(...sim.step());return ev;};
const put=(w,p,[x,z])=>{p.position=[x,terrainHeight(w,x,z),z];p.vy=0;};
function rig(){
  const sim=createSimulation({seed:4});sim.addPlayer({id:'host'});sim.addPlayer({id:'foe'});const w=sim.adventureWorld();
  const [hero,foe]=w.players;hero.role=foe.role='hero';hero.side='party';foe.side='rivals';
  return {sim,w,hero,foe};
}
const at=(side,name,[x,z],dz=.9)=>backTownSpot(side,name,[x,z+dz]);

test('a Hero at their own anvil turns ore into bars, one at a time',()=>{
  const {sim,w,hero}=rig();assert.equal(w.battle.status,'running');
  put(w,hero,at('party','workshop',WORKSHOP.anvil));hero.resources.ironOre=3;hero.resources.goldOre=1;const iron=hero.resources.iron||0,gold=hero.resources.gold||0;
  const ev=steps(sim,WORKSHOP.every*5).filter(e=>e.kind==='workshop_smelt');
  assert.equal(ev.length,4,'four ores, four bars');
  assert.equal(hero.resources.ironOre,0);assert.equal(hero.resources.goldOre,0);
  assert.equal(hero.resources.iron,iron+3);assert.equal(hero.resources.gold,gold+1);
  assert.deepEqual(ev.map(e=>e.left),[3,2,1,0]);assert.ok(ev.every(e=>e.side==='party'&&e.id===hero.id&&e.position.length===3));
});

test('the enemy keep\'s anvil does nothing for you, and walking away stops the smelting',()=>{
  const {sim,w,hero}=rig();
  put(w,hero,at('rivals','workshop',WORKSHOP.anvil));hero.resources.ironOre=2;
  assert.equal(steps(sim,WORKSHOP.every*3).filter(e=>e.kind==='workshop_smelt').length,0);
  put(w,hero,at('party','workshop',WORKSHOP.anvil));steps(sim,WORKSHOP.every);assert.equal(hero.resources.ironOre,1);
  put(w,hero,at('party','workshop',WORKSHOP.anvil,WORKSHOP.reach+1));steps(sim,WORKSHOP.every*3);assert.equal(hero.resources.ironOre,1);
});

test('the Stores bank everything you carry, like the Forge',()=>{
  const {sim,w,hero,foe}=rig();
  put(w,hero,at('party','stores',STORES.door,.6));hero.resources.wood=7;hero.resources.stone=4;
  assert.ok(atHomeStores(hero));
  const r=act(sim,'host','inventionDeposit');assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(hero.resources.wood,0);assert.equal(hero.resources.stone,0);
  put(w,foe,at('party','stores',STORES.door,.6));assert.equal(atHomeStores(foe),false,'not the other side\'s Stores');
  put(w,hero,[0,20]);assert.equal(atHomeStores(hero),false);
});

test('the furnace keeps roaring between bars',()=>{
  assert.ok(BACK_TOWN_VIEW.roar>BACK_TOWN_VIEW.every/60,'roar outlasts the gap between smelts');
});
console.log(`home-workshop: ${count} checks passed`);
