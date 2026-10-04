import {terrainSpecial} from './weapon-specials.js';
import {BLOOM,addBloom} from './bloom.js';
import {queueMeteorReward} from './resources.js';
import {ENT_SIZES,entSpec,entPartPosition,entPartReach,severEntLimb,dropEntTimber} from './ents.js';
import {TREE_LIMITS} from './trees.js';
import {specialCooldown} from './special-cooldowns.js';
// Bounded deterministic combat state. Rendering supplies triangle contacts; the host
// checks those contacts against its swept paths, reach and anatomical envelopes.
export const TOOLS = Object.freeze(['axe','pick','hammer','crossbow','bow','limb','wyrmspout','flask']);
export const PARTS = Object.freeze(['head','torso','leftArm','rightArm','leftLeg','rightLeg']);
export const COMBAT_LIMITS = Object.freeze({projectiles:96, embeds:192, detachedParts:96});
const vec = (v,limit=200) => Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=limit);
const quat = q => Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<.02;
const dist = (a,b) => Math.hypot(...a.map((n,i)=>n-b[i]));
const unit = v => vec(v,1.01)&&Math.abs(Math.hypot(...v)-1)<.02;
const bounds = b => b&&vec(b.min,4)&&vec(b.max,4)&&b.min.every((n,i)=>n<=b.max[i]&&b.max[i]-n<=5);
const partPose = p => p&&vec(p.position)&&quat(p.quaternion)&&(p.localBounds===undefined||bounds(p.localBounds));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Siegebird reload: a songbird brings each bolt (client presentation, 1.0 s). The host accepts a
// shot slightly early so network jitter never swallows a click the bird visibly allowed.
// Perfect wind: the first fire press during a reload is judged against the pawl latching (60% of the reload);
// within windowTicks of it, the next reload runs quick (45 ticks). VR hands that wind the crank themselves earn it
// by latching before the bird seats the bolt (80%). A press outside the window forfeits it for this reload.
export const SIEGEBIRD=Object.freeze({reloadTicks:60,acceptTicks:54,quickTicks:45,quickAcceptTicks:40,latch:.6,handLatch:.8,handMin:.3,windowTicks:6,damage:48,goldenMultiplier:4,goldenBase:.03,goldenPerHit:.0015,goldenMax:.15,hitCap:1e6});
export const siegebirdReloadTicks=quick=>quick?SIEGEBIRD.quickTicks:SIEGEBIRD.reloadTicks;
// Judge a wind press `elapsed` ticks into a reload. window narrows for client-side prediction.
export function siegebirdPerfect(elapsed,{quick=false,hand=false,window=SIEGEBIRD.windowTicks}={}){
  const d=siegebirdReloadTicks(quick);
  return hand?elapsed>=Math.round(SIEGEBIRD.handMin*d)&&elapsed<=Math.round(SIEGEBIRD.handLatch*d)+window:Math.abs(elapsed-Math.round(SIEGEBIRD.latch*d))<=window;
}
export function siegebirdGoldenChance(hits=0){return Math.min(SIEGEBIRD.goldenMax,SIEGEBIRD.goldenBase+Math.max(0,hits)*SIEGEBIRD.goldenPerHit);}
// Deterministic per-reload roll (FNV-1a of player, reload index and tick): every peer replays it identically.
export function siegebirdRoll(id,n,tick){let h=0x811c9dc5;for(const c of `${id}:${n}:${tick}`){h^=c.charCodeAt(0);h=Math.imul(h,0x01000193);}return (h>>>0)/4294967296;}
// quick/wind are optional together (saves from before perfect wind carry only n, golden and hits).
export const validSiegebird=v=>v&&typeof v==='object'&&!Array.isArray(v)&&(Object.keys(v).length===3||Object.keys(v).length===5&&typeof v.quick==='boolean'&&[-1,0,1].includes(v.wind))&&Number.isSafeInteger(v.n)&&v.n>=0&&v.n<=1e9&&typeof v.golden==='boolean'&&Number.isSafeInteger(v.hits)&&v.hits>=0&&v.hits<=SIEGEBIRD.hitCap;
const depth = n => Number.isFinite(n)&&n>=0&&n<=.25;
const thickness = n => Number.isFinite(n)&&n>=0&&n<=.8;
const rotate = (v,q) => {const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];};
function heldPose(d,holder){
  const hand=holder.hands?.[1]||holder.hands?.[0],yaw=holder.yaw||0;
  const q=hand?[...hand.quaternion]:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)];
  // Match the visible part's centre to the grip, not its authored bone pivot.
  const box=d.localBounds,center=box?box.min.map((n,i)=>(n+box.max[i])*.5):[0,0,0];
  const offset=rotate(center,q);
  const right=[Math.cos(yaw),0,-Math.sin(yaw)],forward=[-Math.sin(yaw),0,-Math.cos(yaw)];
  const grip=hand?holder.position.map((n,i)=>n+hand.position[i]):holder.position.map((n,i)=>n+right[i]*.3+forward[i]*.7+(i===1?1.2:0));
  d.quaternion=q;d.position=grip.map((n,i)=>n-offset[i]);
}
function embedDepth(kind,part,measured,targetId){
  if(targetId==='world'||targetId==='terrain')return .025;
  const nominal=part==='head'?.26:part==='torso'?.3:.2;
  const available=thickness(measured)&&measured>.001?measured:nominal;
  return Math.round(clamp(available*.52,kind==='bolt'?.06:.045,kind==='bolt'?.17:.13)*1000)/1000;
}
const fail=code=>({ok:false,code,events:[]}), ok=events=>({ok:true,events});
export function enemyParts(kind='skeleton',size) {return Object.fromEntries(PARTS.map(part=>[part,kind==='ent'?(ENT_SIZES[size]||ENT_SIZES.elder).parts[part]:kind==='golem'?120:part==='torso'?100:55]));}
// Save/restore ceilings shared by every creature kind (ents carry their size class).
export const enemyMaxHp=e=>e?.kind==='ent'?entSpec(e).hp:e?.kind==='golem'?320:100;
export const enemyPartMax=(e,part)=>e?.kind==='ent'?entSpec(e).parts[part]:e?.kind==='golem'?120:part==='torso'?100:55;
export function emptyScorch() {return Object.fromEntries(PARTS.map(part=>[part,0]));}
export function applyEnemyScorch(enemy,part,amount){
  if(!enemy||!PARTS.includes(part)||!Number.isFinite(amount)||amount<=0)return false;
  enemy.scorch ||= emptyScorch();
  enemy.scorch[part]=clamp((enemy.scorch[part]||0)+amount,0,1);
  return true;
}
export function createEnemy(id,position,kind='skeleton') {return {id,position,kind,yaw:0,hp:kind==='golem'?320:100,parts:enemyParts(kind),missingParts:[],...(kind==='golem'?{armor:3}:{}),attackTick:-1000};}
const centers={head:[0,1.75,0],torso:[0,1.15,0],leftArm:[.48,1.12,0],rightArm:[-.48,1.12,0],leftLeg:[.2,.48,0],rightLeg:[-.2,.48,0]};
export function partPosition(enemy,part){if(enemy.kind==='ent')return entPartPosition(enemy,part);const canonical=centers[part]||centers.torso,a=enemy.kind==='golem'?[-canonical[0],canonical[1],canonical[2]]:canonical,s=enemy.kind==='golem'?1.45:1,c=Math.cos(enemy.yaw),t=Math.sin(enemy.yaw);return [enemy.position[0]+(a[0]*c+a[2]*t)*s,enemy.position[1]+a[1]*s,enemy.position[2]+(-a[0]*t+a[2]*c)*s];}
export function validPartHit(enemy,part,point) {
  if(!PARTS.includes(part)||enemy.missingParts?.includes(part)||!vec(point))return false;
  if(enemy.kind==='ent')return dist(point,entPartPosition(enemy,part))<=entPartReach(enemy,part);
  const s=enemy.kind==='golem'?1.45:1,center=partPosition(enemy,part);
  // The shipped 1.7m skeleton skull spans y=1.259..1.724. The historical
  // 1.75m fallback pivot rejected real jaw/face triangles. This is only the
  // authority sanity envelope: rendered triangles still determine every hit.
  if(part==='head'&&enemy.kind!=='golem')center[1]=enemy.position[1]+1.50;
  return dist(point,center) <= (part==='head'?.4:part==='torso'?.68:.95)*s;
}
// Timber context for ents: the shared log ceiling, with a wood pickup for anything that does not fit.
const entContext=(state,ctx)=>({...ctx,logLimit:TREE_LIMITS.logs,makePickup:(kind,x,z,amount)=>{if(state.pickups.length<256)state.pickups.push({id:ctx.nextId(state,'p'),kind,x,z,y:ctx.terrainHeight(state,x,z),amount});}});
function removeDetached(state,part){state.detachedParts.splice(state.detachedParts.indexOf(part),1);state.embeds=state.embeds.filter(e=>e.targetId!==part.id);}
function detach(state,enemy,part,hit,ctx,events){
  if(enemy.missingParts.includes(part))return null;
  // Ent limbs are timber, not carried remains: a branch arm drops as a log, roots and crown splinter.
  if(enemy.kind==='ent'){const e=severEntLimb(state,enemy,part,entContext(state,ctx));if(e)events.push(e);return null;}
  if(state.detachedParts.length>=COMBAT_LIMITS.detachedParts){const old=state.detachedParts.find(p=>!p.heldBy);if(old)removeDetached(state,old);else return null;}
  enemy.missingParts.push(part);enemy.parts[part]=0;
  const supplied=hit?.partPoses?.[part]||(hit?.part===part?{position:hit.partPosition,quaternion:hit.partQuaternion,localBounds:hit.localBounds}:null);
  const usePose=partPose(supplied)&&dist(supplied.position,partPosition(enemy,part))<2.4;
  // The exact struck surface normal drives the collapse. Stable per-limb
  // spread prevents six pieces from launching in an identical rigid pose.
  const index=PARTS.indexOf(part),seed=[...String(enemy.id)].reduce((h,c)=>Math.imul(h,31)+c.charCodeAt(0)|0,17);
  const angle=(seed+index*167)*.017,side=[Math.cos(angle),Math.sin(angle)],normal=unit(hit?.normal)?hit.normal:[Math.sin(enemy.yaw),0,Math.cos(enemy.yaw)];
  const force=enemy.kind==='golem'?1.1:2.1,impact=clamp(Number(hit?.energy)||1,.5,2);
  const d={id:ctx.nextId(state,'d'),sourceId:enemy.id,kind:enemy.kind,part,position:usePose?[...supplied.position]:partPosition(enemy,part),quaternion:usePose?[...supplied.quaternion]:[0,Math.sin(enemy.yaw/2),0,Math.cos(enemy.yaw/2)],scorch:enemy.scorch?.[part]||0,...((enemy.burnUntil||0)>state.tick&&enemy.burnPart===part?{burnUntil:enemy.burnUntil,burnPart:part}:{}),localBounds:usePose&&bounds(supplied.localBounds)?structuredClone(supplied.localBounds):{min:[-.25,part.endsWith('Leg')?-.5:-.25,-.25],max:[.25,part.endsWith('Leg')?.5:.25,.25]},velocity:[(-normal[0]*force+side[0]*.65)*impact,1.0+(part==='head'?1.5:part.endsWith('Arm')?1.1:.45)+Math.max(0,-normal[1])*.7,(-normal[2]*force+side[1]*.65)*impact],angularVelocity:[(1.1+index*.13)*side[1],.5+index*.19,(1.4+index*.09)*side[0]],heldBy:null,bornTick:state.tick};
  state.detachedParts.push(d);
  for(const e of state.embeds)if(e.targetId===enemy.id&&e.part===part)e.targetId=d.id;
  events.push({kind:'detach',position:[...d.position],id:d.id,sourceId:enemy.id,part});return d;
}
// Actual detached rock geometry remains the target: two pick strikes salvage a chunk.
export function mineGolemRemains(state,p,m,ctx){
 const d=state.detachedParts.find(d=>d.id===m.targetId);
 if(!d||d.kind!=='golem'||state.enemies.some(e=>e.id===d.sourceId))return null;
 if(p.tool!=='pick'||d.heldBy)return {ok:false,code:d.heldBy?'hands_full':'needs_pick',events:[]};
 const dx=d.position[0]-p.position[0],dz=d.position[2]-p.position[2],distance=Math.hypot(dx,dz);
 if(!vec(m.point)||distance>3.2||Math.abs(d.position[1]-p.position[1])>3||dist(m.point,d.position)>1.8||(distance>.5&&(-Math.sin(p.yaw)*dx-Math.cos(p.yaw)*dz)/distance<.45))return fail('out_of_reach');
 if((d.miningHits||0)>=1&&state.pickups.length>=256)return fail('world_limit');
 d.miningHits=(d.miningHits||0)+1;
 const events=[{kind:'stone_hit',id:d.id,position:[...m.point],normal:[...m.normal],material:'stone',energy:1.2}];
 if(d.miningHits>=2){const amount=['head','torso'].includes(d.part)?2:1;state.pickups.push({id:ctx.nextId(state,'p'),kind:'stone',amount,x:d.position[0],z:d.position[2],y:ctx.terrainHeight(state,d.position[0],d.position[2])});events.push({kind:'ore_break',id:d.id,position:[...d.position],material:'stone'});removeDetached(state,d);}
 return ok(events);
}
export function hitEnemyPart(state,enemy,part,amount,hit,ctx,events,{projectile=false}={}) {
  if(!state.enemies.includes(enemy)||!PARTS.includes(part)||enemy.missingParts.includes(part))return false;
  const armored=enemy.kind==='golem'&&(enemy.armor??3)>0;
  if(enemy.kind==='ent'&&hit?.tool==='axe')amount*=2; // the axe was made for wood
  if(armored){if(hit?.tool==='pick'){enemy.armor=Math.max(0,(enemy.armor??3)-1);events.push({kind:'armor_break',position:[...(hit.point||enemy.position)],id:enemy.id});}amount*=.45;}
  enemy.hurtTick=state.tick;enemy.parts[part]=Math.max(0,enemy.parts[part]-amount);
  const headshot=projectile&&part==='head'&&enemy.kind==='skeleton';
  // Body hits take normal damage: one arrow cannot kill a fresh skeleton, but
  // repeated body shots must not leave it immortal at one HP.
  const creditedDamage=Math.min(enemy.hp,headshot?enemy.hp:amount);
  const owner=state.players.find(p=>p.id===hit?.ownerId);
  if(owner?.stats)owner.stats.contribution=Math.min(1e9,owner.stats.contribution+creditedDamage);
  enemy.hp-=headshot?enemy.hp:amount;
  events.push({kind:headshot?'headshot':'hit',position:[...(hit?.point||enemy.position)],id:enemy.id,part,material:enemy.kind==='golem'?'stone':enemy.kind==='ent'?'wood':'bone',normal:unit(hit?.normal)?[...hit.normal]:[0,1,0],energy:hit?.tool==='hammer'?1.8:1,damage:creditedDamage,resisted:armored});
  if(!projectile&&part!=='torso'&&enemy.parts[part]===0)detach(state,enemy,part,hit,ctx,events);
  if(part==='head'&&enemy.missingParts.includes('head'))enemy.hp=0;
  if(enemy.hp<=0){if(owner?.stats)owner.stats.kills=Math.min(1e9,owner.stats.kills+1);if(owner?.role==='hero')addBloom(state,enemy.kind==='golem'?BLOOM.golem:BLOOM.skeleton,events,enemy.position);if(enemy.meteorBorn)queueMeteorReward(state,enemy,ctx,events);else if(enemy.kind==='ent')dropEntTimber(state,enemy,entContext(state,ctx),events,entSpec(enemy).trunkLogs);else dropSkeletonSalvage(state,enemy,ctx,events,owner);for(const limb of PARTS)detach(state,enemy,limb,hit,ctx,events);events.push({kind:'death',position:[...enemy.position],id:enemy.id,creature:enemy.kind,part,normal:unit(hit?.normal)?[...hit.normal]:[0,1,0],energy:hit?.tool==='hammer'?1.8:1});state.enemies.splice(state.enemies.indexOf(enemy),1);}
  return true;
}
// Skeleton equipment and a golem's forged iron bracers are useful Iron immediately (golem stone comes from mining
// its remains); ore has its separate Forge path.
// Coalesce nearby scrap when the world is busy instead of making another draw call.
function dropSkeletonSalvage(state,enemy,ctx,events,owner){
 const [x,,z]=enemy.position,near=state.pickups.find(q=>q.kind==='iron'&&Number.isSafeInteger(q.amount)&&q.amount<10&&Math.hypot(q.x-x,q.z-z)<2);
 let id=near?.id;
 if(near)near.amount++;
 else if(state.pickups.length<256){id=ctx.nextId(state,'p');state.pickups.push({id,kind:'iron',amount:1,x,z,y:ctx.terrainHeight(state,x,z)});}
 else if(owner&&Number.isSafeInteger(owner.resources?.iron)&&owner.resources.iron<999){owner.resources.iron++;id=owner.id;}
 else return;
 events.push({kind:'salvage',id,resource:'iron',amount:1,position:[...enemy.position]});
}
function segmentDistance(p,a,b){const d=b.map((n,i)=>n-a[i]),l=d.reduce((n,v)=>n+v*v,0),t=l?clamp(p.reduce((n,v,i)=>n+(v-a[i])*d[i],0)/l,0,1):0;return dist(p,a.map((n,i)=>n+d[i]*t));}
function validContact(m){return (m.surface===undefined||m.surface==='shield')&&vec(m.point)&&unit(m.normal)&&vec(m.localPoint,m.targetId==='world'||m.targetId==='terrain'?200:8)&&quat(m.localQuaternion)&&(m.localNormal===undefined||unit(m.localNormal))&&(m.impactThickness===undefined||thickness(m.impactThickness))&&(m.penetration===undefined||depth(m.penetration))&&(m.boneName===undefined||(typeof m.boneName==='string'&&m.boneName.length<=128))&&(m.partPosition===undefined||vec(m.partPosition))&&(m.partQuaternion===undefined||quat(m.partQuaternion))&&(m.localBounds===undefined||bounds(m.localBounds))&&(m.partPoses===undefined||(m.partPoses&&typeof m.partPoses==='object'&&Object.keys(m.partPoses).length<=6&&Object.entries(m.partPoses).every(([k,v])=>PARTS.includes(k)&&partPose(v))));}
export function projectileContact(state,m,ctx){
  if(!m||typeof m!=='object')return fail('invalid_contact');
  const shot=state.projectiles.find(q=>q.id===m.projectileId);if(!shot||!validContact(m))return fail('invalid_contact');
  // Keep 250 ms of fixed-step sweeps so a 20 Hz snapshot can report actual triangles.
  const paths=shot.trail||[shot.previousPosition,shot.position];if(!paths.slice(1).some((b,i)=>segmentDistance(m.point,paths[i],b)<.22))return fail('invalid_contact');
  const enemy=state.enemies.find(e=>e.id===m.targetId), detached=state.detachedParts.find(e=>e.id===m.targetId),shield=m.surface==='shield';
  // Authored shields extend beyond the anatomical arm envelope. Keep their
  // triangle checks host-only, bounded to the actor, and absent with that arm.
  const validShield=enemy&&enemy.kind==='skeleton'&&!enemy.missingParts.includes(m.part)&&dist(m.point,partPosition(enemy,'torso'))<1.45;
  if(enemy?!(shield?validShield:validPartHit(enemy,m.part,m.point)):detached?m.part!==detached.part||dist(m.point,detached.position)>1.8: m.targetId!=='world'&&(m.targetId!=='terrain'||Math.abs(m.point[1]-ctx.terrainHeight(state,m.point[0],m.point[2]))>.3))return fail('invalid_contact');
  // Only host-produced triangle contacts reach this path. The surface marker
  // must still belong to a skeleton's surviving shield-bearing arm.
  if(shield&&((enemy||detached)?.kind!=='skeleton'||!['leftArm','rightArm'].includes(m.part)))return fail('invalid_contact');
  state.projectiles.splice(state.projectiles.indexOf(shot),1);
  if(['flame','fuel'].includes(shot.kind))return ok(ctx.fireContact(state,shot,m));
  if(state.embeds.length>=COMBAT_LIMITS.embeds)state.embeds.shift();
  state.embeds.push({id:shot.id,kind:shot.kind,...(shot.golden?{golden:true}:{}),targetId:m.targetId,part:m.part||'torso',localPoint:[...m.localPoint],localQuaternion:[...m.localQuaternion],point:[...m.point],normal:[...m.normal],...(m.localNormal?{localNormal:[...m.localNormal]}:{}),...(shield?{surface:'shield'}:{}),penetration:shield?.035:embedDepth(shot.kind,m.part,m.impactThickness,m.targetId),...(m.boneName?{boneName:m.boneName}:{})});
  const events=[{kind:'embed',id:shot.id,ownerId:shot.ownerId,position:[...m.point],targetId:m.targetId,impact:shield||!enemy,normal:[...m.normal],material:shield?'wood':detached?.kind==='skeleton'?'bone':'stone',...(shield?{blocked:true}: {}),...(shot.golden?{golden:true}:{})}];
  if(shot.kind==='arrow'&&Math.hypot(...shot.curve)>.000001)events.push(...ctx.fireContact(state,shot,m));
  if(enemy&&!shield){
    // Siegebird mastery: every bolt that lands on a foe makes the golden bird a little more likely.
    const owner=shot.kind==='bolt'&&state.players.find(p=>p.id===shot.ownerId);if(owner?.siegebird)owner.siegebird.hits=Math.min(SIEGEBIRD.hitCap,owner.siegebird.hits+1);
    hitEnemyPart(state,enemy,m.part,shot.kind==='bolt'?SIEGEBIRD.damage*(shot.golden?SIEGEBIRD.goldenMultiplier:1):38,{...m,ownerId:shot.ownerId,...(shot.golden?{golden:true}:{})},ctx,events,{projectile:true});
  }
  return ok(events);
}
export function releaseHeld(state,p,direction,throwing=false){const held=state.detachedParts.find(d=>d.heldBy===p.id);if(!held)return false;held.heldBy=null;held.velocity=throwing?direction.map((v,i)=>v*12+(i===1?2:0)):[0,0,0];held.angularVelocity=throwing?[5,2,3]:[0,0,0];held.throwerId=throwing?p.id:null;held.hitIds=[];if(p.tool==='limb')p.tool='axe';return true;}
export function combatAction(state,p,m,ctx){
  if(m.action==='flame'||m.action==='pour'){
    const flame=m.action==='flame';
    if(p.tool!==(flame?'wyrmspout':'flask')||!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    if(flame&&(p.overheatUntil||0)>state.tick)return fail('overheated');
    if(state.tick-p.attackTick<(flame?6:60))return fail('cooldown');
    if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.attackTick=state.tick;
    if(flame){p.flameTick=state.tick;p.heat=clamp((p.heat||0)+.0125,0,1);if(p.heat>=.999){p.heat=1;p.overheatUntil=state.tick+180;}}
    const id=ctx.nextId(state,'q'),speed=flame?10.5:6,motion=flame?[0,0,0]:ctx.playerVelocity?.(p);
    const inherited=vec(motion,100)?motion:[0,0,0];
    state.projectiles.push({id,ownerId:p.id,kind:flame?'flame':'fuel',lit:!flame&&!!p.flaskLit,position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map((n,i)=>n*speed+(!flame&&i===1?2:0)+inherited[i]),curve:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});
    return ok([{kind:flame?'flame_emit':'fuel_throw',weapon:p.tool,position:[...m.origin],id}]);
  }
  if(m.action==='special'&&p.tool==='wyrmspout'){
    if((p.overheatUntil||0)>state.tick)return fail('overheated');
    if(state.tick-(p.flameTick??-1000)<10)return fail('release_to_vent');
    if(state.tick-(p.specialTick??-1000)<specialCooldown('wyrmspout'))return fail('cooldown');
    p.specialTick=state.tick;p.heat=Math.max(0,(p.heat||0)-.5);return ok([]);
  }
  if(m.action==='special'&&p.tool==='flask'){p.flaskLit=!p.flaskLit;return ok([]);}
  if(m.action==='fire'){
    if(!['bow','crossbow'].includes(p.tool)||!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    const curve=m.curve===undefined?[0,0,0]:m.curve;if(!vec(curve,1.31)||Math.hypot(...curve)>1.31||m.draw!==undefined&&(!Number.isFinite(m.draw)||m.draw<0||m.draw>1))return fail('invalid_action');
    if(state.tick-p.attackTick<(p.tool==='bow'?33:p.siegebird?.quick?SIEGEBIRD.quickAcceptTicks:SIEGEBIRD.acceptTicks))return fail('cooldown');if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.attackTick=state.tick;const id=ctx.nextId(state,'q'),speed=p.tool==='bow'?18+18*Math.max(.2,m.draw??.67):42;
    // The bolt on the rail was decided when the previous bird was sent; roll the next bird now.
    let golden=false,reload;
    if(p.tool==='crossbow'){const sb=p.siegebird??={n:0,golden:false,hits:0};golden=sb.golden;sb.n=Math.min(1e9,sb.n+1);sb.golden=siegebirdRoll(p.id,sb.n,state.tick)<siegebirdGoldenChance(sb.hits);sb.quick=sb.wind===1;sb.wind=0;reload={n:sb.n,golden:sb.golden,...(sb.quick?{quick:true}:{})};}
    state.projectiles.push({id,ownerId:p.id,kind:p.tool==='bow'?'arrow':'bolt',position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map(n=>n*speed),curve:p.tool==='bow'?[...curve]:[0,0,0],bornTick:state.tick,trail:[[...m.origin]],...(golden?{golden:true}:{})});return ok([{kind:'shoot',weapon:p.tool,phoenix:p.tool==='bow'&&Math.hypot(...curve)>.000001,position:[...m.origin],id,...(golden?{golden:true}:{}),...(reload?{reload}:{})}]);
  }
  // Perfect wind press (see SIEGEBIRD). Never fails visibly: a late, early or repeated press just changes nothing.
  if(m.action==='wind'){
    if(p.tool!=='crossbow'||m.hand!==undefined&&typeof m.hand!=='boolean')return fail('invalid_action');
    const sb=p.siegebird,elapsed=state.tick-p.attackTick;
    if(sb&&!sb.wind&&elapsed<siegebirdReloadTicks(sb.quick)){sb.quick=!!sb.quick;sb.wind=siegebirdPerfect(elapsed,{quick:sb.quick,hand:m.hand===true})?1:-1;}
    return ok([]);
  }
  if(m.action==='projectileHit')return fail('host_required');
  if(m.action==='grab'){const d=state.detachedParts.find(q=>q.id===m.id);if(!d||d.heldBy||state.detachedParts.some(q=>q.heldBy===p.id)||dist(d.position,p.position.map((n,i)=>n+(i===1?1:0)))>2.8)return fail('out_of_reach');d.heldBy=p.id;d.velocity=[0,0,0];d.angularVelocity=[0,0,0];heldPose(d,p);p.tool='limb';return ok([{kind:'grab',id:d.id,position:[...d.position]}]);}
  if(m.action==='release'){if(m.throw!==undefined&&typeof m.throw!=='boolean')return fail('invalid_action');const dir=m.direction??[-Math.sin(p.yaw),.1,-Math.cos(p.yaw)];if(!vec(dir,1.01))return fail('invalid_action');const n=Math.hypot(...dir);if(n<.9||n>1.1)return fail('invalid_action');return releaseHeld(state,p,dir.map(v=>v/n),m.throw===true)?ok([]):fail('nothing_held');}
  if(m.action==='special'&&['axe','pick'].includes(p.tool))return terrainSpecial(state,p,ctx,hitEnemyPart,m);
  if(m.action==='special'){
    if(p.tool!=='hammer')return fail('invalid_action');
    if(state.tick-(p.specialTick??-1000)<specialCooldown('hammer'))return fail('cooldown');
    const at=[p.position[0]-Math.sin(p.yaw)*1.5,p.position[1],p.position[2]-Math.cos(p.yaw)*1.5],events=[];
    p.specialTick=state.tick;
    for(const e of [...state.enemies])if(dist(e.position,at)<5)hitEnemyPart(state,e,'torso',65,{tool:p.tool,point:at,ownerId:p.id},ctx,events);
    events.push({kind:'hammer_slam',id:p.id,position:at});return ok(events);
  }
  return null;
}
export function stepCombat(state,ctx,events){
  const dt=1/60;
  for(const p of [...state.projectiles]){
    p.previousPosition=[...p.position];const age=(state.tick-p.bornTick-1)*dt,len=Math.hypot(...p.curve),fraction=t=>1-Math.pow(1-clamp(t/.85,0,1),3),angle=len*(fraction(age+dt)-fraction(age));
    let v=p.velocity;if(len>.000001){const a=p.curve.map(n=>n/len),c=Math.cos(angle),s=Math.sin(angle),dot=a.reduce((n,q,i)=>n+q*v[i],0),cross=[a[1]*v[2]-a[2]*v[1],a[2]*v[0]-a[0]*v[2],a[0]*v[1]-a[1]*v[0]];v=v.map((n,i)=>n*c+cross[i]*s+a[i]*dot*(1-c));}
    const nv=v.map((n,i)=>n*Math.exp(-.045*dt)-(i===1?(p.kind==='arrow'?5.8:p.kind==='flame'?5.2:p.kind==='fuel'?15:3)*dt:0));p.position=p.position.map((n,i)=>n+(p.velocity[i]+nv[i])*.5*dt);p.velocity=nv;p.trail.push([...p.position]);if(p.trail.length>16)p.trail.shift();
    if(state.tick-p.bornTick>(p.kind==='flame'?48:p.kind==='fuel'?180:480)||Math.abs(p.position[0])>55||Math.abs(p.position[2])>55||p.position[1]<ctx.terrainHeight(state,p.position[0],p.position[2])-.5)state.projectiles.splice(state.projectiles.indexOf(p),1);
  }
  for(const d of [...state.detachedParts]){
    const holder=state.players.find(p=>p.id===d.heldBy&&p.role==='hero');if(d.heldBy&&!holder)d.heldBy=null;
    if(holder){heldPose(d,holder);continue;}
    // Settled remains keep their actual geometry and grab/mining behavior, but
    // stop sampling all eight terrain corners every tick until re-thrown.
    if(state.tick-d.bornTick>45&&Math.hypot(...d.velocity)<.035&&Math.hypot(...d.angularVelocity)<.035){d.velocity=[0,0,0];d.angularVelocity=[0,0,0];continue;}
    d.velocity[1]-=15*dt;const old=[...d.position];d.position=d.position.map((n,i)=>clamp(n+d.velocity[i]*dt,i===1?-150:-54.5,i===1?150:54.5));
    const [x,y,z,w]=d.quaternion,[a,b,c]=d.angularVelocity;const q=[x+dt*.5*(a*w+b*z-c*y),y+dt*.5*(b*w+c*x-a*z),z+dt*.5*(c*w+a*y-b*x),w-dt*.5*(a*x+b*y+c*z)],l=Math.hypot(...q);d.quaternion=q.map(n=>n/l);
    // Project all eight corners of the complete frozen limb (including feet) onto
    // terrain. A pivot-only collider otherwise buries knees/feet after rotation.
    const [qx,qy,qz,qw]=d.quaternion,box=d.localBounds||{min:[-.3,-.5,-.3],max:[.3,.5,.3]};let floor=-Infinity;
    for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x),rx=x+qw*tx+qy*tz-qz*ty,ry=y+qw*ty+qz*tx-qx*tz,rz=z+qw*tz+qx*ty-qy*tx;floor=Math.max(floor,ctx.terrainHeight(state,d.position[0]+rx,d.position[2]+rz)-ry);}
    if(d.position[1]<floor){d.position[1]=floor;d.velocity[1]=Math.abs(d.velocity[1])>.8?Math.abs(d.velocity[1])*.3:0;d.velocity[0]*=.88;d.velocity[2]*=.88;d.angularVelocity=d.angularVelocity.map(n=>n*.9);}
    const speed=Math.hypot(...d.velocity);if(d.throwerId&&speed>4)for(const enemy of [...state.enemies])if(!d.hitIds.includes(enemy.id)&&segmentDistance(partPosition(enemy,'torso'),old,d.position)<.9){d.hitIds.push(enemy.id);hitEnemyPart(state,enemy,'torso',Math.min(60,speed*4),{ownerId:d.throwerId},ctx,events);d.velocity=d.velocity.map(n=>n*.55);}
  }
}
export function validateCombat(saved,ids){
  const unique=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&!ids.has(id)&&(ids.add(id),true);
  const tick=n=>Number.isSafeInteger(n)&&n>=0&&n<=saved.tick;
  for(const [key,cap]of Object.entries(COMBAT_LIMITS))if(saved[key]!==undefined&&(!Array.isArray(saved[key])||saved[key].length>cap))throw Error('Invalid combat limit');
  for(const p of saved.projectiles||[])if(!p||!unique(p.id)||typeof p.ownerId!=='string'||!['arrow','bolt','flame','fuel'].includes(p.kind)||(p.lit!==undefined&&typeof p.lit!=='boolean')||(p.golden!==undefined&&(p.golden!==true||p.kind!=='bolt'))||!vec(p.position)||!vec(p.previousPosition)||!vec(p.velocity,p.kind==='fuel'?120:80)||!vec(p.curve,1.31)||Math.hypot(...p.curve)>1.31||!tick(p.bornTick)||!Array.isArray(p.trail)||p.trail.length<1||p.trail.length>16||!p.trail.every(q=>vec(q)))throw Error('Invalid projectile');
  for(const e of [...saved.enemies,...(saved.detachedParts||[])])if(e.burnUntil!==undefined&&(!Number.isSafeInteger(e.burnUntil)||e.burnUntil<0||e.burnUntil>saved.tick+240||!PARTS.includes(e.burnPart))||e.burnPart!==undefined&&!PARTS.includes(e.burnPart))throw Error('Invalid burning part');
  for(const d of saved.detachedParts||[])if(d.scorch!==undefined&&(!Number.isFinite(d.scorch)||d.scorch<0||d.scorch>1))throw Error('Invalid detached scorch');
  const held=new Set();
  for(const d of saved.detachedParts||[])if(!d||!unique(d.id)||typeof d.sourceId!=='string'||!['skeleton','golem'].includes(d.kind)||!PARTS.includes(d.part)||!vec(d.position)||!quat(d.quaternion)||d.localBounds!==undefined&&!bounds(d.localBounds)||!vec(d.velocity,100)||!vec(d.angularVelocity,30)||!tick(d.bornTick)||(d.miningHits!==undefined&&(d.kind!=='golem'||!Number.isInteger(d.miningHits)||d.miningHits<0||d.miningHits>1))||(d.heldBy!==null&&(!saved.players.some(p=>p.id===d.heldBy&&p.role==='hero')||held.has(d.heldBy)))||(d.throwerId!==undefined&&d.throwerId!==null&&typeof d.throwerId!=='string')||(d.hitIds!==undefined&&(!Array.isArray(d.hitIds)||d.hitIds.length>64||!d.hitIds.every(q=>typeof q==='string'&&q.length<=64))))throw Error('Invalid detached part');else if(d.heldBy)held.add(d.heldBy);
  for(const e of saved.embeds||[])if(!e||!unique(e.id)||!['arrow','bolt'].includes(e.kind)||(e.golden!==undefined&&(e.golden!==true||e.kind!=='bolt'))||!PARTS.includes(e.part)||!validContact(e)||(e.surface==='shield'&&(!['leftArm','rightArm'].includes(e.part)||(saved.enemies.find(q=>q.id===e.targetId)||saved.detachedParts?.find(q=>q.id===e.targetId))?.kind!=='skeleton'))||!(e.targetId==='world'||e.targetId==='terrain'||saved.enemies.some(q=>q.id===e.targetId)||saved.detachedParts?.some(q=>q.id===e.targetId)))throw Error('Invalid embed');
  for(const e of saved.enemies)if(e.kind!==undefined&&!['skeleton','golem','ent'].includes(e.kind)||e.armor!==undefined&&(!Number.isInteger(e.armor)||e.armor<0||e.armor>3)||e.parts!==undefined&&(!e.parts||!PARTS.every(p=>Number.isFinite(e.parts[p])&&e.parts[p]>=0&&e.parts[p]<=enemyPartMax(e,p)))||e.missingParts!==undefined&&(!Array.isArray(e.missingParts)||e.missingParts.length>6||new Set(e.missingParts).size!==e.missingParts.length||!e.missingParts.every(p=>PARTS.includes(p)&&e.parts?.[p]===0))||e.scorch!==undefined&&(!e.scorch||typeof e.scorch!=='object'||Object.keys(e.scorch).length!==PARTS.length||!PARTS.every(p=>Number.isFinite(e.scorch[p])&&e.scorch[p]>=0&&e.scorch[p]<=1)))throw Error('Invalid enemy anatomy');
}

// Only known fields survive a user-imported checkpoint. Validation above checks
// numeric bounds; this prevents unknown nested payloads inflating every snapshot.
export function restoreCombat(saved){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
  return {
    projectiles:(saved.projectiles||[]).map(p=>pick(p,['id','ownerId','kind','position','previousPosition','velocity','curve','bornTick','trail','lit','golden'])),
    embeds:(saved.embeds||[]).map(e=>pick(e,['id','kind','targetId','part','localPoint','localQuaternion','point','normal','localNormal','penetration','boneName','surface','golden'])),
    detachedParts:(saved.detachedParts||[]).map(d=>({...pick(d,['id','sourceId','kind','part','position','quaternion','velocity','angularVelocity','heldBy','bornTick','throwerId','hitIds','miningHits','scorch','burnUntil','burnPart']),...(d.localBounds?{localBounds:{min:[...d.localBounds.min],max:[...d.localBounds.max]}}:{})})),
  };
}
