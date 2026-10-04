import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {isTestingGift} from '../shared/testing-supplies.js';
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
assert.equal(sim.snapshot().harvestedTrees[0].cuts,3); assert.equal(sim.snapshot().pickups.filter(p=>p.kind==='wood'&&!isTestingGift(p)).length,0,'timber arrives as physical logs after landing, not an instant pickup');
for(let t=0;t<600&&!sim.snapshot().harvestedTrees[0].landed;t++)sim.step();
const timber=sim.snapshot().looseLogs.length; assert.ok(timber>=2&&timber<=5,'cut-height-dependent log yield');
// Interaction is explicit and range-bound: E collects nearby lumber directly; optional grab/stow remains supported.
state=sim.checkpoint(); const log=state.looseLogs[0]; state.players[0].position=[log.position[0],terrainHeight(state,log.position[0],log.position[2]+1.2),log.position[2]+1.2]; sim=loadSimulation(state);
for(let i=0;i<5;i++)sim.step();assert.equal(sim.snapshot().looseLogs.length,timber,'proximity alone never collects');
assert.equal(sim.command('h',{type:'action',seq:8,action:'grab',id:log.id}).ok,true);
assert.equal(sim.command('h',{type:'action',seq:9,action:'interact'}).events[0].kind,'pickup');
assert.equal(sim.snapshot().players[0].resources.wood,1);
state=sim.checkpoint(); const ore=state.deposits[0]; state.players[0].position=[ore.x,terrainHeight(state,ore.x,ore.z),ore.z+1]; state.players[0].yaw=0; sim=loadSimulation(state);
assert.equal(sim.command('h',{type:'action',seq:10,action:'equip',tool:'pick'}).ok,true);
for(let t=0;t<29;t++)sim.step();
const stoneBefore=sim.snapshot().pickups.filter(p=>p.kind==='stone').length;
for(let i=0;i<3;i++){if(i)for(let t=0;t<29;t++)sim.step(); const r=sim.command('h',{type:'action',seq:11+i,action:'strike',targetId:ore.id,tool:'pick',point:[ore.x,0,ore.z],normal:[0,1,0]}); assert.equal(r.ok,true);}
assert.equal(sim.snapshot().deposits[0].depleted,true); assert.equal(sim.snapshot().pickups.filter(p=>p.kind==='stone').length,stoneBefore+1);
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
const originalMeteors=magic.snapshot().deposits.filter(d=>d.kind==='meteor').length;
let sequence=0;for(const spell of ['sunder','wall','ring','starfall']){assert.equal(magic.command('g',{type:'cast',seq:++sequence,spell,point:[10,0,10]}).ok,true);for(let i=0;i<60;i++)magic.step();}
assert.equal(magic.snapshot().edits.length,5);{const ring=magic.snapshot().groves.at(-1).trees;assert.ok(ring.length>=6,'ring grows around the wall');assert.equal(worldTrees(magic.snapshot()).length,25+ring.length);}assert.equal(magic.snapshot().deposits.filter(d=>d.kind==='meteor').length,originalMeteors+1);
assert.deepEqual(loadSimulation(magic.checkpoint()).snapshot(),magic.snapshot());
{const r=magic.command('g',{type:'cast',seq:++sequence,spell:'ring',point:[55,0,55]}),ring=magic.snapshot().edits.at(-1);assert.equal(r.ok,true,'mana alone refuses a cast; placement moves it');assert.ok(Math.abs(ring.x)<=51&&Math.abs(ring.z)<=51,'ring settles inside the world');}
// A full terrain list never refuses: the oldest settled earthworks fold into the baked ground.
let capped=magic.checkpoint();capped.edits=Array.from({length:63},(_,i)=>({id:'limit'+i,kind:'raise',x:0,z:0,radius:6,height:2}));capped.deposits=capped.deposits.filter(d=>d.special!=='wall');capped.players[0].mana=100;capped=loadSimulation(capped);
assert.equal(capped.command('g',{type:'cast',seq:++sequence,spell:'wall',point:[0,0,0]}).ok,true);assert.ok(capped.snapshot().edits.length<=64&&capped.snapshot().terrainBake?.rev>0,'old edits fold into the bake');
console.log('world-content: checkpoint validation, atomic limits and all imported spells pass');
