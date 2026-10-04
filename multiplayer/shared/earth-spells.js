// God earth lines: Raise Wall and Sunder. One pure plan (shared by authority and the client preview) turns a drawn
// line into timed capsule segments; the authority stores them as terrain edits with a rupture front and a lifetime,
// so the ground rises or tears open at the speed the player sees, then shatters or closes after a minute.
import {terrainHeight,createSunderRupture,wallSpec,earthLineSegments,wallSegmentRadius} from './terrain.js';
import {DEPOSIT_CATALOG} from './material-catalog.js';
import {wallCasts,shatterWall} from './weapon-specials.js';

export const EARTH_LINES=Object.freeze(['wall','sunder']);
export const isEarthLine=spell=>EARTH_LINES.includes(spell);
const xz=p=>p.length===3?[p[0],p[2]]:[p[0],p[1]];

/** Pure plan of a Raise Wall or Sunder line. Heights (wall) or depths (chasm) ramp up from spec.endHeight at both ends
 * over spec.ramp metres, so each end is a walkable slope; short lines never reach full height. */
export function planEarthLine(kind,start,end) {
  const spec=wallSpec(kind),a=xz(start),b=xz(end),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1e-9,count=earthLineSegments(length);
  const top=kind==='sunder'?spec.depth:spec.peak,lift=d=>Math.min(top,spec.endHeight+(top-spec.endHeight)*Math.max(0,d)/spec.ramp);
  const h=d=>Math.min(lift(d),lift(length-d));
  const segments=Array.from({length:count},(_,i)=>{
    const d0=length*i/count,d1=length*(i+1)/count,p=d=>[a[0]+dx*d/length,a[1]+dz*d/length],sa=p(d0),sb=p(d1);
    return {a:sa,b:sb,h0:h(d0),h1:h(d1),x:(sa[0]+sb[0])/2,z:(sa[1]+sb[1])/2,radius:wallSegmentRadius(kind,(d1-d0)/2)};
  });
  return {kind,start:a,end:b,length,direction:[dx/length,dz/length],segments};
}
/** Edits a cast of this line adds (world-limit checks on both sides use it). */
export const earthLineEdits=(start,end)=>start&&end?earthLineSegments(Math.hypot(end[0]-start[0],end[2]-start[2])):earthLineSegments(6);

/** Authority: raise the wall / tear the chasm. Caller has validated mana, bloom and world limits. */
export function castEarthLine(state,p,kind,id,start,end,ctx,events) {
  const spec=wallSpec(kind),plan=planEarthLine(kind,start,end);
  // Each God keeps at most spec.standing of each line standing: the oldest shatters (or closes) to make room.
  const standing=[...wallCasts(state,p.id,kind).values()].filter(list=>list.some(e=>e.wall.expireTick>state.tick)).sort((x,y)=>x[0].rupture.startTick-y[0].rupture.startTick);
  for(const list of standing.slice(0,Math.max(0,standing.length-spec.standing+1)))shatterWall(state,list,ctx,events,'replaced');
  const rupture=createSunderRupture(id,plan.start,plan.end,state.tick,kind),expireTick=state.tick+spec.lifetimeTicks,sign=kind==='sunder'?-1:1;
  plan.segments.forEach((q,i)=>{
    const editId=`${id}_${i}`;
    state.edits.push({id:editId,kind,x:q.x,z:q.z,radius:q.radius,height:sign*Math.max(q.h0,q.h1),rupture:{...rupture,start:[...rupture.start],end:[...rupture.end]},
      wall:{a:q.a,b:q.b,h0:q.h0,h1:q.h1,expireTick,owner:p.id}});
    // Every rampart segment can be quarried; mining one out sinks just that segment, opening a breach. A world already
    // full of deposits still gets its wall (mana is the only gate), just without the extra quarry stone.
    if(kind==='wall'&&state.deposits.length+state.pendingStarfalls.length<80)state.deposits.push({id:ctx.nextId(state,'o'),x:q.x,z:q.z,kind:'stone',hits:0,maxHits:DEPOSIT_CATALOG.stone.maxHits,depleted:false,special:'wall',editId});
  });
  return {rupture,expireTick,plan,position:[(plan.start[0]+plan.end[0])/2,terrainHeight(state,(plan.start[0]+plan.end[0])/2,(plan.start[1]+plan.end[1])/2),(plan.start[1]+plan.end[1])/2]};
}
