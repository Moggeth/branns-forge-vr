// Authored socket calibration: Timberline release eyes, metres, Y-up / -Z forward.
// Pure shared flight drives both renderer and 60 Hz authority.
import {timberlinePairState,TIMBERLINE_FLIGHT} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-flight.js';
import {sweepFilament} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-sim.js';
import {worldTrees} from './world-content.js';
export const TIMBERLINE_RELEASE_TICKS=3;
export function timberlineLaunch(q){
 const dx=q.target[0]-q.origin[0],dz=q.target[2]-q.origin[2],d=Math.hypot(dx,dz),forward=[dx/d,0,dz/d],right=[-forward[2],0,forward[0]];
 return {origin:[q.origin[0]+forward[0]*.924945,q.origin[1]-.127584,q.origin[2]+forward[2]*.924945],forward,right,up:[0,1,0]};
}
export function timberlineFlight(q,tick){return timberlinePairState(Math.max(0,(tick-q.launchTick-TIMBERLINE_RELEASE_TICKS)/60),timberlineLaunch(q),TIMBERLINE_FLIGHT);}
export function timberlineDuration(q){return TIMBERLINE_RELEASE_TICKS+Math.ceil(Math.max(0,Math.hypot(q.target[0]-q.origin[0],q.target[2]-q.origin[2])-.924945)/TIMBERLINE_FLIGHT.speed*60);}
export function stepTimberline(s,q,c,events,structureDefs){
 const elapsed=s.tick-q.launchTick;if(elapsed<=TIMBERLINE_RELEASE_TICKS)return false;
 const a=timberlineFlight(q,s.tick-1),b=timberlineFlight(q,s.tick),hits=[];
 const test=(kind,obj,centre,radius,height)=>{if(q.hitIds.includes(obj.id))return;const h=sweepFilament(a.left,a.right,b.left,b.right,{centre,radius,height});if(h)hits.push({kind,obj,...h});};
 for(const x of s.inventions.structures)if(x.id!==q.structureId&&x.hp>0&&x.type!=='foundation'&&!(x.type==='palisade'&&x.open))test('block',x,x.position,structureDefs[x.type]?.radius||1.5,4);
 for(const d of s.deposits)if(!d.depleted)test('block',d,[d.x,c.terrainHeight(s,d.x,d.z,false),d.z],1.3,2.5);
 for(const t of worldTrees(s)){if(s.harvestedTrees.some(h=>h.id===t.id&&h.cuts>=3))continue;const dx=t.x-b.centre[0],dz=t.z-b.centre[2];if(dx*dx+dz*dz>5)continue;test('tree',t,[t.x,c.terrainHeight(s,t.x,t.z,false),t.z],.3,6);}
 for(const e of s.enemies)test('enemy',e,e.position,e.kind==='golem'?1.1:.35,e.kind==='golem'?3.6:1.9);
 // Soil can intercept any point of the swept wire, not just its centre.
 for(let u=0;u<=1;u+=.25)for(let v=0;v<=1;v+=.5){const L=a.left.map((x,k)=>x+(b.left[k]-x)*u),R=a.right.map((x,k)=>x+(b.right[k]-x)*u),point=L.map((x,k)=>x+(R[k]-x)*v);if(c.terrainHeight(s,point[0],point[2],false)>=point[1]-.04){hits.push({kind:'ground',u,point,obj:{id:'ground'}});break;}}
 hits.sort((x,y)=>x.u-y.u);
 for(const h of hits){if(q.hitIds.includes(h.obj.id))continue;
  if(h.kind==='block'||h.kind==='ground'){events.push({kind:'timberline_stop',id:q.id,structureId:q.structureId,position:h.point,material:'stone'});return true;}
  q.hitIds.push(h.obj.id);
  if(h.kind==='tree'){for(let cut=0;cut<3;cut++){const r=c.chopTree(s,h.obj,h.point,timberlineLaunch(q).forward,{terrainHeight:(x,z)=>c.terrainHeight(s,x,z,false)});events.push(...(r.events||[]).map(e=>({...e,by:q.owner})));}events.push({kind:'timberline_shear',id:q.id,structureId:q.structureId,position:h.point,material:'wood'});}
  else if(h.obj.kind==='golem')for(const part of ['leftArm','rightArm'])c.hitEnemyPart(s,h.obj,part,270,{ownerId:q.owner,tool:'axe'},c,events);
  else c.damageEnemy(s,h.obj,250,events,q.owner);
 }
 return s.tick>=q.impactTick;
}
