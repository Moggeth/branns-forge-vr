// One deterministic surface contract for authority, rendering and saved worlds.
export const TERRAIN_LIMITS = Object.freeze({bound:55, mountainStart:46, mountainCrest:55, deformation:6, axeScar:.65, slope:1.15, rim:50});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
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
    const t=clamp(1-Math.hypot(x-edit.x,z-edit.z)/edit.radius,0,1),h=edit.height*smooth(t);
    if(edit.kind==='axe_sunder')scar+=h;
    else if(edit.kind==='pick_wall')wall=Math.max(wall,h);
    else earth+=h;
  }
  // Mountains cannot be excavated into a route outside the playable bowl.
  const protection=1-smooth(clamp((Math.max(Math.abs(x),Math.abs(z))-46)/4,0,1));
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
