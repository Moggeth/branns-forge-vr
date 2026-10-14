import layout from './starting-layout.json' with {type:'json'};
import {shiftPath, shiftSite, siteShift} from './map-layout.js';
// The map editor can shift a landmark (shared/map-layout.js): its footprints move with it and its path's far end follows.
export const STARTING_SITES=layout.sites.map(s=>shiftSite(s));
export const STARTING_PATHS=layout.paths.map(p=>({...p,points:shiftPath(p.points,siteShift(p.id.replace(/^to-/,'')))}));
const boxes=STARTING_SITES.flatMap(s=>s.footprints.map(b=>({...b,c:Math.cos(b.rotY),s:Math.sin(b.rotY)})));
export function resolveStartingWorld(position,height,radius=.28,bodyHeight=1.65){
 const nearby=boxes.filter(b=>Math.hypot(position[0]-b.x,position[2]-b.z)<Math.hypot(b.w,b.d)+radius+1&&position[1]<height(b.x,b.z)+b.h&&position[1]+bodyHeight>height(b.x,b.z)-.2);
 const local=(x,z,b)=>[(x-b.x)*b.c-(z-b.z)*b.s,(x-b.x)*b.s+(z-b.z)*b.c];
 const blocked=(x,z)=>nearby.some(b=>{const [u,v]=local(x,z,b);return Math.abs(u)<b.w/2+radius&&Math.abs(v)<b.d/2+radius;});
 if(!blocked(position[0],position[2]))return position;
 let best=Infinity,chosen=null;
 for(const b of nearby){const [u,v]=local(position[0],position[2],b),w=b.w/2+radius+.002,d=b.d/2+radius+.002;
  for(const [a,c]of [[-w,v],[w,v],[u,-d],[u,d],[-w,-d],[-w,d],[w,-d],[w,d]]){const x=b.x+a*b.c+c*b.s,z=b.z-a*b.s+c*b.c,dist=(x-position[0])**2+(z-position[2])**2;if(dist<best&&!blocked(x,z)){best=dist;chosen=[x,z];}}
 }
 if(chosen){position[0]=chosen[0];position[2]=chosen[1];}return position;
}
export function clearLandmarkTrees(trees){return trees.map(t=>{if(!STARTING_SITES.some(s=>Math.hypot(t.x-s.x,t.z-s.z)<s.radius+1))return t;
 const radius=Math.hypot(t.x,t.z);let angle=Math.atan2(t.z,t.x);for(let i=0;i<24;i++){angle+=.27;const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;if(!STARTING_SITES.some(s=>Math.hypot(x-s.x,z-s.z)<s.radius+1))return {...t,x:+x.toFixed(3),z:+z.toFixed(3)};}return t;});}
