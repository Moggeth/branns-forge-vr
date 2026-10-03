// One deterministic surface contract for authority, rendering and saved worlds.
export const TERRAIN_LIMITS = Object.freeze({bound:55, mountainStart:46, mountainCrest:55, deformation:6, axeScar:.65, slope:1.15, rim:50});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
export const SUNDER_SETTLE_DISTANCE=1.1;
export const sunderDurationTicks=length=>Math.max(36,Math.min(120,Math.ceil(length/12*60)+12));
const xz=p=>p.length===3?[p[0],p[2]]:[p[0],p[1]];
export function createSunderRupture(id,start,end,startTick) {
  const a=xz(start),b=xz(end),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  return {id,start:a,end:b,startTick,durationTicks:sunderDurationTicks(length)};
}
export function sunderFront(rupture,tick=Infinity) {
  const length=Math.hypot(rupture.end[0]-rupture.start[0],rupture.end[1]-rupture.start[1]);
  const progress=clamp((tick-rupture.startTick)/rupture.durationTicks,0,1);
  return {length,progress,distance:progress*(length+SUNDER_SETTLE_DISTANCE),fraction:clamp(progress*(length+SUNDER_SETTLE_DISTANCE)/Math.max(.001,length),0,1)};
}
export function terrainEditScale(edit,tick=Infinity,x=edit.x,z=edit.z) {
  const r=edit.rupture;if(!r||tick>=r.startTick+r.durationTicks)return 1;
  if(tick<=r.startTick)return 0;
  const front=sunderFront(r,tick),dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1];
  const along=clamp(((x-r.start[0])*dx+(z-r.start[1])*dz)/Math.max(.001,front.length),0,front.length);
  return smooth(clamp((front.distance-along)/SUNDER_SETTLE_DISTANCE,0,1));
}
export function hasActiveTerrain(edits,tick) {return edits.some(e=>e.rupture&&tick>=e.rupture.startTick&&tick<=e.rupture.startTick+e.rupture.durationTicks);}
const editStamp=e=>`${e.id}|${e.kind}|${e.x}|${e.z}|${e.radius}|${e.height}|${e.rupture?JSON.stringify(e.rupture):''}`;
// A timestamp changes only for a kernel intersecting the moving front; kernels
// ahead of it and permanently completed earth do not invalidate render work.
function animationStamp(e,tick) {
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
  const pair=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=55);
  if(edit.kind!=='sunder'||!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(r.id)||!pair(r.start)||!pair(r.end)||!Number.isSafeInteger(r.startTick)||r.startTick<0||r.startTick>tick)return false;
  const dx=r.end[0]-r.start[0],dz=r.end[1]-r.start[1],length=Math.hypot(dx,dz);
  if(length<.5||length>18.000001||r.durationTicks!==sunderDurationTicks(length))return false;
  const along=((edit.x-r.start[0])*dx+(edit.z-r.start[1])*dz)/(length*length),side=Math.abs((edit.x-r.start[0])*dz-(edit.z-r.start[1])*dx)/length;
  return along>=-1e-6&&along<=1+1e-6&&side<1e-5;
}
export function validateTerrainRuptures(edits,tick) {
  const casts=new Map();
  for(const e of edits){if(!validateTerrainRupture(e,tick))return false;if(e.rupture){const key=JSON.stringify(restoreRupture(e.rupture));if(casts.has(e.rupture.id)&&casts.get(e.rupture.id)!==key)return false;casts.set(e.rupture.id,key);}}
  return true;
}
const restoreRupture=r=>({id:r.id,start:[...r.start],end:[...r.end],startTick:r.startTick,durationTicks:r.durationTicks});
export function restoreTerrainEdit(e) {return {id:e.id,kind:e.kind,x:e.x,z:e.z,radius:e.radius,height:e.height,...(e.rupture?{rupture:restoreRupture(e.rupture)}:{})};}
export function mountainHeight(x,z) {
  const t=clamp((Math.max(Math.abs(x),Math.abs(z))-46)/9,0,1);
  return smooth(t)*(14+2*Math.sin(x*.31+z*.17)+Math.cos(z*.43-x*.11));
}
export const TERRAIN_GRID=Object.freeze({half:60,segments:160,step:.75});
const rawBaseHeight=(x,z)=>.45*Math.sin(x*.09)*Math.cos(z*.07)+mountainHeight(x,z);
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
export function rawTerrainHeight(state,x,z) {
  let earth=0,scar=0,wall=0;
  for(const edit of state.edits||[]) {
    const t=clamp(1-Math.hypot(x-edit.x,z-edit.z)/edit.radius,0,1);if(t<=0)continue;
    const h=edit.height*smooth(t)*terrainEditScale(edit,state.tick??Infinity,x,z);
    if(edit.kind==='axe_sunder')scar+=h;
    else if(edit.kind==='pick_wall')wall=Math.max(wall,h);
    else earth+=h;
  }
  // Mountains cannot be excavated into a route outside the playable bowl.
  // Permanent forge: its work apron never moves. Blend over three metres so
  // excavation outside remains continuous rather than making an invisible cliff.
  const forgeProtection=smooth(clamp((Math.hypot(x,z)-4)/3,0,1));
  const protection=(1-smooth(clamp((Math.max(Math.abs(x),Math.abs(z))-46)/4,0,1)))*forgeProtection;
  return rawBaseHeight(x,z)+clamp(clamp(earth,-6,6)+clamp(scar,-.65,.65)+wall,-6,6)*protection;
}
export function terrainHeight(state,x,z,includeBridges=true) {
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
  const origin=[...position];
  for(const [axis,delta] of [[0,dx],[2,dz]]) {
    if(!delta)continue;
    const next=[...position];next[axis]=clamp(next[axis]+delta,-50+radius,50-radius);
    const ground=terrainHeight(state,position[0],position[2]),dest=terrainHeight(state,next[0],next[2]);
    const probe=[...next];probe[axis]+=Math.sign(delta)*radius;
    const ahead=terrainHeight(state,probe[0],probe[2]);
    const steep=ahead-ground>(Math.abs(delta)+radius)*TERRAIN_LIMITS.slope;
    if(!steep||ahead<=position[1]+.12)position[axis]=next[axis];
    else if(dest<ground)position[axis]=next[axis];
  }
  return Math.hypot(position[0]-origin[0],position[2]-origin[2]);
}
export function resolveTerrainBoundary(position,radius=.28) {
  position[0]=clamp(position[0],-50+radius,50-radius);
  position[2]=clamp(position[2],-50+radius,50-radius);
  return position;
}
/** Actors rise out of new earth immediately; lower ground retains gravity. */
export function settleTerrainContents(state) {
  for(const actor of [...state.players,...state.enemies])actor.position[1]=Math.max(actor.position[1],terrainHeight(state,actor.position[0],actor.position[2]));
  for(const q of state.pickups)q.y=terrainHeight(state,q.x,q.z,false);
}
