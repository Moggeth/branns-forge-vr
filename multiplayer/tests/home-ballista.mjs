import assert from 'node:assert/strict';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {KEEP_BALLISTA,homeBallistaSeat,homeBallistaYaw,keepMuzzle,keepStyle,keepTimberlineFrame} from '../shared/home-ballista.js';
import {MANNED,mannedShot} from '../shared/inventions.js';
import {timberlineLaunch,TIMBERLINE_LONG} from '../shared/timberline-flight.js';
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

const ahead=(part,d,side=part.side)=>{const y=homeBallistaYaw(side);return [part.position[0]-Math.sin(y)*d,part.position[1],part.position[2]-Math.cos(y)*d];};
const bot=(w,id,at,side)=>Object.assign(createEnemy(id,at),side?{side,battleRun:w.battle.run,battleWaypoint:1,emergeTick:0}:{});

const shotsOf=(w,part)=>w.inventions.shots.filter(q=>q.structureId===part.id);
test('a gate Timberline looses the built Timberline\'s long pair for free: it cuts a line of skeletons, then winds faster when cranked',()=>{
  const {sim,w,hero,part}=rig();assert.equal(keepStyle('party'),'timberline');assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);
  assert.ok(Math.hypot(hero.position[0]-homeBallistaSeat(part)[0],hero.position[2]-homeBallistaSeat(part)[2])<1e-6);
  assert.ok(Math.abs(Math.hypot(homeBallistaSeat(part)[0]-part.position[0],homeBallistaSeat(part)[2]-part.position[2])-MANNED.seat)<1e-6,'the seat is the Timberline\'s');
  part.readyTick=0;w.enemies.push(createEnemy('a',ahead(part,10)),createEnemy('b',ahead(part,14)));
  const wealth=JSON.stringify([hero.resources,w.inventions.stockpiles,w.inventions.bolts]);
  assert.equal(act(sim,'host','inventionDraw',{structureId:part.id}).code,'invalid_action','no draw on a Timberline');
  const r=act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}});assert.equal(r.ok,true,r.code);
  const fire=r.events.find(e=>e.kind==='timberline_fire');assert.ok(fire&&fire.manned&&fire.keep&&fire.structureId===part.id);
  assert.equal(JSON.stringify([hero.resources,w.inventions.stockpiles,w.inventions.bolts]),wealth,'the keep pays: no Wood, Iron or crafted bolts spent');
  const [q]=shotsOf(w,part);assert.ok(q&&q.v===3&&q.type==='timberline'&&q.keep,'a real long-flight pair, not a hitscan');
  assert.equal(part.readyTick,w.tick+MANNED.reloadTicks);
  steps(sim,MANNED.fireTicks+5);assert.ok(!w.enemies.some(e=>['a','b'].includes(e.id)&&e.hp>0),'the wire cuts through both');
  assert.equal(act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}}).code,'machine_loading');
  const ready=part.readyTick;for(let i=0;i<20;i++){act(sim,'host','inventionCrank',{structureId:part.id});sim.step();}
  assert.ok(part.readyTick<ready-15,'cranking winds it faster');
  steps(sim,TIMBERLINE_LONG.maxTicks);assert.equal(shotsOf(w,part).length,0,'the pair comes to rest');
});

test('the pair leaves the gate Timberline\'s eyes on the shared flight, elevated and aimed like a built one',()=>{
  const {sim,w,part}=rig();act(sim,'host','inventionMount',{structureId:part.id});part.readyTick=0;
  act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:.4,pitch:.2}});const [q]=shotsOf(w,part),want=mannedShot(keepTimberlineFrame(part),{yaw:.4,pitch:.2});
  assert.deepEqual(q.origin,want.origin);assert.deepEqual(q.target,want.target);assert.equal(q.pitch,want.pitch);
  const m=keepMuzzle(part,.4,.2),l=timberlineLaunch(q);assert.ok(Math.hypot(...m.at.map((v,k)=>v-l.origin[k]))<1e-9,'the sight and the shot agree');
});

test('a save taken while a gate Timberline pair is in the air still loads, without the pair',()=>{
  const {sim,w,part}=rig();act(sim,'host','inventionMount',{structureId:part.id});part.readyTick=0;
  act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:.1}});sim.step();assert.equal(shotsOf(w,part).length,1);
  const loaded=loadSimulation(sim.checkpoint());assert.equal(loaded.snapshot().inventions.shots.length,0);assert.ok(loaded.snapshot().battle.bases.length===2);
});

test('the Gnashjaw harpoons a foe, holds it on the chain, reels it in on the crank and chomps it',()=>{
  const {sim,w,foe}=rig();const part=w.battle.bases[1].parts.find(p=>p.id==='battle-base-rivals-ballista-0');
  foe.position=[part.position[0]+1,part.position[1],part.position[2]];
  assert.equal(act(sim,'foe','inventionMount',{structureId:part.id}).ok,true);part.readyTick=0;
  assert.equal(act(sim,'foe','inventionDraw',{structureId:part.id}).code,'invalid_action','no draw on the harpoon');
  const skel=createEnemy('skel7',ahead(part,12));w.enemies.push(skel);
  const r=act(sim,'foe','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:-.06}});assert.equal(r.ok,true,r.code);assert.equal(r.events[0].style,'gnashjaw');
  let ev=steps(sim,20);assert.ok(ev.some(e=>e.kind==='keep_ballista_hook'&&e.target==='skel7'),'hooked');assert.equal(part.hook.target,'skel7');
  const d0=Math.hypot(skel.position[0]-part.position[0],skel.position[2]-part.position[2]);
  steps(sim,30);const held=Math.hypot(skel.position[0]-part.position[0],skel.position[2]-part.position[2]);
  assert.ok(held<=d0+.5,'the chain holds it');assert.ok(skel.slowUntil>w.tick,'and slows it');
  const yank=act(sim,'foe','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}});assert.equal(yank.ok,true,yank.code);assert.ok(yank.events.some(e=>e.kind==='keep_ballista_yank'));
  assert.ok(Math.hypot(skel.position[0]-part.position[0],skel.position[2]-part.position[2])<held-2,'a click yanks it in');
  const hpBefore=skel.hp;let chomped=null;
  for(let i=0;i<200&&!chomped;i++){act(sim,'foe','inventionCrank',{structureId:part.id});ev=steps(sim,1);chomped=ev.find(e=>e.kind==='keep_ballista_chomp')||null;}
  assert.ok(chomped,'cranked up to the jaw and chomped');assert.ok(!w.enemies.includes(skel)||skel.hp<hpBefore);assert.equal(part.hook,undefined);
  assert.ok(part.readyTick>w.tick,'rewinds before the next harpoon');
});

test('a manned ballista never fires on its own; leaving the seat frees it and it tracks, leads and fires by itself',()=>{
  const {sim,w,hero,part}=rig();assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);
  part.readyTick=0;w.enemies.push(bot(w,'battle1_1_rivals_1',ahead(part,9),'rivals'));
  let ev=steps(sim,3);assert.ok(!ev.some(e=>e.kind==='timberline_fire'&&e.part===part.id),'held fire');
  hero.position=[hero.position[0]+5,hero.position[1],hero.position[2]];ev=steps(sim,120);
  assert.equal(part.operator,null);const shot=ev.find(e=>e.kind==='timberline_fire'&&e.part===part.id);assert.ok(shot,'back on auto');assert.equal(shot.manned,false);
  assert.equal(part.readyTick,part.fireTick+KEEP_BALLISTA.timberline.unmannedReload,'it winds more slowly on its own');
  assert.ok(!ev.some(e=>e.kind==='home_turret_fire'&&e.id===part.id),'no more instant hitscan bolts');
});

test('rival heroes in the line of fire take hero damage; a broken ballista throws its operator off',()=>{
  const {sim,w,foe,part}=rig();assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);
  part.readyTick=0;foe.position=ahead(part,10);foe.protectedUntil=0;
  const r=act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}});assert.equal(r.ok,true);
  steps(sim,20);assert.equal(foe.hp,100-KEEP_BALLISTA.timberline.hero,'the wire cuts them once and flies on');
  part.hp=0;sim.step();assert.equal(part.operator,null);
  assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).code,'machine_broken');
  void w;
});

test('an unmanned Gnashjaw hooks a rival hero, but a hero who runs past the chain tears free',()=>{
  const {sim,w,hero}=rig();const g=w.battle.bases[1].parts.find(p=>p.id==='battle-base-rivals-ballista-0');
  hero.protectedUntil=0;hero.position=ahead(g,12,'rivals');g.readyTick=0;
  g.hook={target:hero.id,hero:true,tick:w.tick,shot:'t',off:[0,1,0]};
  const far=ahead(g,KEEP_BALLISTA.gnashjaw.chain+1,'rivals');hero.position=[far[0],far[1],far[2]];
  const ev=steps(sim,1);assert.ok(ev.some(e=>e.kind==='keep_ballista_release'&&e.reason==='snap'),'tore free');assert.equal(g.hook,undefined);
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
