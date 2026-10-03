import {terrainHeight,settleTerrainContents} from './terrain.js';
export const SPECIAL_LIMITS=Object.freeze({cooldown:240,edits:64,deposits:80});
const fail=code=>({ok:false,code,events:[]});
/** Prepare the complete cast before allocating IDs, cooldown or damage. */
export function terrainSpecial(state,p,ctx,hitEnemyPart) {
  if(!['axe','pick'].includes(p.tool))return null;
  if(state.tick-(p.specialTick??-1000)<SPECIAL_LIMITS.cooldown)return fail('cooldown');
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
export function collapseMinedWall(state,ore) {
  if(ore.special!=='pick_wall')return;
  state.edits=state.edits.filter(e=>e.id!==ore.editId);
  settleTerrainContents(state);
}
