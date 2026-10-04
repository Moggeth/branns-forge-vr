import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {HOME,homePoint,siegeTargets,shieldUp,resolveHomeDomes,damageHome} from '../shared/home-bases.js';
import {battleBot} from '../shared/battle-mode.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
function rig(){const sim=createSimulation({seed:9});sim.addPlayer({id:'host'});return {sim,w:sim.adventureWorld()};}
const steps=(sim,n)=>{const ev=[];for(let i=0;i<n;i++)ev.push(...sim.step());return ev;};

test('new worlds open with both home bases running and restore them',()=>{
 const {sim,w}=rig();assert.equal(w.battle.v,2);assert.equal(w.battle.status,'running');
 assert.deepEqual(w.battle.bases.map(b=>[b.side,b.position[0],b.position[2]]),[['party',-40,-40],['rivals',40,40]]);
 for(const b of w.battle.bases){assert.equal(b.parts.length,7);assert.ok(shieldUp(w,b));}
 const front=homePoint('party',[0,16]);assert.ok(Math.hypot(front[0],front[1])<Math.hypot(-40,-40),'gate faces the centre');
 assert.deepEqual(loadSimulation(sim.checkpoint()).snapshot().battle,sim.snapshot().battle);
 assert.equal(sim.command('host',{type:'battle',action:'stop',seq:1}).code,'always_on');
});

test('barracks send squads down the lane on the wave clock',()=>{
 const {sim,w}=rig();const ev=steps(sim,HOME.firstWaveTicks+1);const wave=ev.find(e=>e.kind==='battle_wave');
 assert.ok(wave);assert.equal(wave.count,6);assert.equal(w.enemies.filter(e=>battleBot(e)&&e.side==='party').length,3);
 for(const e of w.enemies.filter(battleBot))assert.ok(Math.hypot(e.position[0]-(e.side==='party'?-40:40),e.position[2]-(e.side==='party'?-40:40))<HOME.domeRadius);
 const twin=loadSimulation(sim.checkpoint());steps(sim,240);for(let i=0;i<240;i++)twin.step();assert.deepEqual(twin.snapshot().enemies,sim.snapshot().enemies);
});

test('domes keep hostile heroes out and let their own side in',()=>{
 const {w}=rig();const inside=[-38,0,-38];assert.deepEqual(resolveHomeDomes(w,[...inside],'party'),inside);
 const pushed=resolveHomeDomes(w,[...inside],'rivals');assert.ok(Math.hypot(pushed[0]+40,pushed[2]+40)>=HOME.domeRadius);
});

test('the heart is shielded until every pylon breaks, then the siege pays out and the base rebuilds stronger',()=>{
 const {sim,w}=rig();const base=w.battle.bases[1],events=[];
 assert.equal(damageHome(w,base.id,100,'party',events),false);assert.equal(base.hp,HOME.heartHp);assert.equal(events[0].kind,'home_shield_block');
 assert.equal(damageHome(w,base.id,100,'rivals',[]),false,'own side cannot hurt its heart');
 for(const p of base.parts.filter(p=>p.kind==='pylon'))assert.equal(damageHome(w,p.id,999,'party',events),true);
 assert.ok(!shieldUp(w,base));assert.ok(siegeTargets(w,'party').includes(base));assert.ok(events.some(e=>e.kind==='home_shield_down'));
 const before=w.inventions.stockpiles.party.gems;assert.equal(damageHome(w,base.id,HOME.heartHp,'party',events),true);
 assert.ok(events.some(e=>e.kind==='home_siege_won'&&e.winner==='party'));assert.equal(w.inventions.stockpiles.party.gems,before+HOME.reward.gems);
 assert.equal(w.battle.winner,'party');assert.equal(siegeTargets(w,'party').length,0);
 loadSimulation(sim.checkpoint());
 w.tick=base.fallenUntil-1;const ev=steps(sim,2);assert.ok(ev.some(e=>e.kind==='home_rebuilt'));assert.equal(base.level,2);assert.equal(base.hp,HOME.heartHp);assert.ok(shieldUp(w,base));
});

test('pylons come back after the shield-down window',()=>{
 const {sim,w}=rig();const base=w.battle.bases[0];for(const p of base.parts.filter(p=>p.kind==='pylon'))damageHome(w,p.id,999,'rivals',[]);
 assert.ok(!shieldUp(w,base));w.tick=base.shieldDownUntil-1;steps(sim,2);assert.ok(shieldUp(w,base));
});

test('turrets shoot hostile heroes in range and the fountain heals your own',()=>{
 const {sim,w}=rig();const p=w.players[0];p.side='rivals';const spire=w.battle.bases[0].parts.find(q=>q.kind==='spire');
 p.position=[spire.position[0]+1,terrainHeight(w,spire.position[0]+1,spire.position[2]),spire.position[2]];p.protectedUntil=0;
 const ev=steps(sim,3);assert.ok(ev.some(e=>e.kind==='home_turret_fire'&&e.targetId===p.id));assert.ok(p.hp<100);
 p.side='party';p.hp=50;p.position=[-40,terrainHeight(w,-40,-40),-38];steps(sim,61);assert.ok(p.hp>50,JSON.stringify([p.hp,p.position,p.side]));
});

test('hero melee breaks an enemy pylon',()=>{
 const {sim,w}=rig();const p=w.players[0],pylon=w.battle.bases[1].parts[0];
 const away=[pylon.position[0]-pylon.position[0]+0,0,0];void away;
 const dir=[pylon.position[0]-40,pylon.position[2]-40],l=Math.hypot(...dir),at=[pylon.position[0]+dir[0]/l*1.5,0,pylon.position[2]+dir[1]/l*1.5];at[1]=terrainHeight(w,at[0],at[2]);
 p.position=at;p.yaw=Math.atan2(-(pylon.position[0]-at[0]),-(pylon.position[2]-at[2]));
 const r=sim.command('host',{type:'action',action:'strike',seq:5,targetId:pylon.id,point:[...pylon.position],normal:[0,1,0]});
 assert.equal(r.ok,true,JSON.stringify(r));assert.ok(pylon.hp<pylon.maxHp);
});

console.log(`${count} home base tests passed`);
