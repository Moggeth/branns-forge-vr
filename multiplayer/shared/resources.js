// Shared collection and spending: authority validates role, range and benefit before consuming.
import {capsuleDistance, TREE_LIMITS} from './trees.js';
export const RESOURCE_RECIPES=Object.freeze({
 wood:{cost:3,hero:'Bandage · +35 health',god:'Mend Forge · +20 integrity'},
 stone:{cost:2,hero:'Reinforce Forge · +35 integrity',god:'Reinforce Forge · +35 integrity'},
 gems:{cost:1,hero:'Rekindle · +35 health, ready special and cool weapon',god:'Restore Mana · +40 mana'}
});
const fail=code=>({ok:false,code,events:[]});
const ok=events=>({ok:true,events});
export function useResource(state,p,m){
 if(typeof m.kind!=='string'||!Object.hasOwn(RESOURCE_RECIPES,m.kind))return fail('invalid_resource');
 const recipe=RESOURCE_RECIPES[m.kind];
 if(p.resources[m.kind]<recipe.cost)return fail('insufficient_resources');
 const forge=m.kind==='stone'||m.kind==='wood'&&p.role==='god';
 if(forge){
  if(p.role==='hero'&&Math.hypot(p.position[0],p.position[2])>5)return fail('too_far');
  if(state.shrine.hp>=state.shrine.maxHp)return fail('not_needed');
  state.shrine.hp=Math.min(state.shrine.maxHp,state.shrine.hp+(m.kind==='wood'?20:35));
  state.shrine.disabledUntil=0;
 }else if(m.kind==='wood'){
  if(p.hp>=100)return fail('not_needed');p.hp=Math.min(100,p.hp+35);
 }else if(p.role==='god'){
  if(p.mana>=100)return fail('not_needed');p.mana=Math.min(100,p.mana+40);
 }else{
  const cooldown=p.tool==='wyrmspout'?120:['axe','hammer','pick'].includes(p.tool)?240:0;
  const specialCooling=cooldown>0&&state.tick-(p.specialTick??-1000)<cooldown;
  if(p.hp>=100&&!specialCooling&&!(p.heat>0)&&!(p.overheatUntil>state.tick))return fail('not_needed');
  p.hp=Math.min(100,p.hp+35);p.specialTick=-1000;p.heat=0;p.overheatUntil=0;
 }
 p.resources[m.kind]-=recipe.cost;
 return ok([{kind:'resource_use',id:p.id,resource:m.kind,amount:recipe.cost,position:forge?[...state.shrine.position]:[...p.position]}]);
}
export function collectTarget(state,p,m,ctx){
 if(p.role!=='hero')return fail('role_required');
 if(typeof m.targetId!=='string')return fail('invalid_target');
 const q=state.pickups.find(q=>q.id===m.targetId);
 if(q){
  if(Math.hypot(p.position[0]-q.x,p.position[2]-q.z,p.position[1]-q.y)>2.5)return fail('out_of_reach');
  if(q.kind==='apple'&&p.hp>=100)return fail('not_needed');
  if(q.kind!=='apple'&&p.resources[q.kind]+q.amount>999)return fail('inventory_full');
  state.pickups.splice(state.pickups.indexOf(q),1);
  if(q.kind==='apple')p.hp=Math.min(100,p.hp+35);else p.resources[q.kind]+=q.amount;
  return ok([{kind:'pickup',id:q.id,position:[q.x,q.y,q.z],material:q.kind}]);
 }
 const log=state.looseLogs.find(l=>l.id===m.targetId);
 if(log){
  if(log.heldBy&&log.heldBy!==p.id)return fail('out_of_reach');
  if(capsuleDistance(log,p.position.map((n,i)=>n+(i===1?1.1:0)))>TREE_LIMITS.reach)return fail('out_of_reach');
  if(p.resources.wood>=999)return fail('inventory_full');
  p.resources.wood++;state.looseLogs.splice(state.looseLogs.indexOf(log),1);
  return ok([{kind:'pickup',id:log.id,position:[...log.position],material:'wood'}]);
 }
 if(state.detachedParts.some(d=>d.id===m.targetId)){
  if(state.looseLogs.some(l=>l.heldBy===p.id))return fail('hands_full');
  return ctx.combatAction(state,p,{action:'grab',id:m.targetId},ctx.combatContext);
 }
 return fail('invalid_target'); // Ore, trees and live enemies always require a tool/attack.
}
/** Exactly one of four hash buckets; stable across replay, save and host migration. */
export function meteorAwakens(seed,id){
 let h=2166136261;for(const c of `${seed}:starfall:${id}`)h=Math.imul(h^c.charCodeAt(0),16777619);
 h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;
 return (h&3)===0;
}
export function queueMeteorReward(state,enemy,ctx,events){
 // Six gems = three times the normal two-gem meteor. Persist overflow rather than lose a rare reward.
 const reward={id:ctx.nextId(state,'p'),x:enemy.position[0],z:enemy.position[2],amount:6};
 (state.meteorRewards??=[]).push(reward);flushMeteorRewards(state,ctx.terrainHeight);
 events.push({kind:'meteor_reward',id:enemy.id,amount:6,resource:'gems',position:[...enemy.position]});
}
export function flushMeteorRewards(state,height){
 while(state.meteorRewards?.length&&state.pickups.length<256){
  const r=state.meteorRewards.shift();state.pickups.push({...r,kind:'gems',y:height(state,r.x,r.z)});
 }
}
