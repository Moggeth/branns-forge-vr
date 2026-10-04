import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {WAYSTONES,GATE,ALTAR,DESTINATIONS,WAYGATE,resonantCount,waygateOpen,currentDestination} from '../shared/waygate.js';
import {STARTING_SITES,resolveStartingWorld} from '../shared/starting-world.js';

const sim=createSimulation({seed:23});sim.addPlayer({id:'hero',role:'hero'});sim.addPlayer({id:'ally',role:'hero'});
const w=sim.adventureWorld(),hero=w.players[0],ally=w.players[1];let seq=0;
const standAt=(p,x,z)=>{p.position=[x,terrainHeight(w,x,z),z];p.move=[0,0];p.vy=0;};
const face=(p,x,z)=>{p.yaw=Math.atan2(-(x-p.position[0]),-(z-p.position[2]));};
function strike(id,at,tool='axe'){
  const c=[at.x,terrainHeight(w,at.x,at.z),at.z],d=Math.hypot(hero.position[0]-at.x,hero.position[2]-at.z)||1;
  hero.tool=tool;w.tick+=40;
  return sim.command('hero',{type:'action',action:'strike',seq:++seq,targetId:id,tool,point:[at.x+(hero.position[0]-at.x)/d*.35,c[1]+1.4,at.z+(hero.position[2]-at.z)/d*.35],normal:[(hero.position[0]-at.x)/d,0,(hero.position[2]-at.z)/d]});
}
function approach(at){const site=STARTING_SITES[0],dx=site.x-at.x,dz=site.z-at.z,d=Math.hypot(dx,dz);standAt(hero,at.x+dx/d*1.3,at.z+dz/d*1.3);face(hero,at.x,at.z);}

// Old saves (no waygate field) load and play.
const old=sim.checkpoint();assert.equal(old.waygate,undefined);assert.equal(loadSimulation(old).snapshot().waygate,undefined);

// Too far away: nothing rings.
standAt(hero,0,8);const far=strike('waystone0',WAYSTONES[0]);assert.equal(far.ok,true);assert.equal(resonantCount(w),0);

// Ring seven stones: they resonate, the gate stays shut.
for(const s of WAYSTONES.slice(0,7)){approach(s);const r=strike(s.id,s,s.index%2?'pick':'axe');assert.equal(r.ok,true,r.code);assert.ok(r.events.some(e=>e.kind==='waystone_ring'&&e.index===s.index));}
assert.equal(resonantCount(w),7);assert.equal(waygateOpen(w),false);
assert.deepEqual(loadSimulation(sim.checkpoint()).snapshot().waygate.lit,w.waygate.lit,'resonance survives save/load');

// Resonance fades: stone 0 rung long ago goes dark after 25 s.
const firstLit=w.waygate.lit[0];w.tick=firstLit;assert.equal(resonantCount(w)<7,true,'rings fade after litTicks');
// Re-ring all quickly, then the eighth opens the gate and restores Heroes in the ring.
for(const s of WAYSTONES.slice(0,7)){approach(s);strike(s.id,s);}
hero.hp=40;hero.mana=10;standAt(ally,STARTING_SITES[0].x+2,STARTING_SITES[0].z);ally.hp=50;
approach(WAYSTONES[7]);const open=strike('waystone7',WAYSTONES[7]);
assert.ok(open.events.some(e=>e.kind==='waygate_open'),'eighth stone opens the gate');assert.equal(waygateOpen(w),true);
assert.equal(hero.hp,70);assert.equal(hero.mana,50);assert.equal(ally.hp,80);

// Tune the altar: the destination cycles.
approach({x:ALTAR.x+1.6,z:ALTAR.z});standAt(hero,ALTAR.x+2,ALTAR.z);face(hero,ALTAR.x,ALTAR.z);
const tune=strike(ALTAR.id,ALTAR);assert.ok(tune.events.some(e=>e.kind==='waygate_tune'&&e.dest==='outcrop'));assert.equal(currentDestination(w).id,'outcrop');
for(let i=0;i<DESTINATIONS.length-1;i++)strike(ALTAR.id,ALTAR);assert.equal(currentDestination(w).id,'forge');

// Walk through the gateway: carried to the forge path, facing away from the return circle, outside it.
standAt(hero,GATE.x+.2,GATE.z);const out={events:sim.step()};
const trip=out.events.find(e=>e.kind==='waygate_travel'&&e.id==='hero');assert.ok(trip,'traveled');assert.equal(trip.leg,'out');
const dest=DESTINATIONS[0];assert.ok(Math.hypot(hero.position[0]-dest.x,hero.position[2]-dest.z)>WAYGATE.returnRadius+.5);
const clear=[...hero.position];resolveStartingWorld(clear,(x,z)=>terrainHeight(w,x,z));assert.deepEqual(clear,hero.position,'arrival is clear of landmarks');
for(const d of DESTINATIONS){const x=d.x+d.out[0],z=d.z+d.out[1],q=[x,terrainHeight(w,x,z),z];resolveStartingWorld(q,(x,z)=>terrainHeight(w,x,z));assert.deepEqual(q.map(n=>+n.toFixed(6)),[x,terrainHeight(w,x,z),z].map(n=>+n.toFixed(6)),d.id+' arrival clear');
 assert.ok(Math.hypot(d.out[0],d.out[1])>WAYGATE.returnRadius+.5);const fx=-Math.sin(d.yaw),fz=-Math.cos(d.yaw);const along=fx*(d.x-x)+fz*(d.z-z),miss=Math.abs(fx*(d.z-z)-fz*(d.x-x));assert.ok(along<0||miss>WAYGATE.returnRadius+.3,d.id+' walking ahead misses the return circle');}
// Step into the return circle: back east of the gateway, not inside it.
standAt(hero,dest.x,dest.z);const back=sim.step().find(e=>e.kind==='waygate_travel'&&e.id==='hero');assert.equal(back.leg,'back');
assert.ok(hero.position[0]>GATE.x+GATE.depth);const home=[...hero.position];assert.ok(!sim.step().some(e=>e.kind==='waygate_travel'),'no ping-pong');assert.ok(Math.hypot(hero.position[0]-home[0],hero.position[2]-home[2])<.01);

// Gods never travel.
w.players.push({...structuredClone(ally),id:'godling',role:'god'});const g=w.players.at(-1);standAt(g,GATE.x,GATE.z);
assert.ok(!sim.step().some(e=>e.kind==='waygate_travel'&&e.id==='godling'));w.players.pop();
// The gate closes on time, darkening every stone.
w.tick=w.waygate.openUntil-1;const closing=sim.step();assert.ok(closing.some(e=>e.kind==='waygate_close'));assert.equal(waygateOpen(w),false);assert.equal(resonantCount(w),0);
standAt(hero,GATE.x,GATE.z);assert.ok(!sim.step().some(e=>e.kind==='waygate_travel'),'closed gate carries no one');

// Corrupt saves are rejected.
const bad=sim.checkpoint();bad.waygate={lit:[1],openUntil:0,dest:0};assert.throws(()=>loadSimulation(bad),/waygate/);
const bad2=sim.checkpoint();bad2.waygate={lit:Array(8).fill(0),openUntil:bad2.tick+99999,dest:0};assert.throws(()=>loadSimulation(bad2),/waygate/);
console.log('PASS: waystones ring in reach and fade; eight open the gate and restore; altar tunes; out and back travel; close; save/load and corrupt-save checks.');
