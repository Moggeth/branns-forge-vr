import {WYRMSPOUT} from '../shared/wyrmspout.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {reclaimDepletedDeposits} from '../shared/resources.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
function fixture({x=10,z=-5,above=0}={}){const initial=createSimulation({legacyBattle:true,legacyBattle:true});initial.addPlayer({id:'p'});const state=initial.checkpoint();state.players[0].position=[x,terrainHeight(state,x,z)+above,z];state.players[0].tool='flask';const sim=loadSimulation(state);let seq=0;return {sim,command:m=>sim.command('p',{...m,seq:++seq})};}
const input=(move={x:0,z:0},extra={})=>({type:'input',move,yaw:0,...extra});
function pour(f,extra={}){const p=f.sim.snapshot().players[0];assert.equal(f.command({type:'action',action:'pour',origin:p.position.map((n,i)=>n+(i===1?1.2:0)),direction:[0,0,-1],...extra}).ok,true);return f.sim.snapshot().projectiles.at(-1);}
test('Emberdew inherits authoritative walk and jump motion while ignoring forged velocities',()=>{
 const f=fixture();f.command(input({x:1,z:0},{jump:true,velocity:[100,100,100]}));f.sim.step();const p=f.sim.snapshot().players[0],shot=pour(f,{velocity:[100,100,100],playerVelocity:[-90,0,0]});
 near(shot.velocity[0],5);near(shot.velocity[1],2+p.velocity[1]);near(shot.velocity[2],-6);assert.deepEqual(loadSimulation(f.sim.checkpoint()).snapshot().projectiles,f.sim.snapshot().projectiles);
});
test('jump issued in the same tick as throw and downward falls use current authority vy',()=>{
 const jump=fixture();jump.command(input({x:0,z:0},{jump:true}));near(pour(jump).velocity[1],7.5);
 const fall=fixture({above:3});fall.command(input());fall.sim.step();near(pour(fall).velocity[1],1.75);
});
test('blocked input contributes no phantom momentum; stopping removes prior movement',()=>{
 const blocked=fixture({x:49.72,z:0});blocked.command(input({x:1,z:0}));blocked.sim.step();near(pour(blocked).velocity[0],0);
 const stopped=fixture();stopped.command(input({x:1,z:0}));stopped.sim.step();stopped.command(input());stopped.sim.step();near(pour(stopped).velocity[0],0);
});
test('tracked VR poses use the same authority velocity as FPS and legacy saves default safely',()=>{
 const f=fixture(),pose=position=>({position,quaternion:[0,0,0,1]});f.command(input({x:0,z:-1},{head:pose([0,1.6,0]),hands:[pose([-.3,1,0]),pose([.3,1,0])]}));f.sim.step();near(pour(f).velocity[2],-11);
 const saved=f.sim.checkpoint();delete saved.players[0].velocity;assert.deepEqual(loadSimulation(saved).snapshot().players[0].velocity,[0,0,0]);
 for(const velocity of [[10,0,0],[0,Infinity,0],[0,0],[0,101,0]]){const bad=structuredClone(saved);bad.players[0].velocity=velocity;assert.throws(()=>loadSimulation(bad),/player/);}
});
test('movement inheritance is limited to fuel, preserving flame and arrow launch behavior',()=>{
 for(const [tool,action,speed] of [['wyrmspout','flame',WYRMSPOUT.speed],['crossbow','fire',42],['bow','fire',36]]){
  const f=fixture();f.command(input({x:1,z:0},{jump:true}));f.sim.step();assert.equal(f.command({type:'action',action:'equip',tool}).ok,true);
  const p=f.sim.snapshot().players[0];assert.equal(f.command({type:'action',action,origin:p.position.map((n,i)=>n+(i===1?1.2:0)),direction:[0,0,-1],draw:1,velocity:[99,99,99]}).ok,true);
  assert.deepEqual(f.sim.snapshot().projectiles.at(-1).velocity,[0,0,-speed]);
 }
});
function fullOre(role='god'){const initial=createSimulation({legacyBattle:true,legacyBattle:true});initial.addPlayer({id:'p',role});const saved=initial.checkpoint();saved.deposits=Array.from({length:80},(_,i)=>({id:`oldOre${i}`,x:(i%8)*3-12,z:Math.floor(i/8)*3-12,kind:'stone',hits:3,maxHits:3,depleted:true}));return loadSimulation(saved);}
test('depleted tombstones free crystal slots without restoring resources or mining twice',()=>{
 const sim=fullOre();const before=sim.snapshot();assert.equal(sim.command('p',{type:'cast',seq:1,spell:'crystal',point:[10,0,10]}).ok,true);const s=sim.snapshot();assert.equal(s.deposits.length,1);assert.equal(s.deposits[0].depleted,false);assert.deepEqual(s.pickups,before.pickups);assert.deepEqual(s.players[0].resources,before.players[0].resources);assert.deepEqual(s.edits,before.edits);
 assert.equal(sim.command('p',{type:'cast',seq:1,spell:'crystal',point:[10,0,10]}).code,'duplicate_sequence');assert.equal(loadSimulation(sim.checkpoint()).snapshot().deposits.length,1);
});
test('safe reclamation protects embeds, active quest IDs, workers and live linked walls',()=>{
 const state=fullOre().checkpoint();state.embeds=[{targetId:'oldOre0'}];state.settlement.workers=[{targetId:'oldOre1'}];state.deposits[2].id='xv1s0';state.adventure.stage='star';state.adventure.run=1;state.deposits[3].editId='wall';state.edits=[{id:'wall'}];state.deposits[4].depleted=false;
 assert.equal(reclaimDepletedDeposits(state),75);assert.deepEqual(state.deposits.map(d=>d.id),['oldOre0','oldOre1','xv1s0','oldOre3','oldOre4']);assert.equal(reclaimDepletedDeposits(state),0);
});
// The pick's crystal wall is the Hero special that places ore now (the axe cleave places none).
test('reclaimed deposits permit new Hero special ore while permanent terrain remains unchanged',()=>{
 const sim=fullOre('hero');sim.command('p',{type:'action',seq:1,action:'equip',tool:'pick'});const before=sim.snapshot();const r=sim.command('p',{type:'action',seq:2,action:'special'});assert.equal(r.ok,true);assert.equal(sim.snapshot().deposits.length,7);assert.equal(sim.snapshot().edits.length,before.edits.length+7);assert.ok(sim.snapshot().deposits.every(d=>!d.depleted));loadSimulation(sim.checkpoint());
});
