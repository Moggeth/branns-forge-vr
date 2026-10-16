import {enemyHostileTo,damageBattleBase} from './battle-mode.js';
// Authored socket calibration: Timberline release eyes, metres, Y-up / -Z forward.
// Pure shared flight drives both renderer and 60 Hz authority.
import {timberlinePairState,TIMBERLINE_FLIGHT} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-flight.js';
import {sweepFilament} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-sim.js';
import {worldTrees} from './world-content.js';
import {worldColliders,insideVolume} from './colliders.js';
export const TIMBERLINE_RELEASE_TICKS=3;
// Manned shots carry an elevation (q.pitch, radians, positive = muzzle up). The rails pivot on the trunnion
// 0.25 m below q.origin; at zero pitch the release eyes sit 0.924945 m ahead and 0.122416 m above it.
const EYE_AHEAD=.924945,EYE_ABOVE=.122416,TRUNNION_BELOW=.25;
export function timberlineLaunch(q){
 const dx=q.target[0]-q.origin[0],dz=q.target[2]-q.origin[2],d=Math.hypot(dx,dz),fx=dx/d,fz=dz/d,p=q.pitch||0,cp=Math.cos(p),sp=Math.sin(p);
 const ahead=EYE_AHEAD*cp-EYE_ABOVE*sp,above=EYE_AHEAD*sp+EYE_ABOVE*cp;
 return {origin:[q.origin[0]+fx*ahead,q.origin[1]-TRUNNION_BELOW+above,q.origin[2]+fz*ahead],forward:[fx*cp,sp,fz*cp],right:[-fz,0,fx],up:[-fx*sp,cp,-fz*sp]};
}
// Long flight: the pair keeps its spread, yaw and tension, but drops under world gravity (not along the pitched rails).
export const TIMBERLINE_LONG=Object.freeze({maxTicks:720,reach:400,stuckCap:60,dragTicks:600,boltHalf:.56});
export function timberlineFlightAt(q,t){const launch=timberlineLaunch(q);return q.v===3?timberlinePairState(t,{...launch,up:[0,1,0]},TIMBERLINE_FLIGHT):timberlinePairState(t,launch,TIMBERLINE_FLIGHT);}
export function timberlineFlight(q,tick){return timberlineFlightAt(q,Math.max(0,(tick-q.launchTick-TIMBERLINE_RELEASE_TICKS)/60));}
// World velocity of the pair centre (m/s) t seconds after release.
export function timberlineVelocity(q,t){const f=timberlineLaunch(q).forward,v=TIMBERLINE_FLIGHT.speed;return [f[0]*v,f[1]*v-TIMBERLINE_FLIGHT.gravity*t,f[2]*v];}
// v2 shots ended at the aimed ground distance. v3 shots fly on under world gravity until something stops a bolt.
export function timberlineDuration(q){return q.v===3?TIMBERLINE_RELEASE_TICKS+TIMBERLINE_LONG.maxTicks:TIMBERLINE_RELEASE_TICKS+Math.ceil(Math.max(0,Math.hypot(q.target[0]-q.origin[0],q.target[2]-q.origin[2])-EYE_AHEAD)/(TIMBERLINE_FLIGHT.speed*Math.cos(q.pitch||0))*60);}
export function stepTimberline(s,q,c,events,structureDefs){
 const elapsed=s.tick-q.launchTick;if(elapsed<=TIMBERLINE_RELEASE_TICKS)return false;
 if(q.v===3)return stepLong(s,q,c,events,structureDefs);
 const a=timberlineFlight(q,s.tick-1),b=timberlineFlight(q,s.tick),hits=[];
 const test=(kind,obj,centre,radius,height)=>{if(q.hitIds.includes(obj.id))return;const h=sweepFilament(a.left,a.right,b.left,b.right,{centre,radius,height});if(h)hits.push({kind,obj,...h});};
 for(const x of s.inventions.structures)if(x.id!==q.structureId&&x.hp>0&&x.type!=='foundation'&&!(x.type==='palisade'&&x.open))test('block',x,x.position,structureDefs[x.type]?.radius||1.5,4);
 for(const d of s.deposits)if(!d.depleted)test('block',d,[d.x,c.terrainHeight(s,d.x,d.z,false),d.z],1.3,2.5);
 for(const t of worldTrees(s)){if(s.harvestedTrees.some(h=>h.id===t.id&&h.cuts>=3))continue;const dx=t.x-b.centre[0],dz=t.z-b.centre[2];if(dx*dx+dz*dz>5)continue;test('tree',t,[t.x,c.terrainHeight(s,t.x,t.z,false),t.z],.3,6);}
 for(const base of s.battle?.bases||[])if(base.hp>0)test('battle-base',base,base.position,1.5,3);
 for(const e of s.enemies)if(enemyHostileTo(e,q.side))test('enemy',e,e.position,e.kind==='golem'?1.1:.35,e.kind==='golem'?3.6:1.9);
 // Soil can intercept any point of the swept wire, not just its centre.
 for(let u=0;u<=1;u+=.25)for(let v=0;v<=1;v+=.5){const L=a.left.map((x,k)=>x+(b.left[k]-x)*u),R=a.right.map((x,k)=>x+(b.right[k]-x)*u),point=L.map((x,k)=>x+(R[k]-x)*v);if(c.terrainHeight(s,point[0],point[2],false)>=point[1]-.04){hits.push({kind:'ground',u,point,obj:{id:'ground'}});break;}}
 hits.sort((x,y)=>x.u-y.u);
 for(const h of hits){if(q.hitIds.includes(h.obj.id))continue;
  if(h.kind==='battle-base'){damageBattleBase(s,h.obj.id,110,q.side,events);events.push({kind:'timberline_stop',id:q.id,structureId:q.structureId,position:h.point,material:'stone'});return true;}
  if(h.kind==='block'||h.kind==='ground'){events.push({kind:'timberline_stop',id:q.id,structureId:q.structureId,position:h.point,material:'stone'});return true;}
  q.hitIds.push(h.obj.id);
  if(h.kind==='tree'){for(let cut=0;cut<3;cut++){const f=timberlineLaunch(q).forward,flatF=[f[0],0,f[2]].map(v=>v/Math.max(1e-6,Math.hypot(f[0],f[2]))),r=c.chopTree(s,h.obj,h.point,flatF,{terrainHeight:(x,z)=>c.terrainHeight(s,x,z,false)});events.push(...(r.events||[]).map(e=>({...e,by:q.owner})));}events.push({kind:'timberline_shear',id:q.id,structureId:q.structureId,position:h.point,material:'wood'});}
  else if(h.obj.kind==='golem')for(const part of ['leftArm','rightArm'])c.hitEnemyPart(s,h.obj,part,270,{ownerId:q.owner,side:q.side,tool:'axe'},c,events);
  else c.damageEnemy(s,h.obj,250,events,q.owner,q.side);
 }
 // The bolts burst apples they hit; the wire cuts every apple it passes in two (shared/fruit.js).
 if(c.fruitSlice)for(let u=0;u<=1;u+=1/3){const L=a.left.map((x,k)=>x+(b.left[k]-x)*u),R=a.right.map((x,k)=>x+(b.right[k]-x)*u);events.push(...c.fruitSlice(s,L,R,{by:q.owner,push:timberlineLaunch(q).forward,bolts:u?[]:[[a.left,b.left],[a.right,b.right]]}));}
 return s.tick>=q.impactTick;
}

// A bolt's swept path against an upright cylinder: the first sub-step inside it, or null.
function boltInCylinder(a,b,centre,radius,height,steps=6){for(let k=0;k<=steps;k++){const u=k/steps,p=a.map((x,j)=>x+(b[j]-x)*u);if(Math.hypot(p[0]-centre[0],p[2]-centre[2])<=radius&&p[1]>=centre[1]-.05&&p[1]<=centre[1]+height)return {u,point:p};}return null;}
function boltInGround(s,c,a,b,steps=6){for(let k=0;k<=steps;k++){const u=k/steps,p=a.map((x,j)=>x+(b[j]-x)*u);if(c.terrainHeight(s,p[0],p[2],false)>=p[1]-.02)return {u,point:p};}return null;}
const round=v=>Math.round(v*1e4)/1e4;
// The first sub-step of this tick at which a bolt or the wire is inside the volume: {u, point, part}.
const WIRE_POINTS=9,SWEEP_STEPS=8;
function sweptHit(a,b,v){for(let k=0;k<=SWEEP_STEPS;k++){const u=k/SWEEP_STEPS,L=a.left.map((x,j)=>x+(b.left[j]-x)*u),R=a.right.map((x,j)=>x+(b.right[j]-x)*u);
 if(insideVolume(v,L))return {u,point:L,part:'bolt_L'};if(insideVolume(v,R))return {u,point:R,part:'bolt_R'};
 for(let w=1;w<WIRE_POINTS;w++){const f=w/WIRE_POINTS,p=L.map((x,j)=>x+(R[j]-x)*f);if(insideVolume(v,p))return {u,point:p,part:'filament'};}}return null;}
// Long-range pair: trees and anything the wire kills are cut through without slowing; the first bolt that meets
// something it cannot cut (ground, stone, a structure, a body that survives) sticks there and its twin swings on the wire.
function stepLong(s,q,c,events,structureDefs){
 const t1=(s.tick-q.launchTick-TIMBERLINE_RELEASE_TICKS)/60,t0=Math.max(0,t1-1/60),a=timberlineFlightAt(q,t0),b=timberlineFlightAt(q,t1),hits=[];
 if(Math.abs(b.centre[0])>TIMBERLINE_LONG.reach||Math.abs(b.centre[2])>TIMBERLINE_LONG.reach||b.centre[1]<-60)return true;
 // The bolts burst apples they hit; the wire cuts every apple it passes in two (shared/fruit.js). Runs before the hits so a
 // pair that sticks this tick still cuts what it swept through.
 if(c.fruitSlice){const push=b.centre.map((x,k)=>x-a.centre[k]);for(let u=0;u<=1;u+=1/3){const L=a.left.map((x,k)=>x+(b.left[k]-x)*u),R=a.right.map((x,k)=>x+(b.right[k]-x)*u);events.push(...c.fruitSlice(s,L,R,{by:q.owner,push,bolts:u?[]:[[a.left,b.left],[a.right,b.right]]}));}}
 const near=(x,z,r)=>Math.hypot(x-b.centre[0],z-b.centre[2])<r+2+TIMBERLINE_FLIGHT.speed/60;
 // Use authored volumes, preserving Battle faction protection and objective hits.
 for(const v of worldColliders(s,{terrainHeight:c.terrainHeight,near,exclude:q.structureId})){
  if(v.kind==='enemy'&&!enemyHostileTo(v.obj,q.side))continue;
  if(v.kind!=='block'&&q.hitIds.includes(v.obj.id))continue;
  const h=sweptHit(a,b,v);if(h)hits.push({kind:v.kind,obj:v.obj,...h});}

 // A keep Timberline's pair (shared/home-ballista.js) also cuts rival Heroes in its path; the wire passes on through them.
 if(q.heroDamage&&c.damageHero)for(const p of s.players){if(p.role!=='hero'||!(p.hp>0)||(p.side||'party')===q.side||(p.protectedUntil??0)>s.tick||p.dragon||q.hitIds.includes(p.id))continue;
  const h=sweptHit(a,b,{shape:'frustum',at:p.position,base:.45,top:.45,height:1.85});if(h)hits.push({kind:'hero',obj:p,...h});}
 for(const tag of ['L','R']){const h=boltInGround(s,c,tag==='L'?a.left:a.right,tag==='L'?b.left:b.right);if(h)hits.push({kind:'ground',obj:{id:'ground'},u:h.u,point:h.point,part:tag==='L'?'bolt_L':'bolt_R'});}
 hits.sort((x,y)=>x.u-y.u||(x.part<y.part?-1:1));
 for(const h of hits){if(h.kind!=='ground'&&h.kind!=='block'&&q.hitIds.includes(h.obj.id))continue;
  if(h.kind==='battle-base'){damageBattleBase(s,h.obj.id,110,q.side,events);events.push({kind:'timberline_stop',id:q.id,structureId:q.structureId,position:h.point,material:'stone'});return true;}
  if(h.kind==='hero'){q.hitIds.push(h.obj.id);c.damageHero(s,h.obj,q.heroDamage,events,q.origin);continue;}
  if(h.kind==='tree'){q.hitIds.push(h.obj.id);const f=timberlineLaunch(q).forward,flatF=[f[0],0,f[2]].map(v=>v/Math.max(1e-6,Math.hypot(f[0],f[2])));for(let cut=0;cut<3;cut++){const r=c.chopTree(s,h.obj,h.point,flatF,{terrainHeight:(x,z)=>c.terrainHeight(s,x,z,false)});events.push(...(r.events||[]).map(e=>({...e,by:q.owner})));}events.push({kind:'timberline_shear',id:q.id,structureId:q.structureId,position:h.point,material:'wood'});continue;}
  if(h.kind==='enemy'){q.hitIds.push(h.obj.id);if(h.obj.kind==='golem')for(const part of ['leftArm','rightArm'])c.hitEnemyPart(s,h.obj,part,270,{ownerId:q.owner,side:q.side,tool:'axe'},c,events);else c.damageEnemy(s,h.obj,250,events,q.owner,q.side);
   if(!(h.obj.hp>0&&s.enemies.includes(h.obj)))continue;}
  stick(s,q,h,t0+(t1-t0)*h.u,events);return true;
 }
 return s.tick>=q.impactTick;
}
// Persistent record of a stopped pair. Presentation rebuilds both bolts from the shot frame, the flight time and the anchor.
function stick(s,q,h,t,events){
 const i=s.inventions,mode=h.part==='bolt_L'?'L':h.part==='bolt_R'?'R':'snag',f=timberlineFlightAt(q,t),at=mode==='L'?f.left:mode==='R'?f.right:h.point;
 const rec={id:q.id,side:q.side,origin:[...q.origin],target:[...q.target],launchTick:q.launchTick,t:round(t),mode,at:at.map(round),hostKind:h.kind==='enemy'?'enemy':h.kind==='block'&&!h.obj.permanent?'block':'ground',host:h.obj.id,tick:s.tick};
 if(q.pitch)rec.pitch=q.pitch;
 if(rec.hostKind==='enemy'){const e=h.obj,c=Math.cos(e.yaw||0),sn=Math.sin(e.yaw||0),dx=at[0]-e.position[0],dz=at[2]-e.position[2];rec.off=[round(dx*c-dz*sn),round(at[1]-e.position[1]),round(dx*sn+dz*c)];rec.yaw=round(e.yaw||0);e.slowUntil=Math.max(e.slowUntil||0,s.tick+2);}
 (i.stuck??=[]).push(rec);while(i.stuck.length>TIMBERLINE_LONG.stuckCap)i.stuck.shift();
 events.push({kind:'timberline_embed',id:q.id,structureId:q.structureId,position:[...rec.at],mode,host:rec.hostKind,material:h.obj.material||(rec.hostKind==='enemy'?'flesh':rec.hostKind==='block'?'stone':'earth')});
}
// Anchor of a stuck pair in world space: enemies carry theirs with them.
export function stuckAnchor(s,r){if(r.hostKind!=='enemy')return r.at;const e=s.enemies?.find(e=>e.id===r.host);if(!e)return r.at;const ox=r.off[0],oz=r.off[2],yc=Math.cos(e.yaw||0),ys=Math.sin(e.yaw||0);return [e.position[0]+ox*yc+oz*ys,e.position[1]+r.off[1],e.position[2]-ox*ys+oz*yc];}
// Stuck bolts leave with their host: a destroyed structure, a depleted seam, a dead body or a tether torn free.
export function stepStuck(s){const i=s.inventions;if(!i?.stuck?.length)return;
 i.stuck=i.stuck.filter(r=>{if(r.hostKind==='ground')return true;if(r.hostKind==='block'){const b=i.structures.find(b=>b.id===r.host);if(b)return b.hp>0;const d=s.deposits?.find(d=>d.id===r.host);return !!d&&!d.depleted;}
  const e=s.enemies.find(e=>e.id===r.host);if(!e||!(e.hp>0)||s.tick-r.tick>=TIMBERLINE_LONG.dragTicks)return false;e.slowUntil=Math.max(e.slowUntil||0,s.tick+2);return true;});}
