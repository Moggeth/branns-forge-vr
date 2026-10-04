import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {BEACON,BEACON_HEARTH,BEACON_RULES,beaconLit} from '../shared/watch-beacon.js';
import {resolveStartingWorld} from '../shared/starting-world.js';

const sim=createSimulation({seed:31});sim.addPlayer({id:'hero',role:'hero'});
const w=sim.adventureWorld(),hero=w.players[0];let seq=0;w.enemies=[];
const stand=(x,z)=>{hero.position=[x,terrainHeight(w,x,z),z];hero.yaw=Math.atan2(-(BEACON.x-x),-(BEACON.z-z));};
const strike=(tool='axe')=>{hero.tool=tool;w.tick+=40;const y=terrainHeight(w,BEACON.x,BEACON.z)+1.4;
 return sim.command('hero',{type:'action',action:'strike',seq:++seq,targetId:BEACON.id,tool,point:[BEACON.x,y,BEACON.z+1.6],normal:[0,0,1]});};

const old=sim.checkpoint();assert.equal(old.beacon,undefined);assert.equal(loadSimulation(old).snapshot().beacon,undefined,'old saves load untouched');
// Reachable from the arch side: the tower's collision lets a Hero stand within reach.
const front=[BEACON.x+1.2,BEACON.z+2.1],r=[front[0],0,front[1]];resolveStartingWorld(r,()=>0);
assert.ok(Math.hypot(r[0]-front[0],r[2]-front[1])<1e-6,'a Hero can stand at the tower foot');stand(...front);

// No Crystal: nothing is spent, the beacon says what it needs.
hero.resources.gems=0;assert.ok(strike().events.some(e=>e.kind==='beacon_needs'));assert.ok(!beaconLit(w));
// One Crystal lights it for five minutes; more bank up to fifteen, and a full brazier takes nothing.
hero.resources.gems=5;const fed=strike();assert.ok(fed.events.some(e=>e.kind==='beacon_fed'&&e.fresh));assert.equal(hero.resources.gems,4);
assert.ok(beaconLit(w));assert.equal(w.beacon.litUntil-w.tick,BEACON_RULES.fuelTicks);
strike();strike();assert.equal(hero.resources.gems,2);assert.ok(w.beacon.litUntil-w.tick<=BEACON_RULES.maxTicks);
assert.ok(strike('pick').events.some(e=>e.kind==='beacon_full'));assert.equal(hero.resources.gems,2,'a full brazier takes nothing');
// Too far does nothing.
stand(BEACON.x,BEACON.z+6);assert.deepEqual(strike().events,[]);stand(...front);

// Watch: new hostiles sound the alarm once, pointing at the newcomer.
const until=w.beacon.litUntil;w.tick+=BEACON_RULES.watchEvery-w.tick%BEACON_RULES.watchEvery-1;
w.enemies.push(createEnemy('far1',[30,terrainHeight(w,30,30),30]));
const alarm=sim.step().find(e=>e.kind==='beacon_alarm');assert.ok(alarm&&alarm.count===1&&alarm.toward[0]===30,'alarm on a new hostile');
for(let k=0;k<BEACON_RULES.watchEvery;k++)assert.ok(!sim.step().some(e=>e.kind==='beacon_alarm'),'no repeat for the same hostile');
assert.equal(w.beacon.litUntil,until,'watching costs no fuel');

// Hearth: a fallen Hero gets up beneath the arch while the beacon burns.
assert.equal(loadSimulation(sim.checkpoint()).snapshot().beacon.litUntil,until,'fire survives save/load');
w.enemies=[];const foe=createEnemy('biter',[...hero.position]);foe.position[0]+=.8;w.enemies.push(foe);hero.hp=1;hero.protectedUntil=0;
let respawn=null;for(let k=0;k<900&&!respawn;k++)respawn=sim.step().find(e=>e.kind==='respawn'&&e.id==='hero');
assert.ok(respawn,'hero falls');assert.ok(Math.hypot(respawn.position[0]-BEACON_HEARTH.x,respawn.position[2]-BEACON_HEARTH.z)<.01,'respawns at the hearth');
const h=[BEACON_HEARTH.x,0,BEACON_HEARTH.z];resolveStartingWorld(h,()=>0);assert.ok(Math.hypot(h[0]-BEACON_HEARTH.x,h[2]-BEACON_HEARTH.z)<1e-6,'hearth is clear ground');

// Burns out on time; then the usual spawn applies again.
w.enemies=[];w.tick=w.beacon.litUntil-1;assert.ok(sim.step().some(e=>e.kind==='beacon_out'));assert.ok(!beaconLit(w));
w.enemies.push(createEnemy('late',[20,terrainHeight(w,20,20),20]));for(let k=0;k<BEACON_RULES.watchEvery;k++)assert.ok(!sim.step().some(e=>e.kind==='beacon_alarm'),'a cold beacon keeps no watch');

// Corrupt saves are rejected.
const bad=sim.checkpoint();bad.beacon={litUntil:bad.tick+BEACON_RULES.maxTicks+1,seen:0};assert.throws(()=>loadSimulation(bad),/beacon/);
const bad2=sim.checkpoint();bad2.beacon={litUntil:0,seen:-1};assert.throws(()=>loadSimulation(bad2),/beacon/);
console.log('PASS: Crystal kindles and banks fuel; full/empty/reach checks; alarm on new hostiles only; hearth respawn; burn-out; saves.');
