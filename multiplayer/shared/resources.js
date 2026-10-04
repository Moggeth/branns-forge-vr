import {snackAction,isFruitDrop} from './fruit.js';
import {isTestingGift,giftContents} from './testing-supplies.js';
import {BLOOM,addBloom} from './bloom.js';
import {MATERIAL_KEYS,emptyMaterials,restoreMaterials,DEPOSIT_CATALOG,materialLabel} from './material-catalog.js';
import {isVein} from './ore-veins.js';
// Shared collection and spending: authority validates role, range and benefit before consuming.
import {collectLog,chopTree} from './trees.js';
import {worldTrees} from './world-content.js';
import {contributeSettlement} from './adventure.js';
import {collectibleCandidate} from './collection-target.js';
import {specialCooldown} from './special-cooldowns.js';
export {nearestCollectible} from './collection-target.js';
export const RESOURCE_RECIPES=Object.freeze({
 wood:{cost:3,hero:'Bandage Â· +35 health',god:'Mend Forge Â· +20 integrity'},
 stone:{cost:2,hero:'Reinforce Forge Â· +35 integrity',god:'Reinforce Forge Â· +35 integrity'},
 gems:{cost:1,hero:'Rekindle Â· +35 health, ready special and cool weapon',god:'Restore Mana Â· +40 mana'}
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
  const cooldown=specialCooldown(p.tool);
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
  if(q.side&&q.side!==(p.side||'party'))return fail('not_your_resources');
  if(!collectibleCandidate(state,p,q.id,{height:ctx.terrainHeight?(x,z)=>ctx.terrainHeight(state,x,z,false):undefined}))return fail('out_of_reach');
  if(isTestingGift(q)){
   const bundle=giftContents(state);
   if(bundle.some(item=>(p.resources[item.kind]||0)+item.amount>999))return fail('inventory_full');
   for(const item of bundle){p.resources[item.kind]=(p.resources[item.kind]||0)+item.amount;state.pickups.splice(state.pickups.indexOf(item),1);}
   (p.stats??={kills:0,deaths:0,harvested:0,contribution:0}).harvested=Math.min(1e9,(p.stats.harvested||0)+bundle.reduce((n,item)=>n+item.amount,0));
   return ok(bundle.map(item=>({kind:'pickup',id:item.id,position:[item.x,item.y,item.z],material:item.kind})));
  }
  if(q.kind==='apple'&&p.hp>=100)return fail('not_needed');
  if(q.kind!=='apple'&&p.resources[q.kind]+q.amount>999)return fail('inventory_full');
  state.pickups.splice(state.pickups.indexOf(q),1);
  if(q.kind==='apple')p.hp=Math.min(100,p.hp+35);else {p.resources[q.kind]+=q.amount;(p.stats??={kills:0,deaths:0,harvested:0,contribution:0}).harvested=Math.min(1e9,(p.stats.harvested||0)+q.amount);}
  const events=[{kind:'pickup',id:q.id,position:[q.x,q.y,q.z],material:q.kind}];
  if(q.kind==='apple')addBloom(state,BLOOM.apple,events,[q.x,q.y,q.z]); // Fruit eaten spreads the seed.
  return ok(events);
 }
 const log=state.looseLogs.find(l=>l.id===m.targetId);
 if(log){
  if(!collectibleCandidate(state,p,log.id,{height:ctx.terrainHeight?(x,z)=>ctx.terrainHeight(state,x,z,false):undefined}))return fail('out_of_reach');
  return collectLog(state,p,log);
 }
 if(isFruitDrop(state,m.targetId))return snackAction(state,p,{op:'take',id:m.targetId}); // take it, or bite the one in hand
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
 while(state.meteorRewards?.length&&state.pickups.length<255){
  const r=state.meteorRewards.shift();state.pickups.push({...r,id:r.id+'_star',kind:'starOre',y:height(state,r.x,r.z)});state.pickups.push({...r,kind:'gems',y:height(state,r.x,r.z)});
 }
}

// Depleted ore has already paid its one mining reward. Removing an unreferenced
// tombstone frees a slot without changing terrain, pickups, inventory or IDs.
// Spent mountain-foot veins hold their slot's respawn timer until ore-veins.js raises the replacement.
export function retainedDepositPredicate(state){
 const referenced=new Set([
  ...(state.embeds||[]).map(e=>e.targetId),...(state.fireSurfaces||[]).map(e=>e.targetId),
  ...(state.settlement?.workers||[]).map(w=>w.targetId),...(state.pendingStarfalls||[]).map(p=>p.id)
 ]);
 const activeQuest=['camp','star','rekindle'].includes(state.adventure?.stage)?`xv${state.adventure.run}`:null;
 const liveEdits=new Set((state.edits||[]).map(e=>e.id));
 return d=>!d.depleted||isVein(d)||referenced.has(d.id)||(activeQuest&&d.id.startsWith(activeQuest))||(d.editId&&liveEdits.has(d.editId));
}
// Preview the exact post-reclamation budget without changing world state. Pending
// meteors reserve their eventual deposit slots, just as the authority does.
export function depositCapacityUsed(state){
 const retained=retainedDepositPredicate(state);
 return (state.deposits||[]).reduce((used,d)=>used+(retained(d)?1:0),0)+(state.pendingStarfalls?.length||0);
}
export function reclaimDepletedDeposits(state){
 const before=state.deposits.length;
 state.deposits=state.deposits.filter(retainedDepositPredicate(state));
 return before-state.deposits.length;
}

// The settlement uses the existing finite world resources and combat actors.
// Four workers and six raiders maximum; idle worlds do no settlement work.
export const SETTLEMENT_RULES=Object.freeze({workers:4,workerMana:25,speed:2.8,workTicks:60,range:9,cap:999,raidTicks:7200});
const PACK=MATERIAL_KEYS,HOME=[0,6.5];
const flat=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const bounded=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
export function createSettlement(){return {v:1,stock:emptyMaterials(),workers:[],level:0,defenses:0,completed:0,encounter:null,lastResult:'',cooldownUntil:0,delivered:0};}
const upgradeCost=s=>({wood:6*(s.level+1),stone:4*(s.level+1),gems:s.level});
const defenseCost=s=>({wood:4+2*s.defenses,stone:3+2*s.defenses,gems:0});
const canPay=(s,cost)=>Object.entries(cost).every(([k,n])=>s.stock[k]>=n);
const pay=(s,cost)=>{for(const [k,n] of Object.entries(cost))s.stock[k]-=n;};
const managed=p=>p.role==='god'||Math.hypot(p.position[0],p.position[2])<=SETTLEMENT_RULES.range;
export function settlementAction(state,p,m,ctx){
 const s=state.settlement;
 if(!managed(p))return fail('too_far');
 const events=[];
 if(m.action==='forgeSummon'){
  if(s.workers.length>=SETTLEMENT_RULES.workers)return fail('worker_limit');
  if(p.mana<SETTLEMENT_RULES.workerMana)return fail('insufficient_mana');
  p.mana-=SETTLEMENT_RULES.workerMana;const id=ctx.nextId(state,'worker');
  const x=(s.workers.length-1.5)*.65,z=HOME[1];
  s.workers.push({id,position:[x,ctx.terrainHeight(state,x,z),z],yaw:0,job:s.workers.length%2?'stone':'wood',phase:'seeking',cargo:0,targetId:'',workTicks:0,stuckTicks:0,bestDistance:160,avoidId:'',avoidUntil:0});
  events.push({kind:'worker_summon',id,position:[x,ctx.terrainHeight(state,x,z),z],by:p.id});
 }else if(m.action==='forgeAssign'){
  const w=s.workers.find(w=>w.id===m.workerId);
  if(!w||!PACK.includes(m.kind))return fail('invalid_worker');
  if(w.cargo)return fail('worker_carrying');
  w.job=m.kind;w.phase='seeking';w.targetId='';w.workTicks=0;w.avoidId='';w.avoidUntil=0;w.stuckTicks=0;w.bestDistance=160;
 }else if(m.action==='forgeUpgrade'||m.action==='forgeDefend'){
  const upgrading=m.action==='forgeUpgrade';
  if((upgrading?s.level:s.defenses)>=3)return fail('fully_built');
  const cost=upgrading?upgradeCost(s):defenseCost(s);if(!canPay(s,cost))return fail('insufficient_resources');
  pay(s,cost);if(upgrading)s.level++;else s.defenses++;
  state.shrine.hp=Math.min(100,state.shrine.hp+25);state.shrine.disabledUntil=0;
  events.push({kind:'forge_build',upgrade:upgrading?'forge':'ward',level:upgrading?s.level:s.defenses,position:[...state.shrine.position]});
 }else if(m.action==='forgeRepair'){
  if(state.shrine.hp>=100)return fail('not_needed');
  if(s.stock.wood<3)return fail('insufficient_resources');
  s.stock.wood-=3;state.shrine.hp=Math.min(100,state.shrine.hp+35);state.shrine.disabledUntil=0;
  events.push({kind:'forge_repair',amount:35,position:[...state.shrine.position]});
 }else if(m.action==='forgeSupply'){
  if(!PACK.includes(m.kind)||!integer(m.amount,1,99))return fail('invalid_resource');
  const amount=Math.min(m.amount,p.resources[m.kind],999-s.stock[m.kind]);if(!amount)return fail('insufficient_resources');
  p.resources[m.kind]-=amount;s.stock[m.kind]+=amount;
  events.push({kind:'worker_delivery',id:p.id,resource:m.kind,amount,position:[0,state.shrine.position[1],HOME[1]]});
 }else if(m.action==='forgeContribute')return contributeSettlement(state.adventure,s.stock);
 else if(m.action==='forgeEncounter'){
  if(s.encounter)return fail('encounter_active');
  if(state.tick<s.cooldownUntil)return fail('cooldown');
  if(state.shrine.hp<=0)return fail('shrine_disabled');
  const count=Math.min(6,2+s.completed);if(state.enemies.length+count>64)return fail('world_limit');
  const foes=[];
  for(let i=0;i<count;i++){
   const a=(s.completed%4)*Math.PI/2+(i-(count-1)/2)*.16,x=Math.sin(a)*18,z=Math.cos(a)*18,id=ctx.nextId(state,'raid');
   state.enemies.push({...ctx.createEnemy(id,[x,ctx.terrainHeight(state,x,z),z],'skeleton'),emergeTick:state.tick});foes.push(id);
  }
  s.encounter={wave:s.completed+1,elapsed:0,foes,killed:0};s.lastResult='';
  events.push({kind:'forge_encounter',wave:s.encounter.wave,position:[...state.shrine.position]});
 }else return fail('invalid_action');
 return ok(events);
}

function targetFor(state,w,trees){
 const found=[];
 for(const q of state.pickups)if(!isTestingGift(q)&&q.kind===w.job&&(!q.side||q.side==='party'))found.push({id:q.id,position:[q.x,q.y,q.z],type:'pickup',item:q});
 if(w.job==='wood'){
  for(const l of state.looseLogs)if(!l.heldBy)found.push({id:l.id,position:l.position,type:'log',item:l});
  // Prefer wood already felled. A worker never chops a second tree while reachable logs exist.
  if(!found.length)for(const t of trees){const cut=state.harvestedTrees.find(c=>c.id===t.id);if(!cut||cut.cuts<3)found.push({id:t.id,position:[t.x,0,t.z],type:'tree',item:t});}
 }else for(const d of state.deposits)if(!d.depleted&&(DEPOSIT_CATALOG[d.kind]?.resource===w.job||(w.job==='gems'&&d.kind==='meteor')))found.push({id:d.id,position:[d.x,0,d.z],type:'ore',item:d});
 const eligible=found.filter(t=>t.id!==w.avoidId||state.tick>=w.avoidUntil);
 return eligible.find(t=>t.id===w.targetId)||eligible.sort((a,b)=>flat(w.position,a.position)-flat(w.position,b.position)||a.id.localeCompare(b.id))[0]||null;
}
function walk(w,target,ctx){
 const dx=target[0]-w.position[0],dz=target[2]-w.position[2],d=Math.hypot(dx,dz);if(d<.05)return;
 // Same bounded fan as enemy steering: terrain/walls/trunks remain solid.
 let chosen=null,best=-Infinity;
 for(const angle of [0,.65,-.65,1.25,-1.25,1.8,-1.8]){
  const c=Math.cos(angle),s=Math.sin(angle),x=(dx*c-dz*s)/d,z=(dx*s+dz*c)/d;
  const probe=[w.position[0]+x*.55,w.position[1],w.position[2]+z*.55],before=[...probe];ctx.resolve(probe,.24,1.65);
  if(flat(probe,before)>.035||Math.abs(ctx.ground(probe[0],probe[2])-w.position[1])>.8)continue;
  const score=x*dx/d+z*dz/d;if(score>best){best=score;chosen=[x,z];}
 }
 if(chosen){w.position[0]+=chosen[0]*SETTLEMENT_RULES.speed/60;w.position[2]+=chosen[1]*SETTLEMENT_RULES.speed/60;ctx.resolve(w.position,.24,1.65);w.position[1]=ctx.ground(w.position[0],w.position[2]);w.yaw=Math.atan2(-chosen[0],-chosen[1]);}
}
function workerReach(w,target,ctx){
 const d=flat(w.position,target.position),end=target.type==='log'||target.type==='pickup'?target.position[1]+.2:ctx.ground(target.position[0],target.position[2])+.8;
 for(let at=.25;at<d-.65;at+=.2){const t=at/Math.max(d,.001),p=[w.position[0]+(target.position[0]-w.position[0])*t,w.position[1]+1+(end-w.position[1]-1)*t,w.position[2]+(target.position[2]-w.position[2])*t],before=[...p];ctx.resolve(p,.02,.05);if(flat(p,before)>.03||ctx.ground(p[0],p[2])>p[1])return false;}
 return true;
}
export function stepSettlement(state,ctx,events,recent=[]){
 const s=state.settlement;if(!state.players.length)return;
 const trees=s.workers.some(w=>w.job==='wood'&&!w.cargo)?worldTrees(state):[];
 for(const w of s.workers){
  if(state.enemies.some(e=>e.kind!=='stumpling'&&flat(e.position,w.position)<3)){w.phase='sheltering';walk(w,[0,ctx.ground(0,HOME[1]),HOME[1]],ctx);continue;}
  if(w.cargo){
   w.phase='returning';const home=[HOME[0],ctx.ground(...HOME),HOME[1]];
   if(flat(w.position,home)>.8){walk(w,home,ctx);continue;}
   const amount=Math.min(w.cargo,999-s.stock[w.job]);if(!amount){w.phase='store_full';continue;}
   s.stock[w.job]+=amount;s.delivered=Math.min(1e9,s.delivered+amount);w.cargo-=amount;
   events.push({kind:'worker_delivery',id:w.id,resource:w.job,amount,position:[...w.position]});w.phase='seeking';continue;
  }
  const target=targetFor(state,w,trees);
  if(!target){w.phase='no_resource';w.targetId='';w.workTicks=0;continue;}
  if(w.targetId!==target.id){w.targetId=target.id;w.workTicks=0;w.stuckTicks=0;w.bestDistance=160;}
  const distance=flat(w.position,target.position);
  if(distance<w.bestDistance-.12){w.bestDistance=distance;w.stuckTicks=0;}
  else if(w.phase!=='working'&&++w.stuckTicks>120){w.avoidId=target.id;w.avoidUntil=state.tick+1200;w.targetId='';w.stuckTicks=0;w.phase='seeking';continue;}
  if(flat(w.position,target.position)>1.8){w.phase='travelling';walk(w,target.position,ctx);continue;}
  if(Math.abs(w.position[1]-(target.type==='log'||target.type==='pickup'?target.position[1]:ctx.ground(target.position[0],target.position[2])))>2){w.phase='blocked';continue;}
  if(!workerReach(w,target,ctx)){w.phase='blocked';w.workTicks=0;walk(w,target.position,ctx);continue;}
  w.phase='working';if(++w.workTicks<SETTLEMENT_RULES.workTicks)continue;w.workTicks=0;
  const item=target.item,at=[target.position[0],ctx.ground(target.position[0],target.position[2]),target.position[2]];
  if(target.type==='pickup'){w.cargo=Math.min(2,item.amount);item.amount-=w.cargo;if(!item.amount){state.pickups.splice(state.pickups.indexOf(item),1);events.push({kind:'pickup',id:item.id,position:at,material:w.job});}}
  else if(target.type==='log'){w.cargo=1;state.looseLogs.splice(state.looseLogs.indexOf(item),1);events.push({kind:'pickup',id:item.id,position:at,material:'wood'});}
  else if(target.type==='ore'){
   item.hits++;events.push({kind:'stone_hit',id:item.id,by:w.id,position:at,normal:[0,1,0],material:'stone'});
   if(item.hits>=item.maxHits){item.depleted=true;ctx.collapseMinedWall?.(state,item);w.cargo=2;events.push({kind:'ore_break',id:item.id,position:at,material:w.job});}
  }else {
   const floor=ctx.terrainHeight(state,item.x,item.z,false),cut=state.harvestedTrees.find(c=>c.id===item.id),height=cut?.cutHeight??floor+1;
   const dx=w.position[0]-item.x,dz=w.position[2]-item.z,d=Math.max(.001,Math.hypot(dx,dz));
   const result=chopTree(state,item,[item.x+dx/d*.25,height,item.z+dz/d*.25],[dx/d,0,dz/d],{terrainHeight:(x,z)=>ctx.terrainHeight(state,x,z,false)});
   events.push(...(result.events||[]).map(e=>({...e,by:w.id})));
  }
 }
 const raid=s.encounter;if(!raid)return;raid.elapsed++;
 const dead=new Set(recent.concat(events).filter(e=>e.kind==='death').map(e=>e.id));
 raid.foes=raid.foes.filter(id=>{if(!dead.has(id))return true;raid.killed++;return false;});
 // Remote Gods have no body for ordinary enemy AI to chase. Their raiders
 // advance toward the forge; Heroes retain the existing committed melee AI.
 const raiders=state.enemies.filter(e=>raid.foes.includes(e.id));
 if(!state.players.some(p=>p.role==='hero'))for(const e of raiders){
  if(state.tick-(e.emergeTick??-1000)<90)continue;
  if(flat(e.position,[0,0,0])>6){const proxy={position:e.position,yaw:e.yaw};walk(proxy,[0,ctx.ground(0,0),0],{...ctx});e.yaw=proxy.yaw;}
 }
 if(state.tick%60===0){
  const attackers=raiders.filter(e=>Math.hypot(e.position[0],e.position[2])<=7);
  // Central forge is permanent; new invention structures take siege damage instead.
  if(s.defenses){const target=raiders.filter(e=>Math.hypot(e.position[0],e.position[2])<16).sort((a,b)=>Math.hypot(a.position[0],a.position[2])-Math.hypot(b.position[0],b.position[2]))[0];if(target){ctx.damageEnemy(state,target,8*s.defenses+2*s.level,events);events.push({kind:'forge_ward',id:target.id,position:[...target.position],origin:[...state.shrine.position]});}}
 }
 // Ward deaths occurred after the first bookkeeping pass.
 for(const e of events)if(e.kind==='death'&&raid.foes.includes(e.id)){raid.foes.splice(raid.foes.indexOf(e.id),1);raid.killed++;}
 const lost=state.shrine.hp<=0||raid.elapsed>=SETTLEMENT_RULES.raidTicks;
 if(lost||!raid.foes.length){
  s.lastResult=lost?'defeat':'victory';s.cooldownUntil=state.tick+180;
  if(!lost){const reward={wood:4+Math.min(4,s.completed),stone:3+Math.min(3,s.completed),gems:1};for(const k of PACK)s.stock[k]=Math.min(999,s.stock[k]+reward[k]);s.completed=Math.min(999,s.completed+1);events.push({kind:'forge_reward',...reward,position:[...state.shrine.position]});}
  else state.enemies=state.enemies.filter(e=>!raid.foes.includes(e.id));
  s.encounter=null;events.push({kind:'forge_result',result:s.lastResult,position:[...state.shrine.position]});
 }
}

// Record command-time deaths before a checkpoint can be taken. Awards still
// happen once in stepSettlement; a save between the last blow and that step is safe.
export function recordSettlementDeaths(state,events){
 const raid=state.settlement?.encounter;if(!raid)return;
 for(const e of events||[])if(e.kind==='death'&&raid.foes.includes(e.id)){raid.foes.splice(raid.foes.indexOf(e.id),1);raid.killed++;}
}

export function settlementView(world,playerId){
 const s=world.settlement||createSettlement(),p=world.players?.find(p=>p.id===playerId),near=!!p&&managed(p),ready=near&&(world.shrine?.hp??100)>0;
 const item=(action,label,enabled,reason,cost={})=>({action,label,enabled:!!enabled,reason:enabled?'':!near?'Return to the forge':reason,cost});
 const actions=[item('forgeSummon','Summon worker',near&&s.workers.length<4&&p.mana>=25,s.workers.length>=4?'Four workers maximum':'25 mana',{mana:25}),
  item('forgeUpgrade',`Improve forge ${s.level}/3`,ready&&s.level<3&&canPay(s,upgradeCost(s)),s.level>=3?'Fully improved':'Gather the listed resources',upgradeCost(s)),
  item('forgeDefend',`Build ward ${s.defenses}/3`,ready&&s.defenses<3&&canPay(s,defenseCost(s)),s.defenses>=3?'All wards built':'Gather the listed resources',defenseCost(s)),
  item('forgeEncounter',s.encounter?'Defend the forge':`Challenge raid ${s.completed+1}`,ready&&!s.encounter&&(world.tick||0)>=s.cooldownUntil,s.encounter?'Raid in progress':'Forge recovering'),
  item('forgeContribute','Supply expedition',near&&!!world.adventure&&contributeSettlement(structuredClone(world.adventure),{...s.stock}).ok,'Start an expedition and gather needed supplies'),
  item('forgeRepair','Repair forge',near&&(world.shrine?.hp??100)<100&&s.stock.wood>=3,'Forge needs damage and 3 timber',{wood:3})];
 actions[3].cooldown=Math.max(0,s.cooldownUntil-(world.tick||0))/60;
 actions.push(item('forgeAssign','Assign worker job',near,'Return to the forge'));
 for(const kind of PACK){const amount=Math.min(99,p?.resources?.[kind]||0,999-s.stock[kind]);if((p?.resources?.[kind]||0)>0)actions.push({...item('forgeSupply',`Deliver ${amount} ${kind}`,near&&amount>0,'Shared store is full'),detail:{kind,amount}});}
 const goal=s.encounter?`Defend the forge · ${s.encounter.foes.length} raiders remain`:!s.workers.length?'Summon a worker to gather timber and stone':s.workers.every(w=>w.phase==='no_resource')?'Sites exhausted · raids earn supplies; Gods can plant groves or summon crystal':s.defenses===0?'Gather 4 timber and 3 stone, then build a ward':s.level<3?`Improve the forge to tier ${s.level+1}; recover mana before the next raid`:'Forge thriving · defend against a stronger raid or supply an expedition';
 return {title:'Bran’s Forge',goal,stock:{...s.stock},level:s.level,defenses:s.defenses,completed:s.completed,workers:s.workers.map(w=>({...w,name:`Worker ${w.id.replace('worker','')}`,position:[...w.position]})),encounter:s.encounter?{...s.encounter,title:`Raid ${s.encounter.wave}`,status:`${s.encounter.foes.length} raiders remain · defend the forge`,foes:[...s.encounter.foes]}:null,lastResult:s.lastResult,actions};
}

export function restoreSettlement(value,tick,ids,enemyIds=new Set()){
 if(value===undefined)return createSettlement();
 const bad=()=>{throw Error('Invalid settlement');},record=v=>v&&typeof v==='object'&&!Array.isArray(v),exact=(v,keys)=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 if(!exact(value,['v','stock','workers','level','defenses','completed','encounter','lastResult','cooldownUntil','delivered'])||value.v!==1||!record(value.stock)||Object.keys(value.stock).some(k=>!PACK.includes(k))||!PACK.every(k=>value.stock[k]===undefined||integer(value.stock[k],0,999))||!integer(value.level,0,3)||!integer(value.defenses,0,3)||!integer(value.completed,0,999)||!integer(value.delivered,0,1e9)||!integer(value.cooldownUntil,0,tick+180)||!['','victory','defeat'].includes(value.lastResult)||!Array.isArray(value.workers)||value.workers.length>4)bad();
 for(const w of value.workers){
  if(!exact(w,['id','position','yaw','job','phase','cargo','targetId','workTicks','stuckTicks','bestDistance','avoidId','avoidUntil'])||typeof w.id!=='string'||w.id.length>64||!/^worker\d+$/.test(w.id)||ids.has(w.id)||!Array.isArray(w.position)||w.position.length!==3||!w.position.every((v,i)=>bounded(v,i===1?-200:-55,i===1?200:55))||!bounded(w.yaw,-Math.PI,Math.PI)||!PACK.includes(w.job)||!['seeking','travelling','working','returning','sheltering','store_full','no_resource','blocked'].includes(w.phase)||!integer(w.cargo,0,2)||typeof w.targetId!=='string'||!/^[-A-Za-z0-9_]{0,64}$/.test(w.targetId)||!integer(w.workTicks,0,59)||!integer(w.stuckTicks,0,120)||!bounded(w.bestDistance,0,160)||typeof w.avoidId!=='string'||!/^[-A-Za-z0-9_]{0,64}$/.test(w.avoidId)||!integer(w.avoidUntil,0,tick+1200))bad();
  ids.add(w.id);
 }
 if(value.encounter!==null){const e=value.encounter;if(!exact(e,['wave','elapsed','foes','killed'])||!integer(e.wave,1,1000)||e.wave!==value.completed+1||!integer(e.elapsed,0,7200)||!integer(e.killed,0,6)||!Array.isArray(e.foes)||e.foes.length>6||new Set(e.foes).size!==e.foes.length||!e.foes.every(id=>typeof id==='string'&&/^raid\d+$/.test(id)&&enemyIds.has(id))||e.foes.length+e.killed!==Math.min(6,2+value.completed))bad();}
 return {...structuredClone(value),stock:restoreMaterials(value.stock)};
}
