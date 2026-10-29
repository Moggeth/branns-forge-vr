// Manned Timberline authority: mount, 360-degree aim, elevation, firing along the barrel, winding boosts,
// exclusivity and checkpoint round trips. node tests/timberline-manned.mjs
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {MANNED,machineCycleAge,operatorSeat} from '../shared/inventions.js';
import {timberlineLaunch} from '../shared/timberline-flight.js';
const t0=performance.now();
const sim=createSimulation();sim.addPlayer({id:'gunner',role:'hero'});sim.addPlayer({id:'helper',role:'hero'});
const s=sim.adventureWorld();for(const p of s.players)for(const k of Object.keys(p.resources))p.resources[k]=50;
const at=(x,z)=>[x,terrainHeight(s,x,z,false),z];
const b={id:'building1',type:'timberline',position:at(-12,6),yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};
s.inventions.structures.push(b);s.inventions.seq=1;
const [gunner,helper]=s.players;gunner.position=at(-12,8);helper.position=at(-10.5,7);
let seq=0;const act=(id,action,extra={})=>sim.command(id,{type:'action',seq:++seq,action,structureId:b.id,...extra});

assert.equal(act('gunner','inventionMount').ok,true,'hero mounts');
assert.equal(b.operator,'gunner');
assert.deepEqual(gunner.position.map(v=>+v.toFixed(3)),[-12,+terrainHeight(s,-12,7.5,false).toFixed(3),7.5],'operator stands on the seat behind the rails');
assert.equal(act('helper','inventionMount').code,'machine_manned','one operator at a time');

// Full 360: aim straight behind the pedestal's original facing, with elevation clamped to the authored range.
assert.equal(act('gunner','inventionSteer',{aim:{yaw:Math.PI*.98,pitch:1}}).ok,true);
assert.ok(Math.abs(b.aimPitch-MANNED.pitchMax)<1e-9,'pitch clamps to +25 degrees');
const seat=operatorSeat(b);assert.ok(Math.hypot(gunner.position[0]-seat[0],gunner.position[2]-seat[2])<1e-9,'operator moves with the traverse');
assert.equal(act('helper','inventionSteer',{aim:{yaw:0,pitch:0}}).code,'not_operator');

const before={...gunner.resources};
assert.equal(act('gunner','inventionUse',{aim:{yaw:Math.PI*.98,pitch:.2}}).ok,true,'manned fire needs no ground target');
const shot=s.inventions.shots.at(-1);assert.equal(shot.pitch,.2);
const launch=timberlineLaunch(shot);assert.ok(launch.forward[2]>.9,'fires along the barrel (behind the original facing)');
assert.ok(Math.abs(Math.asin(launch.forward[1])-.2)<1e-9,'elevation carried into flight');
assert.equal(gunner.resources.wood,before.wood-1);assert.equal(gunner.resources.iron,before.iron-1);
assert.equal(act('helper','inventionUse',{aim:{yaw:0,pitch:0}}).code,'not_operator','only the operator fires the manned way');

// Winding: self-winding alone takes the full 4 s; operator R doubles the reload part, a helper quadruples it.
const fired=b.fireTick,plain=b.readyTick;assert.equal(plain-fired,MANNED.reloadTicks);
for(let n=0;n<MANNED.fireTicks;n++)sim.step();
assert.equal(act('helper','inventionCrank').ok,true,'nearby hero can crank');
for(let n=0;n<10;n++){act('helper','inventionCrank');sim.step();}
assert.equal(plain-b.readyTick,30,'helper cranking winds 4x (3 extra ticks per tick)');
assert.ok(machineCycleAge(b,s.tick)>(s.tick-fired)/60,'presentation seeks ahead with the winding');
for(let n=0;n<MANNED.crankHold;n++)sim.step();          // a released crank keeps turning for its short hold window
let r=b.readyTick;for(let n=0;n<10;n++){act('gunner','inventionCrank');sim.step();}
assert.equal(r-b.readyTick,10,'operator R winds 2x');
for(let n=0;n<MANNED.crankHold;n++)sim.step();r=b.readyTick;
for(let n=0;n<20;n++)sim.step();assert.equal(b.readyTick,r,'releasing R returns to self-winding');
helper.position=at(-12,20);assert.equal(act('helper','inventionCrank').code,'too_far');

// Checkpoint round trip keeps the manned state and stays deterministic.
const resume=loadSimulation(sim.checkpoint());
for(let k=0;k<30;k++){sim.step();resume.step();assert.deepEqual(sim.checkpoint().inventions,resume.checkpoint().inventions,'deterministic tick '+k);}
assert.equal(act('gunner','inventionMount',{off:true}).ok,true);assert.equal(b.operator,null,'E steps off');
gunner.position=at(-12,8);act('gunner','inventionMount');gunner.position=at(-12,30);sim.step();assert.equal(b.operator,null,'a hero who leaves the seat is no longer the operator');
// Near the world edge the flight is shortened to stay inside the playable bounds instead of being refused.
const edge={...b,id:'building2',position:at(44,0),operator:null,readyTick:0,fireTick:-1000};s.inventions.structures.push(edge);s.inventions.seq=2;
gunner.position=at(44,1.5);assert.equal(sim.command('gunner',{type:'action',seq:++seq,action:'inventionMount',structureId:'building2'}).ok,true);
assert.equal(sim.command('gunner',{type:'action',seq:++seq,action:'inventionUse',structureId:'building2',aim:{yaw:-Math.PI/2,pitch:0}}).ok,true,'edge shot fires');
assert.ok(Math.abs(s.inventions.shots.at(-1).target[0]-47.9)<1e-6,'edge shot ends at the boundary');
console.log(`timberline-manned: mount, 360 aim, elevation, barrel fire, winding boosts, exclusivity, checkpoint PASS (${((performance.now()-t0)/1000).toFixed(3)}s)`);
{
// Crafted bolts: 1 Timber + 1 Iron at the forge makes 6 bolts on the side's rack; shots spend bolts before raw materials.
const {BOLT_RECIPE}=await import('../shared/inventions.js');
const sim2=createSimulation();sim2.addPlayer({id:'smith',role:'hero'});const w=sim2.adventureWorld(),smith=w.players[0];
for(const k of Object.keys(smith.resources))smith.resources[k]=0;smith.resources.wood=1;smith.resources.iron=1;
smith.position=[30,terrainHeight(w,30,0,false),0];let q=0;const cmd=(m)=>sim2.command('smith',{type:'action',seq:++q,...m});
assert.equal(cmd({action:'inventionCraft',recipe:'timberlineBolts'}).code,'too_far','crafting happens at the forge');
smith.position=[0,terrainHeight(w,0,5,false),5];
assert.equal(cmd({action:'inventionCraft',recipe:'timberlineBolts'}).ok,true);assert.equal(w.inventions.bolts.party,BOLT_RECIPE.output);
assert.equal(smith.resources.wood+smith.resources.iron,0,'one raw shot of materials spent');
assert.equal(cmd({action:'inventionCraft',recipe:'timberlineBolts'}).code,'insufficient_resources');
const m2={id:'building1',type:'timberline',position:[0,terrainHeight(w,0,-6,false),-6],yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};
w.inventions.structures.push(m2);w.inventions.seq=Math.max(w.inventions.seq,1);smith.position=[0,terrainHeight(w,0,-4.5,false),-4.5];
assert.equal(cmd({action:'inventionMount',structureId:'building1'}).ok,true);
for(let n=0;n<BOLT_RECIPE.output;n++){m2.readyTick=0;assert.equal(cmd({action:'inventionUse',structureId:'building1',aim:{yaw:0,pitch:0}}).ok,true,'bolt shot '+n);}
assert.equal(w.inventions.bolts.party,0,'six shots from one craft');
m2.readyTick=0;assert.equal(cmd({action:'inventionUse',structureId:'building1',aim:{yaw:0,pitch:0}}).code,'insufficient_resources','then raw ammo is needed');
w.inventions.bolts.party=BOLT_RECIPE.cap-2;smith.resources.wood=2;smith.resources.iron=1;smith.position=[0,terrainHeight(w,0,5,false),5];
assert.equal(cmd({action:'inventionCraft',recipe:'timberlineBolts'}).code,'rack_full');
const back=loadSimulation(sim2.checkpoint());assert.equal(back.checkpoint().inventions.bolts.party,BOLT_RECIPE.cap-2,'rack survives a checkpoint');
console.log('timberline-manned: crafted bolts 6 per craft, spent first, rack cap, checkpoint PASS');
}
