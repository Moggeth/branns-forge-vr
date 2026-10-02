import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
let sim=createSimulation({seed:9}); sim.addPlayer({id:'h'});
let state=sim.checkpoint(), h=state.players[0], tree=worldTrees(state)[0];
h.position=[tree.x,terrainHeight(state,tree.x,tree.z),tree.z+1]; h.yaw=0; sim=loadSimulation(state);
// Wrong tool cannot damage tree; explicit misses do not hit another cone target.
assert.equal(sim.command('h',{type:'action',seq:1,action:'equip',tool:'pick'}).ok,true);
assert.equal(sim.command('h',{type:'action',seq:2,action:'strike',targetId:tree.id,tool:'pick',point:[tree.x,1,tree.z],normal:[0,1,0]}).events.length,0);
assert.equal(sim.command('h',{type:'action',seq:3,action:'equip',tool:'axe'}).ok,true);
for(let t=0;t<29;t++)sim.step();
for(let i=0;i<3;i++){ if(i) for(let t=0;t<27;t++)sim.step(); assert.ok(sim.command('h',{type:'action',seq:4+i,action:'strike',targetId:tree.id,point:[tree.x,1,tree.z],normal:[0,1,0]}).ok); }
assert.equal(sim.snapshot().harvestedTrees[0].cuts,3); assert.equal(sim.snapshot().pickups.filter(p=>p.kind==='wood').length,1);
// Interaction is explicit and range-bound.
assert.equal(sim.command('h',{type:'action',seq:7,action:'interact'}).events[0].kind,'pickup');
state=sim.checkpoint(); const ore=state.deposits[0]; state.players[0].position=[ore.x,terrainHeight(state,ore.x,ore.z),ore.z+1]; state.players[0].yaw=0; sim=loadSimulation(state);
assert.equal(sim.command('h',{type:'action',seq:8,action:'equip',tool:'pick'}).ok,true);
for(let t=0;t<29;t++)sim.step();
for(let i=0;i<3;i++){if(i)for(let t=0;t<29;t++)sim.step(); const r=sim.command('h',{type:'action',seq:9+i,action:'strike',targetId:ore.id,tool:'pick',point:[ore.x,0,ore.z],normal:[0,1,0]}); assert.equal(r.ok,true);}
assert.equal(sim.snapshot().deposits[0].depleted,true); assert.equal(sim.snapshot().pickups.filter(p=>p.kind==='stone').length,1);
assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint()))).snapshot(),sim.snapshot());
console.log('world-content: pass');

// New content survives recovery, malformed metadata cannot widen limits.
const checkpoint=sim.checkpoint();
for (const corrupt of [s=>s.deposits.push({...s.deposits[0]}),s=>s.deposits[0].depleted=false,s=>s.harvestedTrees[0].felledTick=0,s=>s.pickups[0].amount=999,s=>s.bridges.push({id:'shrine',x:0,z:0,y:0,yaw:0})]) {
 const bad=structuredClone(checkpoint);corrupt(bad);assert.throws(()=>loadSimulation(bad));
}
const extras=structuredClone(checkpoint);extras.deposits[0].surprise='discard';assert.equal(loadSimulation(extras).checkpoint().deposits[0].surprise,undefined);
// Spells use bounded edits; Starfall becomes mineable and survives a save.
const magic=createSimulation({seed:3});magic.addPlayer({id:'g',role:'god'});
let sequence=0;for(const spell of ['sunder','wall','ring','starfall']){assert.equal(magic.command('g',{type:'cast',seq:++sequence,spell,point:[10,0,10]}).ok,true);for(let i=0;i<60;i++)magic.step();}
assert.equal(magic.snapshot().edits.length,7);assert.equal(worldTrees(magic.snapshot()).length,33);assert.equal(magic.snapshot().deposits.filter(d=>d.kind==='meteor').length,1);
assert.deepEqual(loadSimulation(magic.checkpoint()).snapshot(),magic.snapshot());
assert.equal(magic.command('g',{type:'cast',seq:++sequence,spell:'ring',point:[55,0,55]}).code,'outside_world');
// No spend on a cast that would overflow the terrain budget.
let capped=magic.checkpoint();capped.edits=Array.from({length:63},(_,i)=>({id:'limit'+i,kind:'raise',x:0,z:0,radius:6,height:2}));capped.players[0].mana=100;capped=loadSimulation(capped);
assert.equal(capped.command('g',{type:'cast',seq:++sequence,spell:'wall',point:[0,0,0]}).code,'world_limit');assert.equal(capped.snapshot().players[0].mana,100);
console.log('world-content: checkpoint validation, atomic limits and all imported spells pass');
