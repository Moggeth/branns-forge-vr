import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {baseHeight,mountainHeight,moveOnTerrain} from '../shared/terrain.js';
import {createEnemy} from '../shared/combat.js';
const started=performance.now();
function fixture(tool='axe',x=10,z=10) {
  const sim=createSimulation();sim.addPlayer({id:'h'});
  const c=sim.checkpoint();c.landmarks=false;c.players[0].position=[x,terrainHeight(c,x,z),z];c.players[0].tool=tool;
  return loadSimulation(c);
}
const special=(s,seq=1)=>s.command('h',{type:'action',action:'special',seq});
const gameplay=c=>({...c,players:c.players.map(p=>({...p,seq:0}))});

for(const tool of ['axe','pick']) {
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
  if(tool==='pick')assert.ok(e.path.at(-1)[0]>e.path[0][0]+2);
}

// Reserve edits, meteor reservations and all deposits atomically.
for(const tool of ['axe','pick'])for(const cap of ['edits','deposits']) {
  let s=fixture(tool),c=s.checkpoint();
  if(cap==='edits')c.edits=Array.from({length:59},(_,i)=>({id:`e${i}`,kind:'raise',x:-30,z:-30,radius:6,height:2}));
  else c.deposits=Array.from({length:78},(_,i)=>({id:`o${i}`,kind:'stone',x:-30,z:-30,hits:0,maxHits:3,depleted:false}));
  s=loadSimulation(c);const before=s.checkpoint();assert.equal(special(s).code,'world_limit');
  assert.deepEqual(gameplay(s.checkpoint()),gameplay(before));
}
let s=fixture('pick',45,45);let c=s.checkpoint();c.players[0].yaw=Math.PI;s=loadSimulation(c);const edge=s.checkpoint();
assert.equal(special(s).code,'outside_world');assert.deepEqual(gameplay(s.checkpoint()),gameplay(edge));

// Mine one permanent segment: the linked terrain collapses once, rewards once, persists.
s=fixture('pick');special(s);let ore=s.snapshot().deposits.find(d=>d.special==='pick_wall');
const peak=terrainHeight(s.snapshot(),ore.x,ore.z);
for(let i=0;i<3;i++) {
  c=s.checkpoint();c.players[0].attackTick=-1000;
  c.players[0].position=[ore.x,terrainHeight(c,ore.x,ore.z+2),ore.z+2];c.players[0].yaw=0;s=loadSimulation(c);
  const result=s.command('h',{type:'action',action:'strike',seq:i+2,tool:'pick',targetId:ore.id,point:[ore.x,terrainHeight(s.snapshot(),ore.x,ore.z),ore.z],normal:[0,1,0]});
  assert.equal(result.ok,true);
}
assert.equal(s.snapshot().deposits.find(d=>d.id===ore.id).depleted,true);
assert.ok(!s.snapshot().edits.some(e=>e.id===ore.editId));assert.ok(terrainHeight(s.snapshot(),ore.x,ore.z)<peak-1);
assert.equal(s.snapshot().pickups.filter(q=>q.kind==='stone').length,2); // Existing sanctuary cache plus reward.
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());
const clean=s.checkpoint();
for(const mutate of [c=>c.deposits.find(d=>d.id===ore.id).depleted=false,c=>c.edits[0].height=999,c=>c.deposits.find(d=>d.special==='pick_wall'&&!d.depleted).editId='missing',c=>c.edits[0].kind='raise']) {
  c=structuredClone(clean);mutate(c);assert.throws(()=>loadSimulation(c));
}
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

// Raised wall blocks walking; collapse reopens the exact corridor.
s=fixture('pick');special(s);const world=s.snapshot();ore=world.deposits.find(d=>d.special==='pick_wall');
pos=[ore.x,terrainHeight(world,ore.x,ore.z+2),ore.z+2];
for(let i=0;i<90;i++){moveOnTerrain(world,pos,0,-1/12);pos[1]=terrainHeight(world,pos[0],pos[2]);}
assert.ok(pos[2]>ore.z,'cannot walk straight through an impaling wall');

// Existing saves outside the new mountain rim recover; input can then walk inward.
s=fixture('axe',54,0);s.step();assert.ok(s.snapshot().players[0].position[0]<=49.72);
const outside=s.snapshot().players[0].position[0];
for(let i=0;i<60;i++){s.command('h',{type:'input',seq:i+1,move:{x:-1,z:0},yaw:Math.PI/2});s.step();}
assert.ok(s.snapshot().players[0].position[0]<outside-1);

// Reserved future meteors count toward capacity before the special changes any gameplay.
s=fixture('pick');c=s.checkpoint();c.edits=Array.from({length:57},(_,i)=>({id:`r${i}`,kind:'raise',x:-30,z:-30,radius:6,height:2}));
c.pendingStarfalls=[{id:'meteorPending',x:-20,z:-20,radius:5,impactTick:48}];s=loadSimulation(c);
const reserved=s.checkpoint();assert.equal(special(s).code,'world_limit');assert.deepEqual(gameplay(s.checkpoint()),gameplay(reserved));

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
console.log(`terrain-specials: pass (${((performance.now()-started)/1000).toFixed(3)} s)`);
