import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {baseHeight,mountainHeight,moveOnTerrain,PICK_WALL,pickWallDurationTicks} from '../shared/terrain.js';
import {planCrystalWall} from '../shared/weapon-specials.js';
import {createEnemy} from '../shared/combat.js';
const started=performance.now();
function fixture(tool='axe',x=10,z=10) {
  const sim=createSimulation();sim.addPlayer({id:'h'});
  const c=sim.checkpoint();c.landmarks=false;c.players[0].position=[x,terrainHeight(c,x,z),z];c.players[0].tool=tool;
  return loadSimulation(c);
}
const special=(s,seq=1)=>s.command('h',{type:'action',action:'special',seq});
const gameplay=c=>({...c,players:c.players.map(p=>({...p,seq:0}))});

// The axe special is the cleave now (tests/axe-cleave.mjs); it makes no terrain edits.
for(const tool of ['pick']) {
  const s=fixture(tool),before=s.snapshot(),r=special(s);
  assert.equal(r.ok,true);assert.equal(s.snapshot().edits.length,tool==='axe'?6:7);
  assert.equal(s.snapshot().deposits.length-before.deposits.length,tool==='axe'?3:7);
  const e=r.events.find(e=>e.kind===(tool==='axe'?'axe_cleave':'pick_burst'));
  assert.deepEqual(e.position,before.players[0].position);assert.equal(e.path.length,tool==='axe'?6:7);
  assert.deepEqual(e.direction,[0,0,-1]);
  assert.equal(special(s).code,'duplicate_sequence');
  const after=s.checkpoint();assert.equal(special(s,2).code,'cooldown');
  assert.deepEqual(gameplay(s.checkpoint()),gameplay(after));
  assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());
  assert.ok(e.path.at(-1)[2]<e.path[0][2]);
  if(tool==='pick'){assert.ok(e.path.every(q=>Math.abs(q[0]-10)<1e-9),'unaimed wall runs straight ahead');assert.equal(e.durationTicks,pickWallDurationTicks(PICK_WALL.maxReach-PICK_WALL.start));}
}

// Reserve edits, meteor reservations and all deposits atomically.
for(const tool of ['pick'])for(const cap of ['edits','deposits']) {
  let s=fixture(tool),c=s.checkpoint();
  if(cap==='edits')c.edits=Array.from({length:59},(_,i)=>({id:`e${i}`,kind:'raise',x:-30,z:-30,radius:6,height:2}));
  else c.deposits=Array.from({length:78},(_,i)=>({id:`o${i}`,kind:'stone',x:-30,z:-30,hits:0,maxHits:3,depleted:false}));
  s=loadSimulation(c);const before=s.checkpoint();
  // Settled earth folds into the baked ground, so only deposits can still be full.
  if(cap==='edits'){assert.equal(special(s).ok,true);assert.ok(s.snapshot().terrainBake);continue;}
  assert.equal(special(s).code,'world_limit');
  assert.deepEqual(gameplay(s.checkpoint()),gameplay(before));
}
let s=fixture('pick',45,45);let c=s.checkpoint();c.players[0].yaw=Math.PI;s=loadSimulation(c);const edge=s.checkpoint();
assert.equal(special(s).code,'outside_world');assert.deepEqual(gameplay(s.checkpoint()),gameplay(edge));

// Mine one segment: its earth sinks over sinkTicks (never instantly), rewards once, then edit+deposit retire.
s=fixture('pick');special(s);for(let i=0;i<60;i++)s.step();
let ore=s.snapshot().deposits.filter(d=>d.special==='pick_wall').at(-1);
const peak=terrainHeight(s.snapshot(),ore.x,ore.z);
for(let i=0;i<3;i++) {
  c=s.checkpoint();c.players[0].attackTick=-1000;
  c.players[0].position=[ore.x+2,terrainHeight(c,ore.x+2,ore.z),ore.z];c.players[0].yaw=Math.PI/2;s=loadSimulation(c);
  const result=s.command('h',{type:'action',action:'strike',seq:i+2,tool:'pick',targetId:ore.id,point:[ore.x,terrainHeight(s.snapshot(),ore.x,ore.z),ore.z],normal:[0,1,0]});
  assert.equal(result.ok,true);
}
assert.equal(s.snapshot().deposits.find(d=>d.id===ore.id).depleted,true);
const sinking=s.snapshot().edits.find(e=>e.id===ore.editId);assert.ok(sinking&&sinking.wall.expireTick===s.snapshot().tick,'mined segment starts sinking, not vanishing');
assert.ok(terrainHeight(s.snapshot(),ore.x,ore.z)>peak-.01,'no instant drop');
assert.equal(s.snapshot().pickups.filter(q=>q.kind==='stone').length,2); // Existing sanctuary cache plus reward.
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());
const clean=s.checkpoint();
for(const mutate of [c=>c.deposits.find(d=>d.id===ore.id).depleted=false,c=>c.edits.find(e=>e.kind==='pick_wall').height=999,c=>c.deposits.find(d=>d.special==='pick_wall'&&!d.depleted).editId='missing',c=>c.edits.find(e=>e.kind==='pick_wall').kind='raise',
  c=>c.edits.find(e=>e.kind==='pick_wall').wall.expireTick+=1,c=>c.edits.find(e=>e.kind==='pick_wall').wall.a[0]+=.2,c=>delete c.edits.find(e=>e.kind==='pick_wall').rupture,c=>c.edits.find(e=>e.kind==='pick_wall').wall.h1=3]) {
  c=structuredClone(clean);mutate(c);assert.throws(()=>loadSimulation(c));
}
for(let i=0;i<PICK_WALL.sinkTicks/2;i++)s.step();
const half=terrainHeight(s.snapshot(),ore.x,ore.z);assert.ok(half<peak-.2&&half>baseHeight(ore.x,ore.z)+.2,'sinking is progressive');
assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))).snapshot(),s.snapshot(),'mid-sink reload');
for(let i=0;i<PICK_WALL.sinkTicks;i++)s.step();
assert.ok(!s.snapshot().edits.some(e=>e.id===ore.editId)&&!s.snapshot().deposits.some(d=>d.id===ore.id),'sunk segment retires');
assert.ok(terrainHeight(s.snapshot(),ore.x,ore.z)<peak-1);
// Import strips unknown payloads instead of replicating them in every snapshot.
c=structuredClone(clean);c.edits[0].unknown='payload';c.players[0].stats.unknown='payload';
assert.equal(loadSimulation(c).checkpoint().edits[0].unknown,undefined);
assert.equal(loadSimulation(c).checkpoint().players[0].stats.unknown,undefined);

// Arbitrary repeated casts cannot excavate/stack unbounded earth, even loaded old saves.
const empty={edits:[],bridges:[]};
for(const height of [-2,2]) {
  const terrain={edits:Array.from({length:64},()=>({kind:height<0?'lower':'raise',x:0,z:12,radius:6,height}))};
  assert.equal(Math.abs(terrainHeight(terrain,0,12)-baseHeight(0,12)),6);
}
const scars={edits:Array.from({length:64},()=>({kind:'axe_sunder',x:10,z:10,radius:1.35,height:-.12}))};
assert.ok(Math.abs(terrainHeight(scars,10,10)-baseHeight(10,10))<=.6500001);
assert.equal(mountainHeight(46,0),0);assert.ok(mountainHeight(55,0)>10);
const lowered={edits:[{kind:'lower',x:50,z:0,radius:6,height:-999}]};
assert.equal(terrainHeight(lowered,51,0),baseHeight(51,0)); // Fully protected grid vertices beyond the transition.
let pos=[40,terrainHeight(empty,40,0),0];for(let i=0;i<500;i++){moveOnTerrain(empty,pos,1/12,0);pos[1]=terrainHeight(empty,pos[0],pos[2]);}
assert.ok(pos[0]>46&&pos[0]<49,'mountain visibly stops walking on steep face');

// Raised wall blocks walking from the side at its full-height end.
s=fixture('pick');special(s);for(let i=0;i<60;i++)s.step();const world=s.snapshot();ore=world.deposits.filter(d=>d.special==='pick_wall').at(-2);
pos=[ore.x+2,terrainHeight(world,ore.x+2,ore.z),ore.z];
for(let i=0;i<90;i++){moveOnTerrain(world,pos,-1/12,0);pos[1]=terrainHeight(world,pos[0],pos[2]);}
assert.ok(pos[0]>ore.x+.4,'cannot walk sideways through the wall');
// ...but its caster end is a walkable ramp onto the crest.
pos=[10,terrainHeight(world,10,10.2),10.2];let crest=0;
for(let i=0;i<90;i++){moveOnTerrain(world,pos,0,-1/12);pos[1]=terrainHeight(world,pos[0],pos[2]);crest=Math.max(crest,pos[1]-baseHeight(pos[0],pos[2]));}
assert.ok(crest>1.5,'ramp climbs onto the crest');

// Existing saves outside the new mountain rim recover; input can then walk inward.
s=fixture('axe',54,0);s.step();assert.ok(s.snapshot().players[0].position[0]<=49.72);
const outside=s.snapshot().players[0].position[0];
for(let i=0;i<60;i++){s.command('h',{type:'input',seq:i+1,move:{x:-1,z:0},yaw:Math.PI/2});s.step();}
assert.ok(s.snapshot().players[0].position[0]<outside-1);

// Reserved future meteors count toward capacity before the special changes any gameplay.
s=fixture('pick');c=s.checkpoint();c.edits=Array.from({length:57},(_,i)=>({id:`r${i}`,kind:'raise',x:-30,z:-30,radius:6,height:2}));
c.pendingStarfalls=[{id:'meteorPending',x:-20,z:-20,radius:5,impactTick:48}];s=loadSimulation(c);
// Baking makes room for the wall plus the reserved meteor, so the live list stays within capacity.
assert.equal(special(s).ok,true);{const after=s.checkpoint();assert.ok(after.edits.length+after.pendingStarfalls.length<=48&&after.terrainBake);}

// Full pickup capacity preserves the last wall hit, cooldown and terrain; retry can finish later.
s=fixture('pick');special(s);c=s.checkpoint();ore=c.deposits.find(d=>d.special==='pick_wall');ore.hits=2;
c.pickups=Array.from({length:256},(_,i)=>({id:`full${i}`,kind:'stone',amount:1,x:-20,z:-20,y:terrainHeight(c,-20,-20)}));
s=loadSimulation(c);const full=s.checkpoint();
assert.equal(s.command('h',{type:'action',action:'strike',seq:2,tool:'pick',targetId:ore.id,point:[ore.x,terrainHeight(c,ore.x,ore.z),ore.z],normal:[0,1,0]}).code,'world_limit');
assert.deepEqual(gameplay(s.checkpoint()),gameplay(full));

// A migrated host simulates the same persistent walls and moving players exactly.
s=fixture('pick');special(s);let migrated=loadSimulation(JSON.parse(JSON.stringify(s.checkpoint())));
for(let i=0;i<90;i++){s.step();migrated.step();}assert.deepEqual(s.snapshot(),migrated.snapshot());

// Real authoritative attribution survives reload and is independent of duplicate packets.
s=fixture('axe');c=s.checkpoint();c.enemies=[createEnemy('victim',[10,terrainHeight(c,10,7.5),7.5])];c.enemies[0].hp=20;s=loadSimulation(c);
assert.equal(special(s).ok,true);assert.equal(s.snapshot().players[0].stats.kills,1);assert.equal(s.snapshot().players[0].stats.contribution,20);
assert.equal(special(s).code,'duplicate_sequence');assert.equal(s.snapshot().players[0].stats.kills,1);
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());

// Authored ore surfaces stand up to 1.5 m over the earth. An overhead bridge
// must not move the mining envelope to its deck, including raised wall ore.
for(const wall of [false,true]) {
  s=fixture('pick');if(wall)special(s);
  c=s.checkpoint();
  if(!wall)c.deposits.push({id:'bridgeOre',kind:'stone',hits:0,maxHits:3,depleted:false,x:10,z:9.1});
  ore=wall?c.deposits.find(d=>d.special==='pick_wall'):c.deposits.find(d=>d.id==='bridgeOre');
  const floor=terrainHeight(c,ore.x,ore.z,false);
  c.bridges=[{id:'overhead',x:ore.x,z:ore.z,y:floor+5,yaw:0}];
  c.players[0].position=[ore.x+2,terrainHeight(c,ore.x+2,ore.z,false),ore.z];c.players[0].yaw=Math.PI/2;
  s=loadSimulation(c);
  assert.equal(s.command('h',{type:'action',action:'strike',seq:2,tool:'pick',targetId:ore.id,point:[ore.x,floor+1.2,ore.z],normal:[0,1,0]}).ok,true);
  assert.equal(s.snapshot().deposits.find(d=>d.id===ore.id).hits,1,'visible ore tip remains mineable under deck');
}

// Gentle undeformed grass never trips the steep-slope gate, in any direction.
for(let x=-40;x<=40;x+=8)for(let z=-40;z<=40;z+=8)for(const [dx,dz] of [[1/12,0],[-1/12,0],[0,1/12],[0,-1/12]]) {
  const p=[x,terrainHeight(empty,x,z),z];moveOnTerrain(empty,p,dx,dz);
  assert.ok(Math.abs(p[0]-x-dx)<1e-12&&Math.abs(p[2]-z-dz)<1e-12);
}

// All four boundary line directions produce valid, reloadable coordinates.
for(const spell of ['sunder','wall'])for(const point of [[55,0,55],[-55,0,55],[55,0,-55],[-55,0,-55]]) {
  s=createSimulation();s.addPlayer({id:'g',role:'god'});
  s.adventureWorld().inventions.structures.find(b=>b.id==='party-influence').position=[Math.sign(point[0])*40,0,Math.sign(point[2])*40];
  assert.equal(s.command('g',{type:'cast',spell,point,seq:1}).ok,true);
  assert.ok(s.snapshot().edits.every(e=>Math.abs(e.x)<=55&&Math.abs(e.z)<=55));
  assert.doesNotThrow(()=>loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))));
}
// Legacy checkpoints without scoreboard/content metadata acquire bounded defaults.
c=createSimulation().checkpoint();s=loadSimulation(c);s.addPlayer({id:'legacy'});c=s.checkpoint();delete c.players[0].stats;delete c.contentVersion;
assert.deepEqual(loadSimulation(c).snapshot().players[0].stats,{kills:0,deaths:0,harvested:0,contribution:0});
// ---- Stonewhisper crystal wall v2 ----
// Aim: the wall runs toward the aimed point, reach clamped to minReach..maxReach; the client preview uses the same plan.
for(const [point,reach] of [[[10,0,4],6],[[10,0,9],PICK_WALL.minReach],[[10,0,-20],PICK_WALL.maxReach],[[16,0,10],6]]) {
  const plan=planCrystalWall([10,0,10],0,point);assert.ok(Math.abs(plan.reach-reach)<1e-9);
  assert.ok(plan.segments.length>=2&&plan.segments.length<=PICK_WALL.maxSegments);
  assert.ok(plan.segments.every((q,i)=>i===0||Math.abs(q.a[0]-plan.segments[i-1].b[0])<1e-12&&Math.abs(q.a[1]-plan.segments[i-1].b[1])<1e-12),'segments chain end to end');
  assert.equal(plan.segments[0].h0,PICK_WALL.rampStart);
}
s=fixture('pick');assert.equal(s.command('h',{type:'action',action:'special',seq:1,point:[16,0,10]}).ok,true);
assert.ok(s.snapshot().edits.every(e=>e.x>10&&Math.abs(e.z-10)<1e-9),'aimed east');
// Progressive rise: nothing at cast, front reaches the far end within durationTicks, identical after reload mid-rise.
s=fixture('pick');const cast=special(s).events[0],far=cast.path.at(-1),near=cast.path[1];
assert.equal(terrainHeight(s.snapshot(),far[0],far[2]),baseHeight(far[0],far[2]),'earth does not appear instantly');
for(let i=0;i<Math.floor(cast.durationTicks/3);i++)s.step();
assert.ok(terrainHeight(s.snapshot(),near[0],near[2])>baseHeight(near[0],near[2])+.3,'near end rising');
assert.equal(terrainHeight(s.snapshot(),far[0],far[2]),baseHeight(far[0],far[2]),'far end waits for the front');
assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))).snapshot(),s.snapshot(),'mid-rise reload');
for(let i=0;i<cast.durationTicks;i++)s.step();
assert.ok(terrainHeight(s.snapshot(),far[0],far[2])>baseHeight(far[0],far[2])+1.5,'far end fully raised');
// Front tosses an enemy exactly once (damage + launch arc), lifts another hero, never the caster.
s=fixture('pick');s.addPlayer({id:'friend'});c=s.checkpoint();
c.enemies=[createEnemy('tossed',[10,terrainHeight(c,10,5),5])];c.players[1].position=[10,terrainHeight(c,10,7),7];c.players[1].role='hero';s=loadSimulation(c);
special(s);let launched=null,hits=0,airborne=0,friendUp=0;
for(let i=0;i<120;i++){const ev=s.step();hits+=ev.filter(e=>e.kind==='hit'&&e.id==='tossed').length;const en=s.snapshot().enemies.find(e=>e.id==='tossed');
  if(en?.launchTick!==undefined){launched??=s.snapshot().tick;airborne=Math.max(airborne,en.position[1]-terrainHeight(s.snapshot(),en.position[0],en.position[2]));}
  friendUp=Math.max(friendUp,s.checkpoint().players.find(p=>p.id==='friend').vy);
  if(i===30)assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))).snapshot(),s.snapshot(),'mid-launch reload');}
assert.equal(hits,1,'one front hit');assert.ok(launched!==null&&airborne>1,'enemy flew');assert.equal(s.snapshot().enemies[0].hp,100-PICK_WALL.damage);
assert.ok(friendUp>4,'friendly hero lifted by the front');assert.equal(s.snapshot().enemies[0].launchTick,undefined,'landed');
// Lifetime: shatter event + bounded stone shards at exactly lifetimeTicks, progressive sink, then edits/deposits retire.
s=fixture('pick');const startTick=s.snapshot().tick;special(s);let shatter=null;
while(s.snapshot().tick<startTick+PICK_WALL.lifetimeTicks-1)s.step();
assert.equal(s.snapshot().edits.filter(e=>e.kind==='pick_wall').length,7);
const stones=s.snapshot().pickups.length;shatter=s.step().find(e=>e.kind==='pick_wall_shatter');
assert.equal(shatter?.reason,'expired');assert.equal(shatter.editIds.length,7);assert.equal(s.snapshot().pickups.length-stones,2);
for(let i=0;i<PICK_WALL.sinkTicks+1;i++)s.step();
assert.equal(s.snapshot().edits.filter(e=>e.kind==='pick_wall').length,0);assert.equal(s.snapshot().deposits.filter(d=>d.special==='pick_wall').length,0);
assert.equal(terrainHeight(s.snapshot(),far[0],far[2]),baseHeight(far[0],far[2]));
// Standing cap: a third cast shatters the caster's oldest wall (reason 'replaced', no shard reward) instead of failing.
s=fixture('pick');const ids=[];
for(let k=0;k<3;k++){c=s.checkpoint();c.players[0].specialTick=-1000;c.players[0].yaw=[0,2,-2][k];s=loadSimulation(c);const r=special(s,k+1);assert.equal(r.ok,true);ids.push(r.events.find(e=>e.kind==='pick_burst').cast);
  if(k===2){const ev=r.events.find(e=>e.kind==='pick_wall_shatter');assert.equal(ev.cast,ids[0]);assert.equal(ev.reason,'replaced');}for(let i=0;i<60;i++)s.step();}
assert.deepEqual([...new Set(s.snapshot().edits.filter(e=>e.kind==='pick_wall').map(e=>e.rupture.id))],ids.slice(1));
// Legacy permanent walls (pre-v2 saves) still load and stay put.
c=fixture('pick').checkpoint();c.edits.push({id:'legacyWall',kind:'pick_wall',x:12,z:12,radius:1,height:2.4});c.deposits.push({id:'legacyOre',kind:'stone',x:12,z:12,hits:0,maxHits:3,depleted:false,special:'pick_wall',editId:'legacyWall'});
s=loadSimulation(c);for(let i=0;i<10;i++)s.step();assert.ok(s.snapshot().edits.some(e=>e.id==='legacyWall'));
// Casting while standing still never lifts the caster: the ground under and around them (0.75 m, wider than the body) stays put for
// the whole rise, for both an unaimed cast and the closest legal aim.
for(const point of [undefined,[10,0,7]]){
  const s=fixture('pick'),c0=s.snapshot(),p0=c0.players[0].position;
  const around=state=>Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return terrainHeight(state,p0[0]+Math.sin(a)*.75,p0[2]+Math.cos(a)*.75);}).concat(terrainHeight(state,p0[0],p0[2]));
  const ground=around(c0);assert.equal(s.command('h',{type:'action',action:'special',seq:1,...(point?{point}:{})}).ok,true);
  for(let i=0;i<150;i++){s.command('h',{type:'input',seq:i+2,move:{x:0,z:0},yaw:0});s.step();}
  const c1=s.snapshot();assert.ok(Math.abs(c1.players[0].position[1]-p0[1])<1e-6,'caster stays on the ground');
  around(c1).forEach((h,i)=>assert.ok(Math.abs(h-ground[i])<1e-6,`ground near the caster unchanged ${i} ${point} ${(h-ground[i]).toFixed(4)}`));
  assert.ok(c1.edits.some(e=>e.wall&&terrainHeight(c1,e.x,e.z)>ground.at(-1)+.4),'the wall itself rose');
}
console.log(`terrain-specials: pass (${((performance.now()-started)/1000).toFixed(3)} s)`);
