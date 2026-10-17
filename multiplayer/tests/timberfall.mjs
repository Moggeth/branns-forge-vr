import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {worldTrees} from '../shared/world-content.js';
import {isFelled} from '../shared/trees.js';
import {TIMBERFALL,HEARTWOOD,SAPDRINKER_TICKS,heartwoodFor,isRichHeart,timberfallLane,timberfallTicks,planTimberfall,drinkSap} from '../shared/timberfall.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
const started=performance.now();
let seq=0;
const special=(s,point)=>s.command('h',{type:'action',action:'special',seq:++seq,...(point?{point}:{})});
const run=(s,n)=>{const out=[];for(let i=0;i<n;i++)out.push(...s.step());return out;};
// Hero at (x,z) facing yaw, axe in hand; foes at [ahead, right] offsets (the first one a golem when asked).
function fixture({x=10,z=10,yaw=0,foes=[],golem=false,landmarks}={}) {
  const sim=createSimulation();sim.addPlayer({id:'h'});
  const c=sim.checkpoint();if(landmarks!==undefined)c.landmarks=landmarks;const p=c.players[0];p.position=[x,terrainHeight(c,x,z),z];p.yaw=yaw;p.tool='axe';
  const f=[-Math.sin(yaw),-Math.cos(yaw)],r=[Math.cos(yaw),-Math.sin(yaw)];
  c.enemies=foes.map(([ahead,right],i)=>{const ex=x+f[0]*ahead+r[0]*right,ez=z+f[1]*ahead+r[1]*right;return createEnemy(`foe${i}`,[ex,terrainHeight(c,ex,ez),ez],golem&&i===0?'golem':'skeleton');});
  return loadSimulation(c);
}

// Heartwood rolls: deterministic, and every cast that reaches a tree is promised one rich heart in its far half.
const ids=Array.from({length:6},(_,i)=>`t${i}`);
assert.deepEqual(heartwoodFor(7,'tf1',ids),heartwoodFor(7,'tf1',ids),'same seed and cast, same hearts');
let promised=0;
for(let cast=0;cast<400;cast++){
  const hearts=heartwoodFor(cast*31,`tf${cast}`,ids.slice(0,1+cast%6));
  assert.ok(hearts.some(h=>isRichHeart(h.kind)),'at least one rich heart per cast');
  for(const h of hearts)assert.ok(['none',...Object.keys(HEARTWOOD.amount)].includes(h.kind));
  const at=hearts.findIndex(h=>h.promised);if(at>=0){promised++;assert.ok(at>=Math.floor(hearts.length/2),'the promised amberheart is in the far half');assert.equal(hearts[at].kind,'amber');}
}
assert.ok(promised>0&&promised<400,'the promise only fills in when the rolls came up empty');
assert.deepEqual(heartwoodFor(1,'x',[]),[]);

// The lane: straight ahead or toward the aimed point, and it stops at the valley's edge.
let lane=timberfallLane([0,0,0],0);assert.ok(Math.abs(lane.direction[0])<1e-9&&lane.direction[1]===-1);assert.equal(lane.length,TIMBERFALL.length);
lane=timberfallLane([0,0,0],0,[10,0,0]);assert.ok(Math.abs(lane.direction[0]-1)<1e-9);
lane=timberfallLane([40,0,0],0,[50,0,0]);assert.ok(lane.length<6&&lane.length>=0,'clamped at the valley edge');

// A foe far down the lane falls when the light reaches it, not at the cast; foes outside the lane are untouched.
let s=fixture({foes:[[12,0],[12,TIMBERFALL.foeWidth+TIMBERFALL.body+1.2],[-3,0]]});
let r=special(s);assert.equal(r.ok,true);
const ev=r.events.find(e=>e.kind==='axe_cleave');assert.ok(ev.timberfall,'the cast carries its wave');
assert.equal(ev.timberfall.speed,TIMBERFALL.speed);assert.deepEqual(ev.timberfall.direction,[0,0,-1]);assert.equal(ev.timberfall.startTick,ev.tick);
assert.ok(s.snapshot().enemies.some(e=>e.id==='foe0'),'still standing at the cast');
const reach=Math.floor((12-TIMBERFALL.start-TIMBERFALL.body)/TIMBERFALL.speed*60)-2;
run(s,reach);assert.ok(s.snapshot().enemies.some(e=>e.id==='foe0'),'still standing before the front arrives');
run(s,8);assert.ok(!s.snapshot().enemies.some(e=>e.id==='foe0'),'cut down as the front passes');
run(s,timberfallTicks());assert.deepEqual(s.snapshot().enemies.map(e=>e.id).sort(),['foe1','foe2']);
assert.equal(s.snapshot().players[0].stats.kills,1);

// A golem far down the lane survives the blow and is thrown on down it.
s=fixture({foes:[[9,0]],golem:true});const g0=s.snapshot().enemies[0];
special(s);run(s,timberfallTicks());const g1=s.snapshot().enemies[0];
assert.ok(g1&&g1.hp<g0.hp&&g1.hp>0,'golem hurt, not killed');assert.ok(g1.position[2]<g0.position[2]-1.5,'thrown down the lane');

// Trees: every standing tree in the lane falls in order, away from the hero, through the normal three-cut notch;
// their hearts split, and the cast brings up at least one rich heart that drops treasure by the stump.
const base=createSimulation();base.addPlayer({id:'h'});const world=base.checkpoint(),trees=worldTrees(world).filter(t=>Math.abs(t.x)<38&&Math.abs(t.z)<38);
let best=null;
for(const t of trees)for(let k=0;k<16;k++){const a=k/16*Math.PI*2,x=t.x+Math.sin(a)*5,z=t.z+Math.cos(a)*5,yaw=Math.atan2(x-t.x,z-t.z);
  if(Math.hypot(x,z)<9)continue;const probe=fixture({x,z,yaw,landmarks:world.landmarks}),plan=planTimberfall(probe.checkpoint(),probe.checkpoint().players[0]);
  if(!best||plan.trees.length>best.plan.trees.length)best={x,z,yaw,plan};if(best.plan.trees.length>=3)break;}
assert.ok(best&&best.plan.trees.length>=2,'found a line of trees');
s=fixture({x:best.x,z:best.z,yaw:best.yaw,landmarks:world.landmarks});
const pickupsBefore=s.snapshot().pickups.length;
r=special(s);const cast=r.events.find(e=>e.kind==='axe_cleave');
const events=[...r.events,...run(s,timberfallTicks()+2)];
const fell=events.filter(e=>e.kind==='tree_fell').map(e=>e.id),planned=[...cast.trees,...cast.timberfall.trees];
for(const id of planned){assert.ok(fell.includes(id),`${id} felled`);assert.ok(isFelled(s.snapshot().harvestedTrees.find(h=>h.id===id)));}
const order=events.filter(e=>e.kind==='tree_fell'&&cast.timberfall.trees.includes(e.id)).map(e=>e.id);
assert.deepEqual(order,cast.timberfall.trees.filter(id=>order.includes(id)),'the lane falls nearest first');
for(const id of cast.timberfall.trees){const h=s.snapshot().harvestedTrees.find(q=>q.id===id),[fx,fz]=[cast.timberfall.direction[0],cast.timberfall.direction[2]];
  assert.ok(Math.sin(h.fallYaw)*-fx+Math.cos(h.fallYaw)*-fz>.9,'notched on the near side, so it falls down the lane');assert.equal(h.cuts,3);}
const hearts=events.filter(e=>e.kind==='heartwood');
assert.equal(hearts.length,planned.length,'every felled tree splits its heart');
assert.ok(hearts.some(e=>isRichHeart(e.heart)&&e.amount>0),'at least one rich heart');
const drops=hearts.flatMap(e=>e.pickups);assert.equal(s.snapshot().pickups.length,pickupsBefore+drops.length);
for(const e of hearts.filter(e=>e.amount))for(const id of e.pickups){const q=s.snapshot().pickups.find(p=>p.id===id);assert.equal(q.kind,e.heart);assert.ok(Math.hypot(q.x-e.position[0],q.z-e.position[2])<1.5,'treasure by its stump');}
assert.ok(events.some(e=>e.kind==='timberfall_end'));
// A save after the wave reloads exactly, and the amber it dropped is a real, collectable material.
assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))).snapshot(),s.snapshot());
// Same world, same cast: identical outcome (no clock, no RNG).
const again=fixture({x:best.x,z:best.z,yaw:best.yaw,landmarks:world.landmarks});seq=0;
const r2=again.command('h',{type:'action',action:'special',seq:1});const ev2=[...r2.events,...(()=>{const o=[];for(let i=0;i<timberfallTicks()+2;i++)o.push(...again.step());return o;})()];
assert.deepEqual(ev2.filter(e=>e.kind==='heartwood').map(e=>[e.id,e.heart,e.amount]),hearts.map(e=>[e.id,e.heart,e.amount]));

// Sapdrinker: biting blows bring Timberfall back sooner, never past ready; idle or other tools do nothing.
s=fixture({foes:[[1.6,0]]});seq=10;special(s);run(s,60);
const c=s.checkpoint(),p=c.players[0],t0=p.specialTick;
assert.equal(drinkSap(c,p),true);assert.equal(p.specialTick,t0-SAPDRINKER_TICKS);
for(let i=0;i<40;i++)drinkSap(c,p);assert.equal(p.specialTick,c.tick-specialCooldown('axe',p),'never past ready');assert.equal(drinkSap(c,p),false);
const pick={...p,tool:'pick',specialTick:c.tick};assert.equal(drinkSap(c,pick),false);
// In play: a strike on a foe shortens the recharge.
s=fixture();seq=20;special(s);run(s,timberfallTicks()+2);
{const c2=s.checkpoint(),q=c2.players[0],ex=q.position[0],ez=q.position[2]-1.4;c2.enemies=[createEnemy('late',[ex,terrainHeight(c2,ex,ez),ez],'golem')];s=loadSimulation(c2);}
const before=s.snapshot().players[0].specialTick;
const hit=s.command('h',{type:'action',action:'strike',seq:++seq});assert.equal(hit.ok,true);
assert.equal(s.snapshot().players[0].specialTick,before-SAPDRINKER_TICKS,'a landed axe blow drinks sap');

console.log(`timberfall: lane, travelling front, foes, golem, tree cascade, heartwood riches, determinism, reload and Sapdrinker pass (${((performance.now()-started)/1000).toFixed(3)}s)`);
