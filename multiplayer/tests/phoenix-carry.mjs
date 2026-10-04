import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy,partPosition} from '../shared/combat.js';
import {PHOENIX_CARRY,carryPose,startCarry} from '../shared/phoenix-carry.js';

function fixture(){const s=createSimulation();s.addPlayer({id:'h'});const c=s.checkpoint();c.enemies=[createEnemy('enemy',[0,terrainHeight(c,0,-2),-2],'skeleton')];return loadSimulation(c);}
const act=(s,seq,action,extra={})=>s.command('h',{type:'action',seq,action,...extra});
const advance=(s,n)=>{for(let i=0;i<n;i++)s.step();};
// Emberwing shot at the head; curve [0,0,0] is a plain arrow, anything else is the phoenix.
function shootHead(s,curve){
  const p=s.snapshot().players[0],e=s.snapshot().enemies[0],at=partPosition(e,'head'),origin=[p.position[0],at[1],p.position[2]],d=at.map((n,i)=>n-origin[i]),l=Math.hypot(...d);
  assert.equal(act(s,1,'equip',{tool:'bow'}).ok,true);assert.equal(act(s,2,'fire',{origin,direction:d.map(n=>n/l),curve,draw:1}).ok,true);
  // The host reports the trail point where it crosses the skull (the head sphere sits a little below partPosition).
  // Skeletons keep walking, so aim the report at where the skull is when the arrow gets there.
  let shot,head;for(let i=0;i<40;i++){s.step();shot=s.snapshot().projectiles[0];const now=s.snapshot().enemies[0].position;head=[now[0],now[1]+1.5,now[2]];if(shot.position[2]<=head[2])break;}
  const point=shot.trail.reduce((b,q)=>Math.hypot(...q.map((n,i)=>n-head[i]))<Math.hypot(...b.map((n,i)=>n-head[i]))?q:b);
  return s.projectileContact({targetId:e.id,part:'head',point,normal:[0,0,1],localPoint:[0,0,0],localQuaternion:[0,0,0,1],boneName:'head',projectileId:shot.id});
}

// A plain arrow headshot just drops the skull.
let s=fixture();let r=shootHead(s,[0,0,0]);assert.equal(r.ok,true,JSON.stringify(r));
assert.ok(!s.snapshot().detachedParts.some(d=>d.carry));assert.ok(!r.events.some(e=>e.kind==='phoenix_carry'));

// A phoenix headshot: the skull is carried off with the arrow still in it.
s=fixture();r=shootHead(s,[0,.002,0]);assert.equal(r.ok,true);
const start=r.events.find(e=>e.kind==='phoenix_carry');assert.ok(start,'carry event');
let skull=s.snapshot().detachedParts.find(d=>d.id===start.id);assert.equal(skull.part,'head');assert.ok(skull.carry);
assert.ok(s.snapshot().embeds.some(e=>e.id===start.arrowId&&e.targetId===skull.id),'phoenix arrow rides the skull');
const from=[...skull.position];
// Nobody can grab a skull out of the air.
assert.equal(act(s,3,'collectTarget',{targetId:skull.id}).ok,false);
// Mid-flight: it has gone a good way along the shot, above the ground, matching the shared pose for that tick.
advance(s,150);skull=s.snapshot().detachedParts.find(d=>d.id===start.id);assert.ok(skull.carry);
const pose=carryPose(skull.carry,s.snapshot().tick,(x,z)=>terrainHeight(s.checkpoint(),x,z));
assert.ok(Math.hypot(...skull.position.map((n,i)=>n-pose.position[i]))<1e-9);
assert.ok(skull.position[2]<from[2]-8,'flies on along the heading (-z)');assert.ok(skull.position[1]>terrainHeight(s.checkpoint(),skull.position[0],skull.position[2])+.5);
// A save mid-flight drops the carry (never saved) and the skull falls from where it was.
const reloaded=loadSimulation(s.checkpoint());const ghost=reloaded.snapshot().detachedParts.find(d=>d.id===start.id);assert.equal(ghost.carry,undefined);
const y0=ghost.position[1];advance(reloaded,90);assert.ok(reloaded.snapshot().detachedParts.find(d=>d.id===start.id).position[1]<y0-.5,'falls after reload');
// Back to you: dropped at the archer's feet, the phoenix (its arrow) is gone, the skull settles as an ordinary skull.
let drop=null;for(let i=0;i<PHOENIX_CARRY.seconds*60+10&&!drop;i++)drop=(s.step()||[]).find(e=>e.kind==='phoenix_drop')||null;
assert.ok(drop,'drops');assert.equal(drop.id,start.id);skull=s.snapshot().detachedParts.find(d=>d.id===start.id);assert.equal(skull.carry,undefined);
const archer=s.snapshot().players[0].position;assert.ok(Math.hypot(skull.position[0]-archer[0],skull.position[2]-archer[2])<1.6,'brought back to the archer');
assert.ok(!s.snapshot().embeds.some(e=>e.id===start.arrowId),'the phoenix flew off');
advance(s,240);skull=s.snapshot().detachedParts.find(d=>d.id===start.id);
assert.ok(Math.abs(skull.position[1]-terrainHeight(s.checkpoint(),skull.position[0],skull.position[2]))<1,'landed');
assert.equal(act(s,4,'collectTarget',{targetId:skull.id}).ok,true,'grabbable at your feet');
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot(),s.snapshot());

// Pure path: continuous, bounded, homes on wherever the archer walked to.
const c=startCarry({position:[0,2,0],velocity:[0,0,-20],by:'h',arrow:'a1',tick:0});let last=null;
for(let t=0;t<=PHOENIX_CARRY.seconds*60;t+=.5){const p=carryPose(c,t,()=>0,[6,0,9]);if(last)assert.ok(Math.hypot(...p.position.map((n,i)=>n-last[i]))<.6,'continuous');last=p.position;assert.ok(Math.abs(Math.hypot(...p.quaternion)-1)<1e-9);}
const end=carryPose(c,PHOENIX_CARRY.seconds*60,()=>0,[6,0,9]);assert.ok(end.done&&Math.hypot(end.position[0]-6,end.position[2]-9)<1.2&&end.position[1]>1);
for(let t=0;t<PHOENIX_CARRY.seconds*60;t+=7){const p=carryPose(startCarry({position:[52,2,0],velocity:[1,0,0],arrow:'b',tick:0}),t,()=>0,[50,0,0]).position;assert.ok(Math.abs(p[0])<=PHOENIX_CARRY.bounds,'stays inside the world');}
console.log('phoenix-carry: phoenix headshots carry the skull off and bring it back, plain headshots do not, saves stay compatible');
