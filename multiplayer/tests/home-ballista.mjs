import assert from 'node:assert/strict';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {HOME_MANNED,homeBallistaSeat,homeBallistaYaw} from '../shared/home-ballista.js';
import {homeFrame} from '../shared/home-bases.js';
import {createEnemy} from '../shared/combat.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
async function testAsync(name,fn){await fn();count++;console.log('PASS',name);}
let seq=0;const act=(sim,id,action,extra)=>sim.command(id,{type:'action',action,seq:++seq,...extra});
const steps=(sim,n)=>{const ev=[];for(let i=0;i<n;i++)ev.push(...sim.step());return ev;};
function rig(){
  const sim=createSimulation({seed:9});sim.addPlayer({id:'host'});sim.addPlayer({id:'foe'});const w=sim.adventureWorld();
  const [hero,foe]=w.players;hero.role=foe.role='hero';hero.side='party';foe.side='rivals';
  const part=w.battle.bases[0].parts.find(p=>p.id==='battle-base-party-ballista-0');
  hero.position=[part.position[0]+1,part.position[1],part.position[2]];foe.position=[0,0,0];
  return {sim,w,hero,foe,part};
}

test('rest heading points out of the gate',()=>{
  const f=homeFrame('party').forward,y=homeBallistaYaw('party');
  assert.ok(Math.abs(-Math.sin(y)-f[0])<1e-9&&Math.abs(-Math.cos(y)-f[1])<1e-9);
});

test('a hero of the side mans its ballista and sits behind it; the other side and far heroes cannot',()=>{
  const {sim,w,hero,foe,part}=rig();
  foe.position=[part.position[0],part.position[1],part.position[2]+1];
  assert.equal(act(sim,'foe','inventionMount',{structureId:part.id}).code,'not_your_structure');
  hero.position=[part.position[0]+6,part.position[1],part.position[2]];
  assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).code,'too_far');
  hero.position=[part.position[0]+1,part.position[1],part.position[2]];
  const r=act(sim,'host','inventionMount',{structureId:part.id});assert.equal(r.ok,true,r.code);
  assert.equal(part.operator,'host');const seat=homeBallistaSeat(part);assert.ok(Math.hypot(hero.position[0]-seat[0],hero.position[2]-seat[2])<1e-6);
  steps(sim,5);assert.equal(part.operator,'host','stays manned while seated');
  assert.deepEqual(loadSimulation(sim.checkpoint()).snapshot().battle,sim.snapshot().battle,'manning survives a save');
  assert.equal(act(sim,'host','inventionMount',{structureId:part.id,off:true}).ok,true);assert.equal(part.operator,null);
  void w;
});

test('manned fire is a hitscan along the aim that hits the first foe, then reloads and winds faster when cranked',()=>{
  const {sim,w,hero,part}=rig();assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);
  part.readyTick=0;const y=homeBallistaYaw('party'),d=12;
  const at=[part.position[0]-Math.sin(y)*d,part.position[1],part.position[2]-Math.cos(y)*d];
  w.enemies.push(createEnemy('skel9',at));
  const before=w.enemies.at(-1).hp,r=act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}});
  assert.equal(r.ok,true,r.code);const fire=r.events.find(e=>e.kind==='home_turret_fire');
  assert.ok(fire.manned);assert.equal(fire.targetId,'skel9');
  assert.ok((w.enemies.find(e=>e.id==='skel9')?.hp??0)<before,'the bolt hurt it');
  assert.equal(act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}}).code,'machine_loading');
  // A miss flies to full range.
  const ready=part.readyTick;steps(sim,HOME_MANNED.fireTicks);
  for(let i=0;i<20;i++){act(sim,'host','inventionCrank',{structureId:part.id});sim.step();}
  assert.ok(part.readyTick<ready-15,'cranking winds it faster');
  part.readyTick=w.tick;const miss=act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:Math.PI/2,pitch:.2}});
  assert.equal(miss.ok,true);const ev=miss.events[0];assert.equal(ev.targetId,null);
  assert.ok(Math.abs(Math.hypot(ev.to[0]-ev.from[0],ev.to[2]-ev.from[2])-HOME_MANNED.range*Math.cos(.2))<1e-6);
  void hero;
});

test('a manned ballista never fires on its own; leaving the seat frees it',()=>{
  const {sim,w,hero,part}=rig();assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);
  part.readyTick=0;const y=homeBallistaYaw('party');
  w.enemies.push(Object.assign(createEnemy('battle1_1_rivals_1',[part.position[0]-Math.sin(y)*8,part.position[1],part.position[2]-Math.cos(y)*8]),{side:'rivals',battleRun:w.battle.run,battleWaypoint:1,emergeTick:0}));
  let ev=steps(sim,3);assert.ok(!ev.some(e=>e.kind==='home_turret_fire'&&e.id===part.id),'held fire');
  hero.position=[hero.position[0]+5,hero.position[1],hero.position[2]];ev=steps(sim,3);
  assert.equal(part.operator,null);assert.ok(ev.some(e=>e.kind==='home_turret_fire'&&e.id===part.id),'back on auto');
});

test('rival heroes in the line of fire take hero damage; a broken ballista throws its operator off',()=>{
  const {sim,w,foe,part}=rig();assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);
  part.readyTick=0;const y=homeBallistaYaw('party');foe.position=[part.position[0]-Math.sin(y)*10,part.position[1],part.position[2]-Math.cos(y)*10];foe.protectedUntil=0;
  const r=act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}});assert.equal(r.events[0].targetId,'foe');assert.equal(foe.hp,100-HOME_MANNED.heroDamage);
  part.hp=0;sim.step();assert.equal(part.operator,null);
  assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).code,'machine_broken');
  void w;
});


// The other hands-on pieces: fountain drink, barracks bell, hammer repairs.
import {HOME,HOME_LAYOUT,homePoint,bellPostAt,shieldUp} from '../shared/home-bases.js';
test('a long drink at the fountain heals at once, then the fountain rests',()=>{
  const {sim,w,hero}=rig();const [x,z]=homePoint('party',HOME_LAYOUT.fountain);hero.hp=40;
  assert.equal(act(sim,'host','homeDrink',{}).code,'too_far');
  hero.position=[x+1.5,hero.position[1],z];const r=act(sim,'host','homeDrink',{});assert.equal(r.ok,true,r.code);
  assert.equal(hero.hp,40+HOME.drink.heal);assert.equal(r.events[0].kind,'home_drink');
  hero.hp=50;assert.equal(act(sim,'host','homeDrink',{}).code,'cooldown');
  assert.deepEqual(loadSimulation(sim.checkpoint()).snapshot().battle,sim.snapshot().battle,'cooldown survives a save');void w;
});
test('ringing the barracks bell sends a squad out now, once per bell cooldown',()=>{
  const {sim,w,hero}=rig();const [x,z]=bellPostAt('party');hero.position=[x+1,hero.position[1],z];
  const before=w.enemies.length,r=act(sim,'host','homeBell',{});assert.equal(r.ok,true,r.code);
  assert.ok(w.enemies.length>before);assert.ok(w.enemies.slice(before).every(e=>e.side==='party'&&e.battleRun!==undefined));
  assert.equal(act(sim,'host','homeBell',{}).code,'cooldown');
  assert.deepEqual(loadSimulation(sim.checkpoint()).snapshot().enemies,sim.snapshot().enemies,'bell squads restore');
});
await testAsync('a hero hammer mends their own broken pylon and lifts a fallen dome; never the heart, never the foe',async()=>{
  const {sim,w,hero}=rig();const base=w.battle.bases[0];for(const p of base.parts)if(p.kind==='pylon')p.hp=0;base.shieldDownUntil=w.tick+999;
  assert.ok(!shieldUp(w,base));const pylon=base.parts[0];hero.tool='hammer';hero.position=[pylon.position[0]+1.5,pylon.position[1],pylon.position[2]];hero.attackTick=-999;
  const strike=id=>sim.command('host',{type:'action',action:'strike',seq:++seq,targetId:id,tool:'hammer',point:[pylon.position[0],pylon.position[1]+1,pylon.position[2]],normal:[1,0,0]});
  hero.yaw=Math.atan2(hero.position[0]-pylon.position[0],hero.position[2]-pylon.position[2]);
  const r=strike(pylon.id);assert.equal(r.ok,true,r.code);assert.ok(r.events.some(e=>e.kind==='home_part_repaired'&&e.mended));
  assert.ok(pylon.hp>0);assert.ok(shieldUp(w,base),'dome is back');
  const {repairHome}=await import('../shared/home-bases.js');
  assert.equal(repairHome(w,base.id,'party',[]),false,'hearts heal only by rebuilding');
  assert.equal(repairHome(w,w.battle.bases[1].parts[0].id,'party',[]),false,'cannot mend the enemy');
});
console.log(`PASS ${count} home base hands-on checks`);
