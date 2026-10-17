// One deterministic surface contract for authority, rendering and saved worlds.
export const TERRAIN_LIMITS = Object.freeze({bound:55, mountainStart:46, mountainCrest:55, deformation:6, axeScar:.65, slope:1.15, rim:50});
import {HOME_SITES,WORLD_EXTENT,keepCarve,onKeepGround} from './keep-sites.js';
import {lakeBasin} from './larimar-cove.js';
import {inUnderway,underwayFloor,moveUnderway} from './underways/space.js';
import {worldFor} from './worldgen/registry.js';
import {modeTerrainAt} from './world-modes.js';
import {activeWorld, thingLimit} from './world-extent.js';
/** Undeformed ground of a generated world at sim (x, z): a mode's own floor (dungeon interiors) or the overworld. */
export function worldBaseHeight(world, x, z) {const own = modeTerrainAt(x, z); return own ? own.heightAt(x, z) : world.heightAt(x, z);}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
export const SUNDER_SETTLE_DISTANCE=1.1;
export const sunderDurationTicks=length=>Math.max(36,Math.min(120,Math.ceil(length/12*60)+12));
/** Stonewhisper crystal wall: a chain of capsule kernels (continuous crest, no saddles between segments) that rises
 * behind a 10 m/s front, stands for one minute, then sinks back over SINK ticks. One edit per mineable segment. */
export const PICK_WALL=Object.freeze({width:1.1,peak:2.4,rampStart:.55,rampSlope:.8,start:1.6,minReach:3.5,maxReach:8.7,segment:1,maxSegments:7,
  cap:.3,speed:10,lifetimeTicks:3600,sinkTicks:36,warnTicks:180,standing:2,launchTicks:42,launchPeak:1.6,heroLift:6.5,damage:65});
export const pickWallDurationTicks=length=>Math.max(24,Math.ceil(length/PICK_WALL.speed*60)+10);
/** God's Raise Wall: a geode rampart drawn along a line. Same timed-capsule machinery as the crystal wall, bigger: a flat
 * crest (plateau) between steep faces, tapering ends that are walkable ramps, one quarryable deposit per segment. */
export const RAISE_WALL=Object.freeze({width:1.75,peak:3.2,plateau:1.7,endHeight:.35,ramp:4,cap:.5,segment:2.5,minSegments:2,maxSegments:8,
  speed:9,lifetimeTicks:3600,sinkTicks:48,warnTicks:180,standing:3,launchTicks:42,launchPeak:1.6,heroLift:7.6,damage:45,shove:.14});
/** God's Sunder: a chasm torn along a line. A steep-walled trench with a flat floor and spoil banks on both lips; its
 * ends ramp up so anything caught inside can walk out. It closes again after its lifetime (the earth rises back). */
export const SUNDER=Object.freeze({width:1.3,depth:2.4,plateau:1.45,bank:.75,bankOut:3.1,endHeight:.3,ramp:2.4,cap:.55,segment:2.5,minSegments:2,maxSegments:8,
  lifetimeTicks:3600,sinkTicks:72,warnTicks:180,standing:3,damage:40,slowTicks:150,seams:2});
/** Timed capsule segments (edit.wall descriptor): tuning per edit kind. Mastery/upgrades scale these tables. */
export const WALL_SPECS=Object.freeze({pick_wall:PICK_WALL,wall:RAISE_WALL,sunder:SUNDER});
export const wallSpec=kind=>WALL_SPECS[kind]||PICK_WALL;
/** Segments for a drawn God line of `length` metres (Raise Wall and Sunder share the count). */
export const earthLineSegments=length=>Math.min(RAISE_WALL.maxSegments,Math.max(RAISE_WALL.minSegments,Math.round(length/RAISE_WALL.segment)));
export const raiseWallDurationTicks=length=>Math.max(24,Math.ceil(length/RAISE_WALL.speed*60)+10);
const RUPTURE_DURATION={sunder:sunderDurationTicks,pick_wall:pickWallDurationTicks,wall:raiseWallDurationTicks};
const xz=p=>p.length===3?[p[0],p[2]]:[p[0],p[1]];
export function createSunderRupture(id,start,end,startTick,kind='sunder') {
  const a=xz(start),b=xz(end),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  return {id,start:a,end:b,startTick,durationTicks:RUPTURE_DURATION[kind](length)};
}
export function sunderFront(rupture,tick=Infinity) {
  const length=Math.hypot(rupture.end[0]-rupture.start[0],rupture.end[1]-rupture.start[1]);
  const progress=clamp((tick-rupture.startTick)/rupture.durationTicks,0,1);
  return {length,progress,distance:progress*(length+SUNDER_SETTLE_DISTANCE),fraction:clamp(progress*(length+SUNDER_SETTLE_DISTANCE)/Math.max(.001,length),0,1)};
}
/** 0..1 sink of an expiring/mined crystal wall segment (1 = fully gone). */
export function wallSink(edit,tick=Infinity) {
  const w=edit.wall;if(!w||tick<=w.expireTick)return 0;
  return smooth(clamp((tick-w.expireTick)/wallSpec(edit.kind).sinkTicks,0,1));
}
export function terrainEditScale(edit,tick=Infinity,x=edit.x,z=edit.z) {
  const sink=edit.wall?1-wallSink(edit,tick):1;
  const r=edit.rupture;if(!r||tick>=r.startTick+r.durationTicks)return sink;
  if(tick<=r.startTick)return 0;
  const front=sunderFront(r,tick),dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1];
  const along=clamp(((x-r.start[0])*dx+(z-r.start[1])*dz)/Math.max(.001,front.length),0,front.length);
  return smooth(clamp((front.distance-along)/SUNDER_SETTLE_DISTANCE,0,1))*sink;
}
/** Profile of a v2 crystal wall segment: height lerps h0->h1 along a->b with a smooth falloff to `width` beside it and
 * a short `cap` past each end, so neighbours join into one crest yet a mined segment leaves a walkable breach. */
export function wallProfile(w,x,z,spec=PICK_WALL) {
  const dx=w.b[0]-w.a[0],dz=w.b[1]-w.a[1],l=Math.hypot(dx,dz),ux=dx/l,uz=dz/l,px=x-w.a[0],pz=z-w.a[1];
  const along=px*ux+pz*uz,over=along<0?-along:along>l?along-l:0,side=Math.abs(px*uz-pz*ux);
  const t=1-Math.hypot(side,over*spec.width/spec.cap)/spec.width;
  return t<=0?0:(w.h0+(w.h1-w.h0)*clamp(along/l,0,1))*smooth(Math.min(1,t*(spec.plateau||1)));
}
/** Sunder chasm segment: a flat-floored trench (negative, h0/h1 are depths) plus a spoil bank beyond each lip.
 * Returns [trench<=0, bank>=0] in CHASM; neighbours combine by min/max so joints never double up. */
export const CHASM=[0,0];
export function chasmProfile(w,x,z,spec=SUNDER) {
  const dx=w.b[0]-w.a[0],dz=w.b[1]-w.a[1],l=Math.hypot(dx,dz),ux=dx/l,uz=dz/l,px=x-w.a[0],pz=z-w.a[1];
  const along=px*ux+pz*uz,over=along<0?-along:along>l?along-l:0,side=Math.abs(px*uz-pz*ux);
  const depth=w.h0+(w.h1-w.h0)*clamp(along/l,0,1),scale=depth/spec.depth;
  const t=1-Math.hypot(side,over*spec.width/spec.cap)/spec.width;
  CHASM[0]=t<=0?0:-depth*smooth(Math.min(1,t*spec.plateau));
  const centre=(spec.width+spec.bankOut)/2,half=(spec.bankOut-spec.width)/2,b=1-Math.hypot(side-centre,over*half/spec.cap)/half;
  CHASM[1]=b<=0?0:spec.bank*scale*smooth(b);
  return CHASM;
}
const sinking=(e,tick)=>e.wall&&tick>=e.wall.expireTick&&tick<=e.wall.expireTick+wallSpec(e.kind).sinkTicks;
export function hasActiveTerrain(edits,tick) {return edits.some(e=>e.rupture&&tick>=e.rupture.startTick&&tick<=e.rupture.startTick+e.rupture.durationTicks||sinking(e,tick));}
const editStamp=e=>`${e.id}|${e.kind}|${e.x}|${e.z}|${e.radius}|${e.height}|${e.rupture?JSON.stringify(e.rupture):''}|${e.wall?JSON.stringify(e.wall):''}`;
// A timestamp changes only for a kernel intersecting the moving front; kernels
// ahead of it and permanently completed earth do not invalidate render work.
function animationStamp(e,tick) {
  if(e.wall&&tick>e.wall.expireTick)return 'sink'+wallSink(e,tick);
  if(!e.rupture)return '';
  const r=e.rupture,f=sunderFront(r,tick),dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1];
  const along=((e.x-r.start[0])*dx+(e.z-r.start[1])*dz)/Math.max(.001,f.length);
  const low=Math.max(0,along-e.radius),high=Math.min(f.length,along+e.radius)+SUNDER_SETTLE_DISTANCE;
  return clamp((f.distance-low)/Math.max(.001,high-low),0,1);
}
export function terrainFrameKey(edits=[],tick=Infinity) {return edits.map(e=>`${editStamp(e)}@${animationStamp(e,tick)}`).join(';');}
/** Dirty circles include added/removed edits and only currently changing kernels.
 * Expand each radius by TERRAIN_GRID.step when refreshing mesh triangle normals. */
export function terrainDirtyEdits(previous=[],next=[],previousTick=Infinity,tick=Infinity) {
  const old=new Map(previous.map(e=>[e.id,e])),dirty=[];
  for(const e of next){const before=old.get(e.id);old.delete(e.id);if(!before||editStamp(before)!==editStamp(e)){if(before)dirty.push(before);dirty.push(e);}else if(animationStamp(before,previousTick)!==animationStamp(e,tick))dirty.push(e);}
  dirty.push(...old.values());return dirty;
}
export function validateTerrainRupture(edit,tick) {
  const r=edit.rupture;if(r===undefined)return true;
  const pair=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=thingLimit());
  if(!Object.hasOwn(RUPTURE_DURATION,edit.kind)||!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(r.id)||!pair(r.start)||!pair(r.end)||!Number.isSafeInteger(r.startTick)||r.startTick<0||r.startTick>tick)return false;
  const dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1],length=Math.hypot(dx,dz);
  if(length<.5||length>18.000001||r.durationTicks!==RUPTURE_DURATION[edit.kind](length))return false;
  const along=((edit.x-r.start[0])*dx+(edit.z-r.start[1])*dz)/(length*length),side=Math.abs((edit.x-r.start[0])*dz-(edit.z-r.start[1])*dx)/length;
  return along>=-1e-6&&along<=1+1e-6&&side<1e-5;
}
export function validateTerrainRuptures(edits,tick) {
  const casts=new Map();
  for(const e of edits){if(!validateTerrainRupture(e,tick))return false;if(e.rupture){const key=JSON.stringify(restoreRupture(e.rupture));if(casts.has(e.rupture.id)&&casts.get(e.rupture.id)!==key)return false;casts.set(e.rupture.id,key);}}
  return true;
}
const restoreRupture=r=>({id:r.id,start:[...r.start],end:[...r.end],startTick:r.startTick,durationTicks:r.durationTicks});
const restoreWall=w=>({a:[...w.a],b:[...w.b],h0:w.h0,h1:w.h1,expireTick:w.expireTick,owner:w.owner});
export function restoreTerrainEdit(e) {return {id:e.id,kind:e.kind,x:e.x,z:e.z,radius:e.radius,height:e.height,...(e.rupture?{rupture:restoreRupture(e.rupture)}:{}),...(e.wall?{wall:restoreWall(e.wall)}:{})};}
/** Footprint radius of a timed segment of half-length `half` (chasms include their spoil banks). */
export const wallSegmentRadius=(kind,half)=>{const spec=wallSpec(kind);return half+(kind==='sunder'?spec.bankOut:spec.width);};
/** Timed segment (crystal wall, Raise Wall or Sunder chasm): exact capsule on its cast's rupture line, bounded heights,
 * lifetime from the cast tick. A chasm stores positive depths in h0/h1 and a negative edit.height. */
export function validateWallSegment(e,tick) {
  const w=e.wall,r=e.rupture,spec=WALL_SPECS[e.kind],pair=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=thingLimit());
  if(!spec||!w||typeof w!=='object'||Array.isArray(w)||!r||!pair(w.a)||!pair(w.b)||typeof w.owner!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(w.owner))return false;
  const half=Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1])/2,top=spec.peak??spec.depth,chasm=e.kind==='sunder';
  if(![w.h0,w.h1].every(h=>Number.isFinite(h)&&h>0&&h<=top)||e.height!==(chasm?-1:1)*Math.max(w.h0,w.h1)||half<.05||half>spec.segment)return false;
  if(Math.abs(e.radius-wallSegmentRadius(e.kind,half))>1e-9||Math.abs(e.x-(w.a[0]+w.b[0])/2)>1e-9||Math.abs(e.z-(w.a[1]+w.b[1])/2)>1e-9)return false;
  if(!Number.isSafeInteger(w.expireTick)||w.expireTick<r.startTick||w.expireTick>r.startTick+spec.lifetimeTicks||(w.expireTick<r.startTick+spec.lifetimeTicks&&w.expireTick>tick))return false;
  const dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1],length=Math.hypot(dx,dz);
  return [w.a,w.b].every(p=>{const along=((p[0]-r.start[0])*dx+(p[1]-r.start[1])*dz)/(length*length),side=Math.abs((p[0]-r.start[0])*dz-(p[1]-r.start[1])*dx)/length;return along>=-1e-6&&along<=1+1e-6&&side<1e-5;});
}
export const validatePickWall=validateWallSegment;
export function mountainHeight(x,z) {
  const t=clamp((Math.max(Math.abs(x),Math.abs(z))-46)/9,0,1);
  if(!t)return 0;
  // The keeps are cut into their corners: a bowl, a pass and a hollow (shared/keep-sites.js).
  return smooth(t)*(14+2*Math.sin(x*.31+z*.17)+Math.cos(z*.43-x*.11))*(1-keepCarve(x,z));
}
export const TERRAIN_GRID=Object.freeze({half:60,segments:160,step:.75});
const meadowHeight=(x,z)=>.45*Math.sin(x*.09)*Math.cos(z*.07);
// Inside a keep's carve the meadow's roll levels out to the heart's own height, so plazas and buildings sit flush.
const rawBaseHeight=(x,z)=>{
  const carve=keepCarve(x,z),meadow=meadowHeight(x,z);
  if(!carve)return meadow+mountainHeight(x,z);
  const [sx,sz]=HOME_SITES[x+z<0?'party':'rivals'];
  return meadow+(meadowHeight(sx,sz)-meadow)*carve+mountainHeight(x,z)-lakeBasin(x,z); // Larimar Cove's lake bed
};
// Match THREE.PlaneGeometry(120,120,160,160).rotateX(-PI/2), including
// Float32 vertex storage and the diagonal xFraction+zFraction=1.
export function triangleHeight(sample,x,z) {
  const step=TERRAIN_GRID.step,x0=Math.floor((x+60)/step)*step-60,z0=Math.floor((z+60)/step)*step-60;
  const u=(x-x0)/step,v=(z-z0)/step;
  if(u===0&&v===0)return Math.fround(sample(x0,z0));
  const h10=Math.fround(sample(x0+step,z0)),h01=Math.fround(sample(x0,z0+step));
  if(u+v<=1)return Math.fround(sample(x0,z0))*(1-u-v)+h10*u+h01*v;
  return Math.fround(sample(x0+step,z0+step))*(u+v-1)+h10*(1-v)+h01*(1-u);
}
export function baseHeight(x,z) {return triangleHeight(rawBaseHeight,x,z);}
// Foundation tops are recorded at placement, independent of future terrain edits.
export const FOUNDATION_HALF=3,FOUNDATION_BLEND=2;
// Terrain that is not in the edit list: foundation tops and the baked-edit revision. Any change here is a full refresh.
export function foundationTerrainKey(state) {return (state.inventions?.structures||[]).filter(b=>b.type==='foundation').map(b=>`${b.id}:${b.hp>0?1:0}:${b.position.join(',')}`).join(';')+(state.terrainBake?`|bake${state.terrainBake.rev}`:'');}
export function foundationAt(state,x,z,radius=0,owner=null) {return (state.inventions?.structures||[]).find(b=>b.type==='foundation'&&b.hp>0&&(!owner||b.side===owner)&&Math.abs(x-b.position[0])+radius<=FOUNDATION_HALF&&Math.abs(z-b.position[2])+radius<=FOUNDATION_HALF);}
function foundationHeight(state,x,z,y) {
  // Blend independent of structure ordering. Odds weighting tends to the exact
  // anchored plane at each tile edge, even where neighbouring skirts overlap.
  let remaining=1,total=0,target=0;
  for(const b of state.inventions?.structures||[]) {
    if(b.type!=='foundation'||b.hp<=0)continue;
    const d=Math.max(Math.abs(x-b.position[0]),Math.abs(z-b.position[2]));
    if(d>=FOUNDATION_HALF+FOUNDATION_BLEND)continue;
    if(d<=FOUNDATION_HALF)return b.position[1];
    const w=1-smooth(clamp((d-FOUNDATION_HALF)/FOUNDATION_BLEND,0,1)),odds=w/Math.max(1e-12,1-w);
    remaining*=1-w;total+=odds;target+=b.position[1]*odds;
  }
  return total?y+(target/total-y)*(1-remaining):y;
}
export function rawTerrainHeight(state,x,z) {
  let earth=0,scar=0,wall=0,low=0,high=0;
  const world=state.world?worldFor(state):null;
  if(state.terrainBake&&(world?sampleWorldBake(state.terrainBake,x,z):sampleBake(state.terrainBake,x,z))){earth=BAKED[0];scar=BAKED[1];}
  for(const edit of state.edits||[]) {
    const dx=x-edit.x,dz=z-edit.z;
    // Most kernels do not cover this vertex. Reject before the costly hypot,
    // preserving original edit order, distance calculation and floating-point sum.
    if(Math.abs(dx)>=edit.radius||Math.abs(dz)>=edit.radius)continue;
    let h;
    if(edit.wall&&edit.kind==='sunder'){
      const [trench,bank]=chasmProfile(edit.wall,x,z);if(!trench&&!bank)continue;
      const k=terrainEditScale(edit,state.tick??Infinity,x,z);low=Math.min(low,trench*k);high=Math.max(high,bank*k);continue;
    }
    if(edit.wall){h=wallProfile(edit.wall,x,z,wallSpec(edit.kind));if(h<=0)continue;}
    else{const t=clamp(1-Math.hypot(dx,dz)/edit.radius,0,1);if(t<=0)continue;h=edit.height*smooth(t);}
    h*=terrainEditScale(edit,state.tick??Infinity,x,z);
    if(edit.kind==='axe_sunder')scar+=h;
    else if(edit.wall||edit.kind==='pick_wall')wall=Math.max(wall,h);
    else earth+=h;
  }
  // Mountains cannot be excavated into a route outside the playable bowl.
  // Permanent forge: its work apron never moves. Blend over three metres so
  // excavation outside remains continuous rather than making an invisible cliff.
  const forgeProtection=smooth(clamp((Math.hypot(x,z)-4)/3,0,1));
  // A generated world has no colosseum rim: earth can be shaped anywhere except the forge apron.
  const protection=world?forgeProtection:(1-smooth(clamp((Math.max(Math.abs(x),Math.abs(z))-46)/4,0,1)))*forgeProtection;
  return foundationHeight(state,x,z,(world?worldBaseHeight(world,x,z):rawBaseHeight(x,z))+clamp(clamp(earth,-6,6)+clamp(scar,-.65,.65)+wall+low+high,-6,6)*protection);
}
// Soil rendering is recessed beneath masonry; authoritative walking/support stay on y=top.
// Tile edges align to the .75m ground lattice, so interpolation cannot poke soil through tiles.
export const FOUNDATION_SOIL_RECESS=.16;
export function terrainRenderHeight(state,x,z,includeBridges=true) {
 return triangleHeight((a,b)=>terrainRenderVertex(state,a,b,includeBridges),x,z);
}
// Mesh rebuilds pass their cached physical vertex height to avoid resampling edits.
export function terrainRenderVertex(state,x,z,includeBridges=false,y=terrainHeight(state,x,z,includeBridges)) {
 let cover=0;
 for(const b of state.inventions?.structures||[])if(b.type==='foundation'&&b.hp>0){
  const d=Math.max(Math.abs(x-b.position[0]),Math.abs(z-b.position[2]));
  if(d<=FOUNDATION_HALF+.75&&y<=b.position[1]+.001)cover=Math.max(cover,1-smooth(clamp((d-FOUNDATION_HALF)/.75,0,1)));
 }
 return y-FOUNDATION_SOIL_RECESS*cover;
}
export function terrainHeight(state,x,z,includeBridges=true) {
  if(inUnderway(x,z))return underwayFloor(state,x,z); // the Underways: pocket dungeons far from the map (shared/underways/space.js)
  let y=triangleHeight((a,b)=>rawTerrainHeight(state,a,b),x,z);
  for(const b of includeBridges?(state.bridges||[]):[]) {
    const dx=x-b.x,dz=z-b.z,f=-Math.sin(b.yaw)*dx-Math.cos(b.yaw)*dz,s=Math.cos(b.yaw)*dx-Math.sin(b.yaw)*dz;
    if(Math.abs(f)<=2.5&&Math.abs(s)<=.8)y=Math.max(y,b.y);
  }
  return y;
}
/** Resolve one fixed-step move, sliding along contours but never climbing steep earth.
 * Looking ahead by a body radius avoids frame-sized steps bypassing a tall wall.
 * Airborne actors can clear low obstacles when their feet already exceed the rise. */
export function moveOnTerrain(state,position,dx,dz,radius=.28) {
  if(inUnderway(position[0],position[2])){const o=[...position];moveUnderway(state,position,dx,dz,radius);return Math.hypot(position[0]-o[0],position[2]-o[2]);}
  const origin=[...position],world=state.world?worldFor(state):null;
  for(const [axis,delta] of [[0,dx],[2,dz]]) {
    if(!delta)continue;
    const next=[...position];next[axis]+=delta;
    if(world){const b=walkArea(world,position[0],position[2]);next[0]=clamp(next[0],b.minX+radius,b.maxX-radius);next[2]=clamp(next[2],b.minZ+radius,b.maxZ-radius);}
    // The open meadow stops at ±50; a keep's carved bowl, pass and back town run on out toward the corners.
    else if(!walkable(next[0],next[2],radius)){if(Math.max(Math.abs(position[0]),Math.abs(position[2]))>50-radius)continue;next[axis]=clamp(next[axis],-50+radius,50-radius);} // out on keep ground: stop at its edge
    const ground=terrainHeight(state,position[0],position[2]),dest=terrainHeight(state,next[0],next[2]);
    const probe=[...next];probe[axis]+=Math.sign(delta)*radius;
    const ahead=terrainHeight(state,probe[0],probe[2]);
    const steep=ahead-ground>(Math.abs(delta)+radius)*TERRAIN_LIMITS.slope;
    if(!steep||ahead<=position[1]+.12)position[axis]=next[axis];
    else if(dest<ground)position[axis]=next[axis];
  }
  return Math.hypot(position[0]-origin[0],position[2]-origin[2]);
}
const walkable=(x,z,radius)=>inUnderway(x,z)||Math.max(Math.abs(x),Math.abs(z))<=50-radius||onKeepGround(x,z)&&Math.max(Math.abs(x),Math.abs(z))<=WORLD_EXTENT-radius;
// Generated worlds: walkers stay inside the overworld's walk square, or inside the dungeon cell they stand in.
function walkArea(world,x,z) {
  if(x<=world.bounds.maxX)return world.walkBounds;
  const own=modeTerrainAt(x,z);return own?.bounds?.(x,z)||world.walkBounds;
}
export function resolveTerrainBoundary(position,radius=.28,state=null) {
  if(inUnderway(position[0],position[2]))return position; // dungeon walls hold walkers there (shared/underways/space.js)
  const world=state?.world?worldFor(state):activeWorld();
  if(world){const b=walkArea(world,position[0],position[2]);position[0]=clamp(position[0],b.minX+radius,b.maxX-radius);position[2]=clamp(position[2],b.minZ+radius,b.maxZ-radius);return position;}
  if(walkable(position[0],position[2],radius))return position;
  position[0]=clamp(position[0],-50+radius,50-radius);
  position[2]=clamp(position[2],-50+radius,50-radius);
  return position;
}
/** Actors rise out of new earth immediately; lower ground retains gravity. */
export function settleTerrainContents(state) {
  for(const actor of [...state.players,...state.enemies])actor.position[1]=Math.max(actor.position[1],terrainHeight(state,actor.position[0],actor.position[2]));
  for(const q of state.pickups)q.y=terrainHeight(state,q.x,q.z,false);
}

// ---- Baked terrain: unlimited settled edits at a constant reading cost ----
// The live edit list keeps at most TERRAIN_BAKE.live entries for animation and presentation. When a new
// edit needs room, the oldest settled permanent edits are folded into a per-vertex grid (the ground mesh's
// own 161 x 161 lattice, so the surface is unchanged) and leave the list. The grid is stored as 16 x 16
// vertex tiles of little-endian Int16 millimetres in base64, one map per channel; empty tiles are omitted.
// Channels hold unclamped sums (bounded to +/-limitMm), so the usual clamps apply exactly as before.
export const TERRAIN_BAKE=Object.freeze({tile:16,tiles:11,live:48,bakeTo:32,limitMm:30000});
const SIDE=TERRAIN_GRID.segments+1,TILE=TERRAIN_BAKE.tile,TILE_CELLS=TILE*TILE,CHANNELS=['earth','scar'];
const BAKED=[0,0],tileCache=new Map(),gridCache=new WeakMap();
const TILE_KEY=/^(\d|10),(\d|10)$/;
function decodeTile(text) {
  let a=tileCache.get(text);if(a)return a;
  const bin=atob(text);a=new Int16Array(TILE_CELLS);
  for(let i=0;i<TILE_CELLS;i++)a[i]=(bin.charCodeAt(2*i)|bin.charCodeAt(2*i+1)<<8)<<16>>16;
  if(tileCache.size>=2048)tileCache.clear();tileCache.set(text,a);return a;
}
function encodeTile(a) {let bin='';for(let i=0;i<TILE_CELLS;i++){const v=a[i]&0xffff;bin+=String.fromCharCode(v&255,v>>8);}return btoa(bin);}
function bakedGrid(bake) {
  let g=gridCache.get(bake);if(g)return g;
  g={earth:new Int16Array(SIDE*SIDE),scar:new Int16Array(SIDE*SIDE)};
  for(const ch of CHANNELS)for(const [key,text] of Object.entries(bake[ch]||{})){
    const [ti,tj]=key.split(',').map(Number),a=decodeTile(text);
    for(let v=0;v<TILE;v++){const iz=tj*TILE+v;if(iz>=SIDE)break;for(let u=0;u<TILE;u++){const ix=ti*TILE+u;if(ix>=SIDE)break;g[ch][iz*SIDE+ix]=a[v*TILE+u];}}
  }
  gridCache.set(bake,g);return g;
}
// Writes metres into BAKED; vertices read directly, other points use the mesh's triangle split.
function sampleBake(bake,x,z) {
  const g=bakedGrid(bake),{half,step}=TERRAIN_GRID,fx=(x+half)/step,fz=(z+half)/step;
  if(!(fx>=0&&fz>=0&&fx<=SIDE-1&&fz<=SIDE-1))return false;
  const rx=Math.round(fx),rz=Math.round(fz);
  if(Math.abs(fx-rx)<1e-6&&Math.abs(fz-rz)<1e-6){const i=rz*SIDE+rx;BAKED[0]=g.earth[i]/1000;BAKED[1]=g.scar[i]/1000;return true;}
  const ix=Math.min(SIDE-2,Math.floor(fx)),iz=Math.min(SIDE-2,Math.floor(fz)),u=fx-ix,v=fz-iz,i=iz*SIDE+ix;
  for(let c=0;c<2;c++){const a=g[CHANNELS[c]];BAKED[c]=(u+v<=1?a[i]*(1-u-v)+a[i+1]*u+a[i+SIDE]*v:a[i+SIDE+1]*(u+v-1)+a[i+1]*(1-v)+a[i+SIDE]*(1-u))/1000;}
  return true;
}
// Generated worlds bake into the same 16 x 16 vertex tiles on an unbounded lattice anchored at the origin
// (tile keys may be negative), so settled earthworks persist anywhere in a world at a constant reading cost.
const WORLD_TILE_KEY=/^-?\d{1,4},-?\d{1,4}$/;
function sampleWorldBake(bake,x,z) {
  const step=TERRAIN_GRID.step,fx=x/step,fz=z/step,ix=Math.floor(fx),iz=Math.floor(fz),u=fx-ix,v=fz-iz;
  const at=(ch,i,k)=>{const t=bake[ch]?.[`${Math.floor(i/TILE)},${Math.floor(k/TILE)}`];if(!t)return 0;const a=decodeTile(t);return a[(k-Math.floor(k/TILE)*TILE)*TILE+(i-Math.floor(i/TILE)*TILE)];};
  let any=false;
  for(let c=0;c<2;c++){const ch=CHANNELS[c],a00=at(ch,ix,iz),a10=at(ch,ix+1,iz),a01=at(ch,ix,iz+1),a11=at(ch,ix+1,iz+1);
    if(a00||a10||a01||a11)any=true;BAKED[c]=(u+v<=1?a00*(1-u-v)+a10*u+a01*v:a11*(u+v-1)+a10*(1-v)+a01*(1-u))/1000;}
  return any;
}
function makeWorldTerrainRoom(state,chosen) {
  const old=state.terrainBake,step=TERRAIN_GRID.step,work={earth:new Map(),scar:new Map()},touched=new Set();
  const tileOf=(ch,key)=>{let a=work[ch].get(key);if(!a){const t=old?.[ch]?.[key];a=Float64Array.from(t?decodeTile(t):new Int16Array(TILE_CELLS),v=>v/1000);work[ch].set(key,a);}return a;};
  for(const e of chosen){
    const ch=e.kind==='axe_sunder'?'scar':'earth';
    for(let iz=Math.ceil((e.z-e.radius)/step);iz<=Math.floor((e.z+e.radius)/step);iz++)for(let ix=Math.ceil((e.x-e.radius)/step);ix<=Math.floor((e.x+e.radius)/step);ix++){
      const x=ix*step,z=iz*step,dx=x-e.x,dz=z-e.z;if(Math.abs(dx)>=e.radius||Math.abs(dz)>=e.radius)continue;
      const t=clamp(1-Math.hypot(dx,dz)/e.radius,0,1);if(t<=0)continue;
      const ti=Math.floor(ix/TILE),tj=Math.floor(iz/TILE),key=`${ti},${tj}`;touched.add(key);
      tileOf(ch,key)[(iz-tj*TILE)*TILE+(ix-ti*TILE)]+=e.height*smooth(t)*terrainEditScale(e,state.tick??Infinity,x,z);
    }
  }
  const next={rev:(old?.rev||0)+1,earth:{...(old?.earth||{})},scar:{...(old?.scar||{})}},lim=TERRAIN_BAKE.limitMm;
  for(const key of touched)for(const ch of CHANNELS){
    const a=work[ch].get(key)||tileOf(ch,key),tile=new Int16Array(TILE_CELLS);let any=false;
    for(let i=0;i<TILE_CELLS;i++){const mm=clamp(Math.round(a[i]*1000),-lim,lim);tile[i]=mm;if(mm)any=true;}
    if(any)next[ch][key]=encodeTile(tile);else delete next[ch][key];
  }
  const gone=new Set(chosen);state.edits=state.edits.filter(e=>!gone.has(e));state.terrainBake=next;
  return chosen.length;
}
export const terrainEditBakeable=(e,tick)=>e.kind!=='pick_wall'&&!e.wall&&(!e.rupture||tick>=e.rupture.startTick+e.rupture.durationTicks);
/** Pure: which edits makeTerrainRoom would fold so `needed` more fit under the live limit. */
export function planTerrainBake(edits=[],tick=0,needed=1) {
  if(edits.length+needed<=TERRAIN_BAKE.live)return [];
  let excess=edits.length+needed-TERRAIN_BAKE.bakeTo;const chosen=[];
  for(const e of edits){if(excess<=0)break;if(terrainEditBakeable(e,tick)){chosen.push(e);excess--;}}
  return chosen;
}
/** Authority: fold the oldest settled edits into the baked grid. Returns the number folded. */
export function makeTerrainRoom(state,needed=1) {
  const chosen=planTerrainBake(state.edits,state.tick??0,needed);if(!chosen.length)return 0;
  if(state.world)return makeWorldTerrainRoom(state,chosen);
  const old=state.terrainBake,g=old?bakedGrid(old):null,work={},touched=new Set(),{half,step}=TERRAIN_GRID;
  for(const ch of CHANNELS){work[ch]=new Float64Array(SIDE*SIDE);if(g)for(let i=0;i<SIDE*SIDE;i++)work[ch][i]=g[ch][i]/1000;}
  for(const e of chosen){
    const ch=e.kind==='axe_sunder'?'scar':'earth',a=work[ch];
    const x0=Math.max(0,Math.ceil((e.x-e.radius+half)/step)),x1=Math.min(SIDE-1,Math.floor((e.x+e.radius+half)/step));
    const z0=Math.max(0,Math.ceil((e.z-e.radius+half)/step)),z1=Math.min(SIDE-1,Math.floor((e.z+e.radius+half)/step));
    for(let iz=z0;iz<=z1;iz++)for(let ix=x0;ix<=x1;ix++){
      const x=ix*step-half,z=iz*step-half,dx=x-e.x,dz=z-e.z;
      if(Math.abs(dx)>=e.radius||Math.abs(dz)>=e.radius)continue;
      const t=clamp(1-Math.hypot(dx,dz)/e.radius,0,1);if(t<=0)continue;
      a[iz*SIDE+ix]+=e.height*smooth(t)*terrainEditScale(e,state.tick??Infinity,x,z);
      touched.add(`${Math.floor(ix/TILE)},${Math.floor(iz/TILE)}`);
    }
  }
  const next={rev:(old?.rev||0)+1,earth:{...(old?.earth||{})},scar:{...(old?.scar||{})}},lim=TERRAIN_BAKE.limitMm;
  for(const key of touched){
    const [ti,tj]=key.split(',').map(Number);
    for(const ch of CHANNELS){
      const tile=new Int16Array(TILE_CELLS);let any=false;
      for(let v=0;v<TILE;v++){const iz=tj*TILE+v;if(iz>=SIDE)break;for(let u=0;u<TILE;u++){const ix=ti*TILE+u;if(ix>=SIDE)break;const mm=clamp(Math.round(work[ch][iz*SIDE+ix]*1000),-lim,lim);tile[v*TILE+u]=mm;if(mm)any=true;}}
      if(any)next[ch][key]=encodeTile(tile);else delete next[ch][key];
    }
  }
  const gone=new Set(chosen);state.edits=state.edits.filter(e=>!gone.has(e));state.terrainBake=next;
  return chosen.length;
}
export function restoreTerrainBake(bake,world=false) {
  if(bake===undefined)return undefined;
  if(!bake||typeof bake!=='object'||Array.isArray(bake)||!Number.isSafeInteger(bake.rev)||bake.rev<1||Object.keys(bake).some(k=>!['rev',...CHANNELS].includes(k)))throw Error('Invalid baked terrain');
  const out={rev:bake.rev,earth:{},scar:{}};
  for(const ch of CHANNELS){
    const tiles=bake[ch]??{};if(!tiles||typeof tiles!=='object'||Array.isArray(tiles))throw Error('Invalid baked terrain');
    for(const [key,text] of Object.entries(tiles)){
      if(!(world?WORLD_TILE_KEY:TILE_KEY).test(key)||typeof text!=='string'||text.length!==Math.ceil(TILE_CELLS*2/3)*4||!/^[A-Za-z0-9+/]+=*$/.test(text))throw Error('Invalid baked tile');
      const a=decodeTile(text);if(a.some(v=>Math.abs(v)>TERRAIN_BAKE.limitMm))throw Error('Invalid baked tile');
      out[ch][key]=text;
    }
  }
  return out;
}
