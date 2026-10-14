import {friendlyEnemyHit} from './battle-mode.js';
import {terrainHeight,settleTerrainContents,PICK_WALL,createSunderRupture,sunderFront,makeTerrainRoom,wallSpec} from './terrain.js';
import {axeCleave} from './axe-cleave.js';
import {specialCooldown} from './special-cooldowns.js';
import {hasTalent} from './hero-progress.js';
import {DEPOSIT_CATALOG,depositReward} from './material-catalog.js';
// Geode Burst (pick talent): an ending crystal wall bursts into shards that wound and toss foes beside it.
export const GEODE_BURST=Object.freeze({radius:2.6,damage:70});
export const SPECIAL_LIMITS=Object.freeze({cooldown:240,edits:64,deposits:80}); // cooldown: pick (see special-cooldowns.js)
const fail=code=>({ok:false,code,events:[]});
// Pick of Riches: each segment of a Stonewhisper ridge is a real mineral that the pick's resonance tears up out of the
// ground, mined like any other seam. Mostly common stone and ore, and every cast surfaces at least one rich seam. Star
// metal stays out (meteors and deep mountain veins keep it special). Weights are per segment; kinds are DEPOSIT_CATALOG
// keys, so the reward, hits and label come from the catalog.
export const RIDGE_MINERALS=Object.freeze({
 common:Object.freeze({stone:46,iron:26,copper:14}),
 rich:Object.freeze({crystal:7,gold:5,mithril:2})});
export const RIDGE_KINDS=Object.freeze([...Object.keys(RIDGE_MINERALS.common),...Object.keys(RIDGE_MINERALS.rich)]);
export const isRichMineral=kind=>Object.hasOwn(RIDGE_MINERALS.rich,kind);
const ridgeUnit=(seed,key)=>{let h=2166136261^(seed>>>0);for(const c of String(key))h=Math.imul(h^c.charCodeAt(0),16777619);
 h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;return (h>>>0)/4294967296;};
const ridgePick=(table,u)=>{const e=Object.entries(table),total=e.reduce((n,[,w])=>n+w,0);let r=u*total;for(const [k,w] of e){r-=w;if(r<0)return k;}return e[0][0];};
/** Minerals for a cast's segments (caster end first). Deterministic in the world seed and cast id: no clock, no RNG.
 * If no segment rolled rich, one in the taller far half becomes a rich seam. */
export function ridgeMinerals(seed,castId,count){
 const all={...RIDGE_MINERALS.common,...RIDGE_MINERALS.rich};
 const kinds=Array.from({length:count},(_,i)=>ridgePick(all,ridgeUnit(seed,`${castId}:${i}`)));
 if(count&&!kinds.some(isRichMineral)){const half=Math.floor(count/2),i=Math.min(count-1,half+Math.floor(ridgeUnit(seed,`${castId}:at`)*(count-half)));kinds[i]=ridgePick(RIDGE_MINERALS.rich,ridgeUnit(seed,`${castId}:rich`));}
 return kinds;
}
/** Prepare the complete cast before allocating IDs, cooldown or damage. */
export function terrainSpecial(state,p,ctx,hitEnemyPart,m={}) {
  if(p.tool==='axe')return axeCleave(state,p,ctx,hitEnemyPart); // the cleave owns its own cooldown; old axe_sunder edits/deposits still load
  if(p.tool!=='pick')return null;
  if(state.tick-(p.specialTick??-1000)<specialCooldown('pick'))return fail('cooldown');
  return crystalWall(state,p,ctx,m,hitEnemyPart);
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
/** Timed segments grouped by cast (rupture id). Defaults to every timed kind; pass kind to narrow it. */
export const wallCasts=(state,owner,kind)=>{const casts=new Map();for(const e of state.edits)if(e.wall&&(kind?e.kind===kind:true)&&(!owner||e.wall.owner===owner)){if(!casts.has(e.rupture.id))casts.set(e.rupture.id,[]);casts.get(e.rupture.id).push(e);}return casts;};
function crystalWall(state,p,ctx,m,hitEnemyPart) {
  const plan=planCrystalWall(p.position,p.yaw,m.point);
  if([plan.start,plan.end].some(q=>Math.abs(q[0])>46||Math.abs(q[1])>46))return fail('outside_world');
  const n=plan.segments.length;
  makeTerrainRoom(state,n+state.pendingStarfalls.length);
  if(state.edits.length+state.pendingStarfalls.length+n>SPECIAL_LIMITS.edits||state.deposits.length+state.pendingStarfalls.length+n>SPECIAL_LIMITS.deposits)return fail('world_limit');
  const position=[p.position[0],terrainHeight(state,p.position[0],p.position[2]),p.position[2]],editIds=[],depositIds=[],events=[];
  // At most PICK_WALL.standing of a caster's walls stand: the oldest still-standing one shatters to make room.
  const standing=[...wallCasts(state,p.id,'pick_wall').values()].filter(list=>list.some(e=>e.wall.expireTick>state.tick)).sort((a,b)=>a[0].rupture.startTick-b[0].rupture.startTick);
  for(const list of standing.slice(0,Math.max(0,standing.length-PICK_WALL.standing+1)))shatterWall(state,list,ctx,events,'replaced',hitEnemyPart);
  p.specialTick=state.tick;
  const castId=ctx.nextId(state,'w'),rupture=createSunderRupture(castId,plan.start,plan.end,state.tick,'pick_wall');
  const minerals=ridgeMinerals(state.seed|0,castId,plan.segments.length);
  for(const [i,q] of plan.segments.entries()){
    const id=ctx.nextId(state,'s'),oreId=ctx.nextId(state,'o');editIds.push(id);depositIds.push(oreId);
    state.edits.push({id,kind:'pick_wall',x:q.x,z:q.z,radius:q.radius,height:Math.max(q.h0,q.h1),rupture:{...rupture,start:[...rupture.start],end:[...rupture.end]},
      wall:{a:q.a,b:q.b,h0:q.h0,h1:q.h1,expireTick:state.tick+PICK_WALL.lifetimeTicks,owner:p.id}});
    const kind=minerals[i];state.deposits.push({id:oreId,x:q.x,z:q.z,kind,hits:0,maxHits:DEPOSIT_CATALOG[kind].maxHits,depleted:false,special:'pick_wall',editId:id});
  }
  events.push({kind:'pick_burst',weapon:'pick',id:p.id,cast:castId,tick:state.tick,position,direction:[plan.direction[0],0,plan.direction[1]],
    start:plan.start,end:plan.end,durationTicks:rupture.durationTicks,expireTick:state.tick+PICK_WALL.lifetimeTicks,
    path:plan.segments.map(q=>[q.x,terrainHeight(state,q.x,q.z),q.z]),editIds,depositIds,minerals});
  return {ok:true,events};
}
/** Begin the sink of every segment of one timed cast now; deposits/edits retire after its sinkTicks in stepCrystalWalls. */
export function shatterWall(state,list,ctx,events,reason,hitEnemyPart) {
  const live=list.filter(e=>e.wall.expireTick>=state.tick);if(!live.length)return;
  for(const e of live)e.wall.expireTick=state.tick;
  const kind=list[0].kind,r=list[0].rupture,mid=[(r.start[0]+r.end[0])/2,(r.start[1]+r.end[1])/2];
  const drop=(k,e,amount=1)=>{if(state.pickups.length<256)state.pickups.push({id:ctx.nextId(state,'p'),kind:k,x:e.x,z:e.z,y:terrainHeight(state,e.x,e.z,false),amount});};
  // Shards: a small, bounded reward for a wall that stood its full minute (never for a replaced one). A closing chasm
  // leaves nothing new: its crystal seams were placed when it opened.
  // A ridge segment crumbles into a shard of its own mineral.
  if(reason==='expired'&&kind==='pick_wall')for(const [i,e] of live.entries())if(i%3===1)drop(depositReward(state.deposits.find(d=>d.editId===e.id)?.kind)?.kind??'stone',e);
  if(reason==='expired'&&kind==='wall')for(const [i,e] of live.entries()){if(i%2===0)drop('stone',e);if(i===live.length>>1)drop('gems',e);}
  const name=kind==='sunder'?'sunder_close':kind==='wall'?'raise_wall_shatter':'pick_wall_shatter';
  events.push({kind:name,cast:r.id,reason,tick:state.tick,position:[mid[0],terrainHeight(state,mid[0],mid[1]),mid[1]],editIds:live.map(e=>e.id)});
  const owner=kind==='pick_wall'&&hitEnemyPart&&state.players.find(q=>q.id===list[0].wall.owner);
  if(owner&&hasTalent(owner,'pick','geode')){
    const near=e=>live.some(q=>Math.hypot(e.position[0]-q.x,e.position[2]-q.z)<=GEODE_BURST.radius),hits=[];
    for(const enemy of [...state.enemies])if(near(enemy)&&!friendlyEnemyHit(state,enemy,{ownerId:owner.id})){
      hitEnemyPart(state,enemy,'torso',GEODE_BURST.damage,{tool:'pick',point:[enemy.position[0],enemy.position[1]+1,enemy.position[2]],ownerId:owner.id},ctx,events);
      hits.push(enemy.id);if(state.enemies.includes(enemy))enemy.launchTick=state.tick;
    }
    events.push({kind:'geode_burst',cast:r.id,by:owner.id,tick:state.tick,position:[mid[0],terrainHeight(state,mid[0],mid[1]),mid[1]],points:live.map(q=>[q.x,terrainHeight(state,q.x,q.z),q.z]),radius:GEODE_BURST.radius,hits});
  }
}
/** Fixed-tick life of timed segments, deterministic, no clocks. The front acts exactly once as it passes:
 * crystal walls and Raise Walls toss enemies (damage + launch, Raise Wall also shoves them off its footprint) and lift
 * heroes onto the crest; a Sunder front wounds and staggers enemies as the ground drops away. At expiry walls shatter
 * and chasms close; sunk segments and their deposits retire. */
export function stepCrystalWalls(state,ctx,hitEnemyPart,events) {
  if(!state.edits.some(e=>e.wall))return;
  const casts=wallCasts(state);
  for(const list of casts.values()){
    const kind=list[0].kind,spec=wallSpec(kind),r=list[0].rupture,owner=list[0].wall.owner,standing=list.some(e=>e.wall.expireTick>state.tick);
    const dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1],len=Math.max(.001,Math.hypot(dx,dz));
    const sideOf=q=>((q[0]-r.start[0])*dz-(q[2]-r.start[1])*dx)/len,alongOf=q=>((q[0]-r.start[0])*dx+(q[2]-r.start[1])*dz)/len;
    if(state.tick>r.startTick&&state.tick<=r.startTick+r.durationTicks){
      const now=sunderFront(r,state.tick),before=sunderFront(r,state.tick-1);
      // The earth is moving where the front has passed by ~half the settle band.
      const crossed=q=>{const along=alongOf(q),lead=.55;return Math.abs(sideOf(q))<spec.width&&along>=-.3&&along<=len+.3&&along>before.distance-lead&&along<=now.distance-lead;};
      for(const enemy of [...state.enemies])if(crossed(enemy.position)&&standing&&!friendlyEnemyHit(state,enemy,{ownerId:owner})){
        hitEnemyPart(state,enemy,'torso',spec.damage,{tool:kind==='pick_wall'?'pick':'spell',point:[...enemy.position],ownerId:owner},ctx,events);
        if(!state.enemies.includes(enemy))continue;
        if(kind==='sunder')enemy.slowUntil=Math.max(enemy.slowUntil??0,state.tick+spec.slowTicks);else enemy.launchTick=state.tick;
      }
      if(kind!=='sunder')for(const hero of state.players)if(hero.role==='hero'&&hero.id!==owner&&crossed(hero.position)&&hero.vy<=0)hero.vy=spec.heroLift;
    }
    // Raise Wall: an enemy thrown by the rising rampart is carried clear of its footprint while airborne, so foes land
    // beside the wall rather than on its crest. Derived from geometry each tick; nothing extra is saved.
    if(kind==='wall'&&standing)for(const enemy of state.enemies){
      if(enemy.launchTick===undefined)continue;
      const along=alongOf(enemy.position),side=sideOf(enemy.position);
      if(along<-spec.cap||along>len+spec.cap||Math.abs(side)>=spec.width+.35)continue;
      const push=Math.min(spec.shove,spec.width+.35-Math.abs(side)),sign=side>=0?1:-1;
      enemy.position[0]+=dz/len*push*sign;enemy.position[2]-=dx/len*push*sign;
    }
    if(state.tick===r.startTick+spec.lifetimeTicks)shatterWall(state,list,ctx,events,'expired',hitEnemyPart);
  }
  const gone=new Set(state.edits.filter(e=>e.wall&&state.tick>=e.wall.expireTick+wallSpec(e.kind).sinkTicks).map(e=>e.id));
  if(!gone.size)return;
  state.edits=state.edits.filter(e=>!gone.has(e.id));
  state.deposits=state.deposits.filter(d=>!(WALL_DEPOSITS.includes(d.special)&&gone.has(d.editId)));
}
/** Deposit specials that are a quarryable segment of a timed wall (mining one out sinks that segment). */
export const WALL_DEPOSITS=Object.freeze(['pick_wall','wall']);
export function collapseMinedWall(state,ore) {
  if(!WALL_DEPOSITS.includes(ore.special))return;
  const edit=state.edits.find(e=>e.id===ore.editId);
  // v2 segments sink over PICK_WALL.sinkTicks (never an instant drop); legacy kernels keep their removal contract.
  if(edit?.wall){edit.wall.expireTick=Math.min(edit.wall.expireTick,state.tick);return;}
  state.edits=state.edits.filter(e=>e.id!==ore.editId);
  settleTerrainContents(state);
}
