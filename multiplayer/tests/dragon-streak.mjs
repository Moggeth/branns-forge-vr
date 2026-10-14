import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {DRAGON,dragonPose,dragonRiding,breathGlob,globPosition} from '../shared/dragon-streak.js';

// Fixture: one hero at (x,z) with skeletons `ahead` metres along -Z.
function fixture({x=10,z=10,foes=[],ready=false,streak}={}) {
  const sim=createSimulation();sim.addPlayer({id:'h',name:'Mitch'});
  const c=sim.checkpoint(),p=c.players[0];p.position=[x,terrainHeight(c,x,z),z];p.yaw=0;p.tool='axe';
  if(ready)p.dragonReady=true;if(streak!==undefined)p.streak=streak;
  c.enemies=foes.map((ahead,i)=>createEnemy(`foe${i}`,[x,terrainHeight(c,x,z-ahead),z-ahead]));
  return loadSimulation(c);
}
const hero=s=>s.snapshot().players[0];
let seq=1;const act=(s,m)=>s.command('h',{type:'action',seq:seq++,...m});
const run=(s,n)=>{const out=[];for(let i=0;i<n;i++)out.push(...s.step());return out;};
const ground=(s,x,z)=>[x,terrainHeight(s.checkpoint(),x,z),z];

// Killing blows build the streak; the fifth earns the dragon.
let s=fixture({foes:[2,2.5],streak:3});
let r=act(s,{action:'special'}); // the axe cleave fells both
assert.equal(r.ok,true);
assert.ok(r.events.some(e=>e.kind==='streak'&&e.count===4),'fourth kill reports the streak');
assert.ok(r.events.some(e=>e.kind==='dragon_ready'&&e.id==='h'),'fifth kill earns the dragon');
assert.equal(hero(s).dragonReady,true);assert.equal(hero(s).streak,undefined,'the streak resets once earned');

// Calling it before earning it is refused with a reason.
assert.equal(act(fixture(),{action:'dragon',call:true}).code,'dragon_not_ready');

// Calling it: the dragon circles high over the spot, and the ride lasts 20 s.
s=fixture({ready:true});
r=act(s,{action:'dragon',call:true});
assert.equal(r.ok,true);assert.ok(r.events.some(e=>e.kind==='dragon_summon'));
const ride=hero(s).dragon;
assert.ok(ride&&ride.end-ride.start===DRAGON.rideTicks);assert.equal(hero(s).dragonReady,undefined);
assert.equal(act(s,{action:'dragon',call:true}).code,'dragon_riding');
assert.equal(act(s,{action:'strike',targetId:'miss',point:[10,0,10],normal:[0,1,0],tool:'axe'}).code,'dragon_riding','no hand weapons from the saddle');

// The flight is a smooth function of time: no jumps between frames, at altitude once arrived, on the circle.
let last=null,maxStep=0;
for(let t=ride.start;t<=ride.end;t+=.25){const p=dragonPose(ride,t).position;if(last)maxStep=Math.max(maxStep,Math.hypot(p[0]-last[0],p[1]-last[1],p[2]-last[2]));last=p;}
assert.ok(maxStep<.6,`continuous flight (largest quarter-tick step ${maxStep.toFixed(3)} m)`);
const mid=dragonPose(ride,ride.start+600).position;
assert.ok(Math.abs(Math.hypot(mid[0]-ride.cx,mid[2]-ride.cz)-DRAGON.radius)<.01,'orbit radius');
assert.ok(mid[1]-ride.y>DRAGON.altitude-1,'orbit altitude');

// The rider cannot be hurt and cannot walk.
s.command('h',{type:'input',seq:seq++,move:{x:1,z:0},yaw:0});
const before=hero(s).position;run(s,30);
assert.deepEqual(hero(s).position.map(n=>+n.toFixed(3)),before.map(n=>+n.toFixed(3)),'the body waits where it stood');

// Attacks open once the dragon has arrived.
run(s,DRAGON.arriveTicks);
// Fill the orbit with skeletons and test each attack.
function withFoes(s,points){const c=s.checkpoint();c.enemies=points.map(([x,z],i)=>createEnemy(`sk${i}`,[x,terrainHeight(c,x,z),z]));return loadSimulation(c);}
s=withFoes(s,[[10,10],[10.5,10.5],[20,4],[0,0],[1,1],[1.5,-1]]);
// Breath: pulses scorch around the aim point; too-fast pulses are quietly ignored.
let hits=0;
// Breath is physical: globs fly from the mouth on arcs and burn only where they land, a moment later.
{const res=act(s,{action:'dragon',attack:'breath',point:ground(s,10,10)});assert.equal(res.ok,true);assert.equal(res.events.length,0,'nothing burns at the instant of breathing');
 const f=hero(s).dragon.flames;assert.equal(f.length,1);assert.equal(f[0].at.length,DRAGON.breath.globs);assert.ok(f[0].at.every(t=>t>s.snapshot().tick),'globs are in flight');
 const g=breathGlob(f[0],0),land=globPosition(f[0],g,f[0].at[0]);assert.ok(Math.hypot(land[0]-10,land[2]-10)<3.5,'globs land near the aim');}
for(let i=0;i<20;i++){const res=act(s,{action:'dragon',attack:'breath',point:ground(s,10,10)});assert.equal(res.ok,true);hits+=run(s,DRAGON.breath.pulseTicks).filter(e=>e.kind==='hit'||e.kind==='death').length;}
hits+=run(s,90).filter(e=>e.kind==='hit'||e.kind==='death').length;assert.equal(hero(s).dragon.flames.length,0,'every glob lands');
assert.ok(hits>0,'breath hurts');
assert.ok(!s.snapshot().enemies.some(e=>e.id==='sk0'),'sustained breath fells a skeleton');
assert.ok(s.snapshot().fireCells.some(c=>c.burning),'breath lights the ground');
// Dragon kills never count towards the next streak.
assert.equal(hero(s).streak,undefined);assert.ok(hero(s).stats.kills>=1,'dragon kills are credited');
// Fireball barrage: three balls, landing in turn.
const foe=id=>s.snapshot().enemies.find(e=>e.id===id).position;
r=act(s,{action:'dragon',attack:'fireball',point:foe('sk2')});
assert.equal(r.ok,true);const volley=r.events.find(e=>e.kind==='dragon_fireball');assert.equal(volley.shots.length,3);
assert.equal(act(s,{action:'dragon',attack:'fireball',point:ground(s,20,4)}).code,'dragon_cooldown');
let landed=run(s,DRAGON.fireball.flight+DRAGON.fireball.gap*2+1).filter(e=>e.kind==='dragon_impact');
assert.equal(landed.length,3);assert.ok(landed[0].hits.includes('sk2'),'the barrage hits its target');
// Comet dive: one big blast after the wind-up.
r=act(s,{action:'dragon',attack:'dive',point:foe('sk4')});
assert.equal(r.ok,true);
const save=JSON.parse(JSON.stringify(s.checkpoint()));
assert.equal(loadSimulation(save).snapshot().players[0].dragon.strikes.length,1,'a ride in progress survives a save');
landed=run(s,DRAGON.dive.windup+1).filter(e=>e.kind==='dragon_impact'&&e.strike==='dive');
assert.equal(landed.length,1);assert.ok(landed[0].hits.length>=3);
assert.ok(!s.snapshot().enemies.some(e=>['sk3','sk4','sk5'].includes(e.id)),'the dive clears the group');
// Out-of-reach aim is refused.
assert.equal(act(s,{action:'dragon',attack:'breath',point:[-54,0,-54]}).code,'out_of_reach');

// The ride ends on time, the dragon leaves, and the Hero lands with a moment of protection.
const end=hero(s).dragon.end;
const out=run(s,end-s.snapshot().tick+1);
assert.ok(out.some(e=>e.kind==='dragon_depart'));assert.equal(hero(s).dragon,undefined);
assert.ok(hero(s).protectedUntil>s.snapshot().tick);
assert.equal(dragonRiding(hero(s),s.snapshot().tick),false);

// Falling breaks a streak in progress.
s=fixture({streak:4});
{const c=s.checkpoint();c.players[0].hp=1;c.enemies=[createEnemy('biter',[10,terrainHeight(c,10,10.6),10.6])];s=loadSimulation(c);}
run(s,240);
assert.equal(hero(s).streak,undefined,'a fall resets the streak');

// Steering: the rider's turn starts a new leg exactly where the dragon is, so the path never jumps; it then flies
// straight or turns as asked, and turns itself back in at the edge of the map.
{
  let s=fixture({ready:true});act(s,{action:'dragon',call:true});run(s,DRAGON.arriveTicks+10);
  assert.equal(act(s,{action:'dragon',steer:3}).code,'invalid_action');
  const t0=s.snapshot().tick;assert.equal(act(s,{action:'dragon',steer:0}).ok,true);
  let ride=hero(s).dragon;assert.equal(ride.legs.length,2,'steering starts a new leg');assert.equal(ride.legs[1].turn,0);
  let last=null,maxStep=0,maxYaw=0,prevYaw=null;
  for(let t=t0-8;t<=t0+30;t+=.25){const p=dragonPose(ride,t);if(last)maxStep=Math.max(maxStep,Math.hypot(p.position[0]-last[0],p.position[2]-last[2]));if(prevYaw!==null)maxYaw=Math.max(maxYaw,Math.abs(p.yaw-prevYaw));last=p.position;prevYaw=p.yaw;}
  assert.ok(maxStep<.06&&maxYaw<.01,`steering is continuous (step ${maxStep.toFixed(3)} m, yaw ${maxYaw.toFixed(4)})`);
  const a=dragonPose(ride,t0+60),b=dragonPose(ride,t0+120);assert.ok(Math.abs(a.yaw-b.yaw)<1e-9,'steer 0 flies straight');
  assert.ok(Math.abs(Math.hypot(b.position[0]-a.position[0],b.position[2]-a.position[2])-DRAGON.speed)<.01,'at flying speed');
  // Flying straight out, it reaches the edge and turns back in by itself, then hands control back.
  let forced=false;for(let i=0;i<600&&s.snapshot().players[0].dragon;i++){run(s,1);const r=hero(s).dragon;if(r?.legs.some(l=>l.forced))forced=true;}
  assert.ok(forced,'turns back at the edge');
  {const r=hero(s).dragon;if(r){for(let t=r.start;t<s.snapshot().tick;t+=30){const [x,,z]=dragonPose(r,t).position;assert.ok(Math.hypot(x,z)<52,'stays over the map');}}}
  // A save mid-steer carries the legs, and a ride saved before steering existed still loads and flies its orbit.
  s=fixture({ready:true});act(s,{action:'dragon',call:true});run(s,DRAGON.arriveTicks+10);act(s,{action:'dragon',steer:-.5});
  const c=JSON.parse(JSON.stringify(s.checkpoint()));assert.equal(loadSimulation(c).snapshot().players[0].dragon.legs.length,2);
  delete c.players[0].dragon.legs;const old=loadSimulation(c);assert.ok(dragonPose(old.snapshot().players[0].dragon,old.snapshot().tick).position.every(Number.isFinite),'legless ride flies');
  {const bad=JSON.parse(JSON.stringify(s.checkpoint()));bad.players[0].dragon.legs[1].turn=99;assert.throws(()=>loadSimulation(bad));}
}

// Bad saves are refused.
{const c=fixture().checkpoint();c.players[0].streak=9;assert.throws(()=>loadSimulation(c));}
{const c=fixture().checkpoint();c.players[0].dragon={start:0};assert.throws(()=>loadSimulation(c));}
console.log('dragon streak ok');
