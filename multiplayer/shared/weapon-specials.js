import {terrainHeight,settleTerrainContents,PICK_WALL,createSunderRupture,sunderFront} from './terrain.js';
export const SPECIAL_LIMITS=Object.freeze({cooldown:240,edits:64,deposits:80});
const fail=code=>({ok:false,code,events:[]});
/** Prepare the complete cast before allocating IDs, cooldown or damage. */
export function terrainSpecial(state,p,ctx,hitEnemyPart,m={}) {
  if(!['axe','pick'].includes(p.tool))return null;
  if(state.tick-(p.specialTick??-1000)<SPECIAL_LIMITS.cooldown)return fail('cooldown');
  if(p.tool==='pick')return crystalWall(state,p,ctx,m);
  const axe=p.tool==='axe',kind=axe?'axe_sunder':'pick_wall',f=[-Math.sin(p.yaw)||0,-Math.cos(p.yaw)||0],r=[Math.cos(p.yaw),-Math.sin(p.yaw)];
  const points=Array.from({length:axe?6:7},(_,i)=>{
    const forward=axe?1.2+1.3*i:.9+.8*i,side=axe?0:.075*i*i;
    return {x:p.position[0]+f[0]*forward+r[0]*side,z:p.position[2]+f[1]*forward+r[1]*side};
  });
  if(points.some(q=>Math.abs(q.x)>46||Math.abs(q.z)>46))return fail('outside_world');
  const orePoints=axe?points.filter((_,i)=>i%2===1):points;
  if(state.edits.length+state.pendingStarfalls.length+points.length>64||state.deposits.length+state.pendingStarfalls.length+orePoints.length>80)return fail('world_limit');
  const position=[p.position[0],terrainHeight(state,p.position[0],p.position[2]),p.position[2]],events=[],editIds=[],depositIds=[];
  p.specialTick=state.tick;
  for(const point of points) {
    const id=ctx.nextId(state,'s');editIds.push(id);
    state.edits.push({id,kind,...point,radius:axe?1.35:1,height:axe?-.12:2.4});
    if(orePoints.includes(point)) {
      const oreId=ctx.nextId(state,'o');depositIds.push(oreId);
      state.deposits.push({id:oreId,...point,kind:'stone',hits:0,maxHits:3,depleted:false,special:kind,...(!axe?{editId:id}:{})});
    }
  }
  // Damage follows the actual curved/straight footprint, never a radius behind the caster.
  for(const enemy of [...state.enemies])if(Math.abs(enemy.position[1]-position[1])<4&&points.some(q=>Math.hypot(enemy.position[0]-q.x,enemy.position[2]-q.z)<(axe?1.6:1.1))) {
    hitEnemyPart(state,enemy,axe?'leftArm':'torso',axe?55:65,{tool:p.tool,point:[...enemy.position],ownerId:p.id},ctx,events);
    if(axe&&state.enemies.includes(enemy)) {
      enemy.position[0]=Math.max(-49,Math.min(49,enemy.position[0]+f[0]*1.1));
      enemy.position[2]=Math.max(-49,Math.min(49,enemy.position[2]+f[1]*1.1));
    }
  }
  settleTerrainContents(state);
  events.push({kind:axe?'axe_cleave':'pick_burst',weapon:p.tool,id:p.id,tick:state.tick,position,direction:[f[0],0,f[1]],path:points.map(q=>[q.x,terrainHeight(state,q.x,q.z),q.z]),editIds,depositIds});
  return {ok:true,events};
}
/** Pure plan of a Stonewhisper wall from the caster toward an aimed ground point (same math drives the client preview).
 * Reach clamps to PICK_WALL.minReach..maxReach; no/degenerate aim falls back to facing at full reach. Segments start low
 * at the caster end (a walkable ramp) and reach full height after rampStart+rampSlope*distance. */
export function planCrystalWall(position,yaw,point) {
  let fx=-Math.sin(yaw)||0,fz=-Math.cos(yaw)||0,reach=PICK_WALL.maxReach;
  if(Array.isArray(point)&&point.length===3&&point.every(Number.isFinite)){
    const dx=point[0]-position[0],dz=point[2]-position[2],d=Math.hypot(dx,dz);
    if(d>.5){fx=dx/d;fz=dz/d;reach=Math.min(PICK_WALL.maxReach,Math.max(PICK_WALL.minReach,d));}
  }
  const start=[position[0]+fx*PICK_WALL.start,position[2]+fz*PICK_WALL.start],end=[position[0]+fx*reach,position[2]+fz*reach];
  const length=reach-PICK_WALL.start,count=Math.min(PICK_WALL.maxSegments,Math.max(2,Math.round(length/PICK_WALL.segment)));
  const lift=d=>Math.min(PICK_WALL.peak,PICK_WALL.rampStart+PICK_WALL.rampSlope*d);
  const segments=Array.from({length:count},(_,i)=>{
    const d0=length*i/count,d1=length*(i+1)/count,a=[start[0]+fx*d0,start[1]+fz*d0],b=[start[0]+fx*d1,start[1]+fz*d1];
    return {a,b,h0:lift(d0),h1:lift(d1),x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,radius:(d1-d0)/2+PICK_WALL.width};
  });
  return {start,end,direction:[fx,fz],reach,length,segments};
}
const wallCasts=(state,owner)=>{const casts=new Map();for(const e of state.edits)if(e.kind==='pick_wall'&&e.wall&&(!owner||e.wall.owner===owner)){if(!casts.has(e.rupture.id))casts.set(e.rupture.id,[]);casts.get(e.rupture.id).push(e);}return casts;};
function crystalWall(state,p,ctx,m) {
  const plan=planCrystalWall(p.position,p.yaw,m.point);
  if([plan.start,plan.end].some(q=>Math.abs(q[0])>46||Math.abs(q[1])>46))return fail('outside_world');
  const n=plan.segments.length;
  if(state.edits.length+state.pendingStarfalls.length+n>SPECIAL_LIMITS.edits||state.deposits.length+state.pendingStarfalls.length+n>SPECIAL_LIMITS.deposits)return fail('world_limit');
  const position=[p.position[0],terrainHeight(state,p.position[0],p.position[2]),p.position[2]],editIds=[],depositIds=[],events=[];
  // At most PICK_WALL.standing of a caster's walls stand: the oldest still-standing one shatters to make room.
  const standing=[...wallCasts(state,p.id).values()].filter(list=>list.some(e=>e.wall.expireTick>state.tick)).sort((a,b)=>a[0].rupture.startTick-b[0].rupture.startTick);
  for(const list of standing.slice(0,Math.max(0,standing.length-PICK_WALL.standing+1)))shatterWall(state,list,ctx,events,'replaced');
  p.specialTick=state.tick;
  const castId=ctx.nextId(state,'w'),rupture=createSunderRupture(castId,plan.start,plan.end,state.tick,'pick_wall');
  for(const q of plan.segments){
    const id=ctx.nextId(state,'s'),oreId=ctx.nextId(state,'o');editIds.push(id);depositIds.push(oreId);
    state.edits.push({id,kind:'pick_wall',x:q.x,z:q.z,radius:q.radius,height:Math.max(q.h0,q.h1),rupture:{...rupture,start:[...rupture.start],end:[...rupture.end]},
      wall:{a:q.a,b:q.b,h0:q.h0,h1:q.h1,expireTick:state.tick+PICK_WALL.lifetimeTicks,owner:p.id}});
    state.deposits.push({id:oreId,x:q.x,z:q.z,kind:'stone',hits:0,maxHits:3,depleted:false,special:'pick_wall',editId:id});
  }
  events.push({kind:'pick_burst',weapon:'pick',id:p.id,cast:castId,tick:state.tick,position,direction:[plan.direction[0],0,plan.direction[1]],
    start:plan.start,end:plan.end,durationTicks:rupture.durationTicks,expireTick:state.tick+PICK_WALL.lifetimeTicks,
    path:plan.segments.map(q=>[q.x,terrainHeight(state,q.x,q.z),q.z]),editIds,depositIds});
  return {ok:true,events};
}
/** Begin the sink of every segment of one wall now; deposits/edits retire after PICK_WALL.sinkTicks in stepCrystalWalls. */
function shatterWall(state,list,ctx,events,reason) {
  const live=list.filter(e=>e.wall.expireTick>=state.tick);if(!live.length)return;
  for(const e of live)e.wall.expireTick=state.tick;
  const r=list[0].rupture,mid=[(r.start[0]+r.end[0])/2,(r.start[1]+r.end[1])/2];
  // Crystal shards: a small, bounded reward for a wall that stood its full minute (never for a replaced one).
  if(reason==='expired')for(const [i,e] of live.entries())if(i%3===1&&state.pickups.length<256)state.pickups.push({id:ctx.nextId(state,'p'),kind:'stone',x:e.x,z:e.z,y:terrainHeight(state,e.x,e.z,false),amount:1});
  events.push({kind:'pick_wall_shatter',cast:r.id,reason,tick:state.tick,position:[mid[0],terrainHeight(state,mid[0],mid[1]),mid[1]],editIds:live.map(e=>e.id)});
}
/** Fixed-tick crystal wall life: the rising front tosses enemies (damage + launch) and lifts heroes exactly once as it
 * passes beneath them; walls shatter at expiry; sunk segments and their deposits retire. Deterministic, no clocks. */
export function stepCrystalWalls(state,ctx,hitEnemyPart,events) {
  if(!state.edits.some(e=>e.wall))return;
  for(const list of wallCasts(state).values()){
    const r=list[0].rupture,owner=list[0].wall.owner;
    if(state.tick>r.startTick&&state.tick<=r.startTick+r.durationTicks){
      const now=sunderFront(r,state.tick),before=sunderFront(r,state.tick-1),dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1],len=Math.max(.001,now.length);
      // The earth is lifting where the front has passed by ~half the settle band.
      const crossed=q=>{const along=((q[0]-r.start[0])*dx+(q[2]-r.start[1])*dz)/len,side=Math.abs((q[0]-r.start[0])*dz-(q[2]-r.start[1])*dx)/len,lead=.55;
        return side<PICK_WALL.width&&along>=-.3&&along<=len+.3&&along>before.distance-lead&&along<=now.distance-lead;};
      for(const enemy of [...state.enemies])if(crossed(enemy.position)&&list.some(e=>e.wall.expireTick>state.tick)){
        hitEnemyPart(state,enemy,'torso',PICK_WALL.damage,{tool:'pick',point:[...enemy.position],ownerId:owner},ctx,events);
        if(state.enemies.includes(enemy))enemy.launchTick=state.tick;
      }
      for(const hero of state.players)if(hero.role==='hero'&&hero.id!==owner&&crossed(hero.position)&&hero.vy<=0)hero.vy=PICK_WALL.heroLift;
    }
    if(state.tick===r.startTick+PICK_WALL.lifetimeTicks)shatterWall(state,list,ctx,events,'expired');
  }
  const gone=new Set(state.edits.filter(e=>e.wall&&state.tick>=e.wall.expireTick+PICK_WALL.sinkTicks).map(e=>e.id));
  if(!gone.size)return;
  state.edits=state.edits.filter(e=>!gone.has(e.id));
  state.deposits=state.deposits.filter(d=>!(d.special==='pick_wall'&&gone.has(d.editId)));
}
export function collapseMinedWall(state,ore) {
  if(ore.special!=='pick_wall')return;
  const edit=state.edits.find(e=>e.id===ore.editId);
  // v2 segments sink over PICK_WALL.sinkTicks (never an instant drop); legacy kernels keep their removal contract.
  if(edit?.wall){edit.wall.expireTick=Math.min(edit.wall.expireTick,state.tick);return;}
  state.edits=state.edits.filter(e=>e.id!==ore.editId);
  settleTerrainContents(state);
}
