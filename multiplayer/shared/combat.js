import {friendlyEnemyHit,damageBattleBase} from './battle-mode.js';
import {findHomeTarget,homeBattle} from './home-bases.js';
import {terrainSpecial} from './weapon-specials.js';
import {BLOOM,addBloom} from './bloom.js';
import {queueMeteorReward} from './resources.js';
import {ENT_SIZES,entSpec,entPartPosition,entPartReach,severEntLimb,dropEntTimber} from './ents.js';
import {TREE_LIMITS} from './trees.js';
import {STUMPLING,stumplingParts,dropStumplingLoot} from './stumplings.js';
import {specialCooldown} from './special-cooldowns.js';
import {PHOENIX_CARRY,startCarry,carryPose} from './phoenix-carry.js';
import {WYRMSPOUT,sprayTuning,spendGlob,clingSplash} from './wyrmspout.js';
import {EMBERDEW,cinderLaunch,cinderVelocities} from './emberdew.js';
// Phoenix Flare: launch speed and extra upward loft (m/s), and the fuse before it bursts (ticks).
export const FLARE=Object.freeze({speed:30,loft:6,fuse:48});
import {skeletonShield} from './skeleton-kinds.js';
import {damageScale,grantXp,killXp,hasTalent,heroMaxHp} from './hero-progress.js';
import {itemBonus} from './hero-items.js';
import {payKillGold} from './home-shop.js';
import {tavernSafe} from './taverns.js';
import {noteKill} from './dragon-streak.js';
import {stepRemains,applyImpulse,partMass,linkRagdoll,wake,tear} from './remains-physics.js';
import {beyondWorld} from './keep-sites.js';
// Bounded deterministic combat state. Rendering supplies triangle contacts; the host
// checks those contacts against its swept paths, reach and anatomical envelopes.
export const TOOLS = Object.freeze(['axe','pick','hammer','crossbow','bow','limb','wyrmspout','flask','stormreel']);
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
// Keep pylons, turrets and hearts take only this share from plain bolts and arrows; magic (golden bolts, spells, siege engines) and melee hit for full.
export const KEEP_STONE=Object.freeze({plainShot:.25});
export const siegebirdReloadTicks=quick=>quick?SIEGEBIRD.quickTicks:SIEGEBIRD.reloadTicks;
// Judge a wind press `elapsed` ticks into a reload. window narrows for client-side prediction.
export function siegebirdPerfect(elapsed,{quick=false,hand=false,window=SIEGEBIRD.windowTicks}={}){
  const d=siegebirdReloadTicks(quick);
  return hand?elapsed>=Math.round(SIEGEBIRD.handMin*d)&&elapsed<=Math.round(SIEGEBIRD.handLatch*d)+window:Math.abs(elapsed-Math.round(SIEGEBIRD.latch*d))<=window;
}
// Golden Flock (Siegebird talent) triples the chance and raises its ceiling.
export const GOLDEN_FLOCK=Object.freeze({multiplier:3,max:.35});
export function siegebirdGoldenChance(hits=0,flock=false){const c=SIEGEBIRD.goldenBase+Math.max(0,hits)*SIEGEBIRD.goldenPerHit;return flock?Math.min(GOLDEN_FLOCK.max,c*GOLDEN_FLOCK.multiplier):Math.min(SIEGEBIRD.goldenMax,c);}
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
export function enemyParts(kind='skeleton',size) {if(kind==='stumpling')return stumplingParts();return Object.fromEntries(PARTS.map(part=>[part,kind==='ent'?(ENT_SIZES[size]||ENT_SIZES.elder).parts[part]:kind==='golem'?120:part==='torso'?100:55]));}
// Save/restore ceilings shared by every creature kind (ents carry their size class).
export const enemyMaxHp=e=>e?.kind==='stumpling'?STUMPLING.hp:e?.kind==='ent'?entSpec(e).hp:e?.kind==='golem'?320:100;
export const enemyPartMax=(e,part)=>e?.kind==='stumpling'?STUMPLING.part:e?.kind==='ent'?entSpec(e).parts[part]:e?.kind==='golem'?120:part==='torso'?100:55;
export function emptyScorch() {return Object.fromEntries(PARTS.map(part=>[part,0]));}
export function applyEnemyScorch(enemy,part,amount){
  if(!enemy||!PARTS.includes(part)||!Number.isFinite(amount)||amount<=0)return false;
  enemy.scorch ||= emptyScorch();
  enemy.scorch[part]=clamp((enemy.scorch[part]||0)+amount,0,1);
  return true;
}
export function createEnemy(id,position,kind='skeleton') {return {id,position,kind,yaw:0,hp:kind==='golem'?320:100,parts:enemyParts(kind),missingParts:[],...(kind==='golem'?{armor:3}:{}),attackTick:-1000};}
const centers={head:[0,1.75,0],torso:[0,1.15,0],leftArm:[.48,1.12,0],rightArm:[-.48,1.12,0],leftLeg:[.2,.48,0],rightLeg:[-.2,.48,0]};
export function partPosition(enemy,part){if(enemy.kind==='ent')return entPartPosition(enemy,part);if(enemy.kind==='stumpling')return [enemy.position[0],enemy.position[1]+STUMPLING.height*.5,enemy.position[2]];const canonical=centers[part]||centers.torso,a=enemy.kind==='golem'?[-canonical[0],canonical[1],canonical[2]]:canonical,s=enemy.kind==='golem'?1.45:1,c=Math.cos(enemy.yaw),t=Math.sin(enemy.yaw);return [enemy.position[0]+(a[0]*c+a[2]*t)*s,enemy.position[1]+a[1]*s,enemy.position[2]+(-a[0]*t+a[2]*c)*s];}
export function validPartHit(enemy,part,point) {
  if(!PARTS.includes(part)||enemy.missingParts?.includes(part)||!vec(point))return false;
  if(enemy.kind==='ent')return dist(point,entPartPosition(enemy,part))<=entPartReach(enemy,part);
  if(enemy.kind==='stumpling')return dist(point,partPosition(enemy,part))<=.85; // one rigid body: roots and all
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
function detach(state,enemy,part,hit,ctx,events,dying=false){
  if(enemy.missingParts.includes(part))return null;
  // Ent limbs are timber, not carried remains: a branch arm drops as a log, roots and crown splinter.
  if(enemy.kind==='ent'){const e=severEntLimb(state,enemy,part,entContext(state,ctx));if(e)events.push(e);return null;}
  if(enemy.kind==='stumpling')return null; // a critter is one piece of wood: no carried remains
  if(state.detachedParts.length>=COMBAT_LIMITS.detachedParts){const old=state.detachedParts.find(p=>!p.heldBy);if(old)removeDetached(state,old);else return null;}
  enemy.missingParts.push(part);enemy.parts[part]=0;
  const supplied=hit?.partPoses?.[part]||(hit?.part===part?{position:hit.partPosition,quaternion:hit.partQuaternion,localBounds:hit.localBounds}:null);
  const usePose=partPose(supplied)&&dist(supplied.position,partPosition(enemy,part))<2.4;
  // The exact struck surface normal drives the collapse. Stable per-limb
  // spread prevents six pieces from launching in an identical rigid pose.
  const index=PARTS.indexOf(part),seed=[...String(enemy.id)].reduce((h,c)=>Math.imul(h,31)+c.charCodeAt(0)|0,17);
  const angle=(seed+index*167)*.017,side=[Math.cos(angle),Math.sin(angle)],normal=unit(hit?.normal)?hit.normal:[Math.sin(enemy.yaw),0,Math.cos(enemy.yaw)];
  const force=enemy.kind==='golem'?1.1:2.1,impact=clamp(Number(hit?.energy)||(hit?.tool==='hammer'?1.8:1),.5,2);
  const d={id:ctx.nextId(state,'d'),sourceId:enemy.id,kind:enemy.kind,part,position:usePose?[...supplied.position]:partPosition(enemy,part),quaternion:usePose?[...supplied.quaternion]:[0,Math.sin(enemy.yaw/2),0,Math.cos(enemy.yaw/2)],scorch:enemy.scorch?.[part]||0,...((enemy.burnUntil||0)>state.tick&&enemy.burnPart===part?{burnUntil:enemy.burnUntil,burnPart:part}:{}),localBounds:usePose&&bounds(supplied.localBounds)?structuredClone(supplied.localBounds):{min:[-.25,part.endsWith('Leg')?-.5:-.25,-.25],max:[.25,part.endsWith('Leg')?.5:.25,.25]},velocity:dying?[(-normal[0]*force*.45+side[0]*.12)*impact,.35+Math.max(0,-normal[1])*.4,(-normal[2]*force*.45+side[1]*.12)*impact]:[(-normal[0]*force+side[0]*.65)*impact,1.0+(part==='head'?1.5:part.endsWith('Arm')?1.1:.45)+Math.max(0,-normal[1])*.7,(-normal[2]*force+side[1]*.65)*impact],angularVelocity:dying?[.3*side[1],.15*side[0],.3*side[0]]:[(1.1+index*.13)*side[1],.5+index*.19,(1.4+index*.09)*side[0]],heldBy:null,bornTick:state.tick};
  if(dying&&usePose)d.posed=true;
  state.detachedParts.push(d);
  for(const e of state.embeds)if(e.targetId===enemy.id&&e.part===part)e.targetId=d.id;
  events.push({kind:'detach',position:[...d.position],id:d.id,sourceId:enemy.id,part,creature:enemy.kind,...(dying?{dying:true}:{normal:[...normal],energy:impact,...(vec(hit?.point)?{point:[...hit.point]}:{})})});return d;
}
// How a skeleton's bones come apart when it dies (see ragdoll below and docs in shared/remains-physics.js):
//   shatter:  a War Hammer blow (swing or slam) bursts it; every joint breaks and the bones scatter from the impact.
//   headshot: a bolt or arrow to the skull snaps the head back on its neck and throws the body over backwards.
//   crumple:  anything else; the binding magic lets go, the legs fold out and the rest drops into a heap of bones.
export function deathStyle(enemy,part,hit,projectile){
  if(enemy?.kind!=='skeleton')return null;
  if(hit?.tool==='hammer')return 'shatter';
  if(projectile&&part==='head')return 'headshot';
  return 'crumple';
}
export const BONE_DEATH=Object.freeze({snapAt:16,shatterSpeed:7.5,shatterLift:3.2,shatterSpin:16,headSnap:{bolt:5.2,arrow:3},bodyThrow:{bolt:.95,arrow:.35}});
const seeded=(id,n)=>{let h=Math.imul([...String(id)].reduce((a,c)=>Math.imul(a^c.charCodeAt(0),0x01000193),0x811c9dc5)^Math.imul(n,0x9e3779b1),0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;return (h>>>0)/4294967296;};
// A dead skeleton stays one body: its parts pin at the neck, shoulders and hips and fall as a ragdoll.
// Exact bone pivots (from the struck pose) are the joints; without them, the canonical skeleton's joints.
const JOINTS={head:[0,1.45,0],leftArm:[.2,1.38,0],rightArm:[-.2,1.38,0],leftLeg:[.1,.9,0],rightLeg:[-.1,.9,0]};
function ragdoll(state,enemy,parts,hit,style='crumple'){
  const c=Math.cos(enemy.yaw),t=Math.sin(enemy.yaw),[ex,ey,ez]=enemy.position;
  linkRagdoll(parts,d=>{if(d.posed)return [...d.position];const a=JOINTS[d.part]||[0,1,0];return [ex+a[0]*c+a[2]*t,ey+a[1],ez-a[0]*t+a[2]*c];});
  for(const d of parts)delete d.posed;
  const e=clamp(Number(hit?.energy)||1,.5,2)*(hit?.golden?2.4:1),forward=[Math.sin(enemy.yaw),0,Math.cos(enemy.yaw)];
  const away=unit(hit?.direction)?hit.direction:unit(hit?.normal)?hit.normal.map(n=>-n):forward.map(n=>-n);
  if(style==='shatter'){
    // The hammer's swing carries through: each bone flies from the impact point, mostly the way the head was going.
    const at=vec(hit?.point)?hit.point:partPosition(enemy,'torso'),B=BONE_DEATH;
    parts.forEach((d,i)=>{
      tear(state,d);
      const off=d.position.map((v,k)=>v-at[k]),r=Math.hypot(off[0],off[2]),radial=r>1e-3?[off[0]/r,0,off[2]/r]:[0,0,0];
      const dir=[away[0]*.62+radial[0]*.55,0,away[2]*.62+radial[2]*.55],dl=Math.hypot(dir[0],dir[2])||1,heavy=d.part==='torso'?.6:d.part.endsWith('Leg')?.8:1;
      const speed=B.shatterSpeed*(.7+.6*seeded(enemy.id,i))*heavy*clamp(e,.8,1.6),lift=B.shatterLift*(.6+.8*seeded(enemy.id,i+20))*heavy+(off[1]>0?off[1]*1.5:0);
      d.velocity=[dir[0]/dl*speed,lift,dir[2]/dl*speed].map(v=>clamp(v,-30,30));
      d.angularVelocity=[0,1,2].map(k=>(seeded(enemy.id,40+i*3+k)-.5)*2*B.shatterSpin*(d.part==='torso'?.45:1));
    });
    return;
  }
  // The blow lands where it struck: a headshot snaps the skull back, a leg sweep takes the feet out.
  const struck=parts.find(d=>d.part===hit?.part)||parts.find(d=>d.part==='torso'),torso=parts.find(d=>d.part==='torso');
  if(style==='headshot'&&struck){
    const kind=hit?.shot==='bolt'?'bolt':'arrow',snap=BONE_DEATH.headSnap[kind]*e,throwBack=BONE_DEATH.bodyThrow[kind]*Math.min(e,1.4);
    applyImpulse(state,struck,away.map(n=>n*snap*partMass(struck)),vec(hit?.point)?hit.point:null);
    // The chest goes with it, pushed high up so the body pivots over its heels and lands on its back.
    if(torso&&torso!==struck)applyImpulse(state,torso,away.map((n,k)=>(n+(k===1?.15:0))*throwBack*partMass(torso)),[torso.position[0],torso.position[1]+.35,torso.position[2]]);
    return;
  }
  if(struck&&unit(hit?.normal))applyImpulse(state,struck,hit.normal.map(n=>-n*1.6*e*partMass(struck)),vec(hit.point)?hit.point:null);
  if(style!=='crumple'||!torso)return;
  // Crumple: the hips let go, so the legs buckle out to either side while the ribcage, arms and skull drop onto them.
  const right=[c,0,-t];
  for(const d of parts){
    if(!d.part.endsWith('Leg'))continue;
    tear(state,d);
    const side=d.part==='leftLeg'?1:-1,k=.6+.5*seeded(enemy.id,d.part.length+side);
    d.velocity=d.velocity.map((v,i)=>v+right[i]*side*.9*k+away[i]*.35);
    // Topple outward about the forward axis, with a little kick so the pair never lands mirrored.
    d.angularVelocity=d.angularVelocity.map((w,i)=>w+forward[i]*side*-2.6*k+right[i]*(seeded(enemy.id,9+side)-.5)*2.2);
  }
  // The upper body just drops with them (no extra shove, or the arms would be left flailing above it), slumping a little.
  torso.velocity=torso.velocity.map((v,i)=>v+away[i]*.3);
  const slump=[away[2],0,-away[0]],k=1.8+seeded(enemy.id,3)*1.2; // tips the ribcage over the way the blow pushed it
  torso.angularVelocity=torso.angularVelocity.map((w,i)=>w+slump[i]*k+forward[i]*(seeded(enemy.id,4)-.5)*1.2);
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
  if(friendlyEnemyHit(state,enemy,hit)||enemy.battleRun&&state.inventions?.structures.some(b=>b.type==='ward'&&b.side===enemy.side&&b.hp>0&&b.charge>0&&Math.hypot(b.position[0]-enemy.position[0],b.position[2]-enemy.position[2])<=6))return false;
  if(!state.enemies.includes(enemy)||!PARTS.includes(part)||enemy.missingParts.includes(part))return false;
  const armored=enemy.kind==='golem'&&(enemy.armor??3)>0;
  const owner=state.players.find(p=>p.id===hit?.ownerId);
  if(owner&&tavernSafe(state,owner))return false; // nobody fights from inside a tavern
  amount*=damageScale(owner); // +20% per hero level
  // Limbsplitter (axe talent): a swing that lands on a limb or head takes it clean off (armour still turns it).
  if(!projectile&&!armored&&hit?.tool==='axe'&&part!=='torso'&&enemy.kind!=='stumpling'&&hasTalent(owner,'axe','limbsplitter'))amount=Math.max(amount,enemy.parts[part]);
  if((enemy.kind==='ent'||enemy.kind==='stumpling')&&hit?.tool==='axe')amount*=2; // the axe was made for wood
  if(armored){if(hit?.tool==='pick'){enemy.armor=Math.max(0,(enemy.armor??3)-1);events.push({kind:'armor_break',position:[...(hit.point||enemy.position)],id:enemy.id});}amount*=.45;}
  enemy.hurtTick=state.tick;enemy.parts[part]=Math.max(0,enemy.parts[part]-amount);
  // A cracked skeleton arm or leg gives way before it is worn right down, so bones come off while it still fights.
  // Bolts, arrows and blunt blows crack bone; a clean one-swing cut with the axe stays the Limbsplitter talent's.
  if(enemy.kind==='skeleton'&&part.match(/Arm|Leg/)&&hit?.tool!=='axe'&&enemy.parts[part]<=BONE_DEATH.snapAt)enemy.parts[part]=0;
  const headshot=projectile&&part==='head'&&enemy.kind==='skeleton';
  // Body hits take normal damage: one arrow cannot kill a fresh skeleton, but
  // repeated body shots must not leave it immortal at one HP.
  const creditedDamage=Math.min(enemy.hp,headshot?enemy.hp:amount);
  if(owner?.stats)owner.stats.contribution=Math.min(1e9,owner.stats.contribution+creditedDamage);
  if(owner?.role==='hero'&&owner.hp>0&&itemBonus(owner,'lifesteal')>0)owner.hp=Math.min(heroMaxHp(owner),owner.hp+creditedDamage*itemBonus(owner,'lifesteal')); // Leech in a Jar
  enemy.hp-=headshot?enemy.hp:amount;
  events.push({kind:headshot?'headshot':'hit',position:[...(hit?.point||enemy.position)],id:enemy.id,part,material:enemy.kind==='golem'?'stone':enemy.kind==='ent'||enemy.kind==='stumpling'?'wood':'bone',normal:unit(hit?.normal)?[...hit.normal]:[0,1,0],energy:hit?.tool==='hammer'?1.8:1,damage:creditedDamage,resisted:armored});
  // Melee takes any limb off; an arrow or bolt snaps a skeleton's arm or leg off too (a skull shot is a headshot).
  if(part!=='torso'&&enemy.parts[part]===0&&(!projectile||enemy.kind==='skeleton'&&part!=='head'))detach(state,enemy,part,hit,ctx,events);
  if(part==='head'&&enemy.missingParts.includes('head'))enemy.hp=0;
  if(enemy.hp<=0){if(owner?.stats)owner.stats.kills=Math.min(1e9,owner.stats.kills+1);grantXp(state,owner,killXp(enemy),events,enemy.position);payKillGold(state,owner,enemy,events);noteKill(state,owner,enemy,hit,events);if(owner?.role==='hero'&&!enemy.battleRun)addBloom(state,enemy.kind==='golem'?BLOOM.golem:BLOOM.skeleton,events,enemy.position);if(enemy.meteorBorn)queueMeteorReward(state,enemy,ctx,events);else if(enemy.kind==='ent')dropEntTimber(state,enemy,entContext(state,ctx),events,entSpec(enemy).trunkLogs);else if(enemy.kind==='stumpling')dropStumplingLoot(state,enemy,entContext(state,ctx),events);else if(!enemy.battleRun)dropSkeletonSalvage(state,enemy,ctx,events,owner);const fallen=[];for(const limb of PARTS){const d=detach(state,enemy,limb,hit,ctx,events,true);if(d)fallen.push(d);}
    // Detachment remaps arrows onto physical remains. Wooden creatures have no torso remains,
    // so discard any contacts still attached to the dead actor before saves validate their targets.
    state.embeds=state.embeds.filter(e=>e.targetId!==enemy.id);
    clingSplash(state,enemy,ctx,events);
    const style=deathStyle(enemy,part,hit,projectile);if(enemy.kind==='skeleton')ragdoll(state,enemy,fallen,hit,style);events.push({kind:'death',position:[...enemy.position],id:enemy.id,creature:enemy.kind,part,normal:unit(hit?.normal)?[...hit.normal]:[0,1,0],energy:hit?.tool==='hammer'?1.8:1,...(style?{style}:{}),...(style&&vec(hit?.point)?{point:[...hit.point]}:{}),...(style==='headshot'&&unit(hit?.direction)?{direction:[...hit.direction],shot:hit.shot}:style==='shatter'&&unit(hit?.direction)?{direction:[...hit.direction]}:{})});state.enemies.splice(state.enemies.indexOf(enemy),1);}
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
  const rival=homeBattle(state)&&ctx.damageHero&&state.players.find(h=>h.id===m.targetId&&h.role==='hero');
  if(rival){
    const side=shot.side||state.players.find(p=>p.id===shot.ownerId)?.side||'party';
    if(!['arrow','bolt'].includes(shot.kind)||(rival.side||'party')===side||rival.id===shot.ownerId||Math.hypot(m.point[0]-rival.position[0],m.point[2]-rival.position[2])>1.2||m.point[1]<rival.position[1]-.3||m.point[1]>rival.position[1]+2.2)return fail('invalid_contact');
    if(tavernSafe(state,state.players.find(p=>p.id===shot.ownerId)))return fail('tavern_peace');
    const events=[];state.projectiles.splice(state.projectiles.indexOf(shot),1);ctx.damageHero(state,rival,(shot.kind==='bolt'?40:28)*damageScale(state.players.find(p=>p.id===shot.ownerId)),events);return ok(events);
  }
  const home=findHomeTarget(state,m.targetId),base=home?.target||state.battle?.bases.find(b=>b.id===m.targetId);
  if(base){
    // Home-base hearts float above their forge and spires stand tall, so their envelope reaches higher.
    if(!['arrow','bolt'].includes(shot.kind)||dist(m.point,base.position)>(home?7.5:3.5))return fail('invalid_contact');
    const side=shot.side||state.players.find(p=>p.id===shot.ownerId)?.side,events=[];
    if(!side)return fail('not_joined');
    state.projectiles.splice(state.projectiles.indexOf(shot),1);
    // Keep stonework shrugs off plain bolts and arrows (they only chip it); a golden bolt's magic bites for full.
    const magic=shot.kind==='bolt'&&!!shot.golden,chip=!!home&&!magic,from=events.length;
    damageBattleBase(state,base.id,(shot.kind==='bolt'?SIEGEBIRD.damage*(magic?SIEGEBIRD.goldenMultiplier:1):38)*(chip?KEEP_STONE.plainShot:1),side,events);
    for(const e of events.slice(from))if(e.kind==='home_part_hit'||e.kind==='battle_base_hit'||e.kind==='home_shield_block'){e.at=m.point.map(v=>Math.round(v*100)/100);e.blow=chip?'chip':magic?'magic':'hit';}
    return ok(events);
  }
  const enemy=state.enemies.find(e=>e.id===m.targetId), detached=state.detachedParts.find(e=>e.id===m.targetId),shield=m.surface==='shield';
  if(enemy&&friendlyEnemyHit(state,enemy,shot))return fail('friendly_target');
  // Authored shields extend beyond the anatomical arm envelope. Keep their
  // triangle checks host-only, bounded to the actor, and absent with that arm.
  const validShield=enemy&&enemy.kind==='skeleton'&&!enemy.shieldBroken&&!enemy.missingParts.includes(m.part)&&dist(m.point,partPosition(enemy,'torso'))<1.45;
  if(enemy?!(shield?validShield:validPartHit(enemy,m.part,m.point)):detached?m.part!==detached.part||dist(m.point,detached.position)>1.8: m.targetId!=='world'&&(m.targetId!=='terrain'||Math.abs(m.point[1]-ctx.terrainHeight(state,m.point[0],m.point[2]))>.3))return fail('invalid_contact');
  // Only host-produced triangle contacts reach this path. The surface marker
  // must still belong to a skeleton's surviving shield-bearing arm.
  if(shield&&((enemy||detached)?.kind!=='skeleton'||!['leftArm','rightArm'].includes(m.part)))return fail('invalid_contact');
  if(shot.flare){state.projectiles.splice(state.projectiles.indexOf(shot),1);return ok(ctx.flareBurst(state,m.point,shot.ownerId));}
  // A golden bolt is radiant: it bursts through shields, bodies and remains (each once) and only a
  // world surface stops it. Every other projectile ends at its first contact.
  // Skewer (Siegebird talent): an ordinary bolt passes through up to SKEWER.max bodies, without the radiant burst.
  const pierceKey=m.targetId+(shield?'#shield':''),piercing=(shot.golden||shot.skewer)&&(enemy||detached)&&(shot.pierced?.length||0)<(shot.golden?GOLDEN_PIERCE.max:SKEWER.max);
  if((shot.golden||shot.skewer)&&shot.pierced?.includes(pierceKey))return fail('already_pierced');
  if(piercing){(shot.pierced??=[]).push(pierceKey);if(vec(shot.velocity,100))shot.velocity=shot.velocity.map(v=>v*GOLDEN_PIERCE.keep);}
  else state.projectiles.splice(state.projectiles.indexOf(shot),1);
  if(['flame','fuel'].includes(shot.kind))return ok(ctx.fireContact(state,shot,m));
  const vel=vec(shot.velocity,100)?shot.velocity:[0,0,-1],dir=(n=>n>1e-6?vel.map(v=>v/n):[0,0,-1])(Math.hypot(...vel));
  if(detached)applyImpulse(state,detached,dir.map(v=>v*(shot.golden?5:shot.kind==='bolt'?1.6:.9)),m.point);
  if(piercing){
    const events=[{kind:'pierce',id:shot.id,ownerId:shot.ownerId,position:[...m.point],direction:dir,targetId:m.targetId,normal:[...m.normal],...(shot.golden?{golden:true}:{skewer:true}),...(shield?{blocked:true}:{})}];
    if(shield)breakShield(state,enemy,m,events,!!shot.golden);
    else if(enemy)strikeEnemy(state,shot,enemy,m,ctx,events);
    if(shot.golden)radiantBurst(state,shot,m,ctx,events);
    return ok(events);
  }
  if(shield){
    const left=(enemy.shield??skeletonShield(enemy.id).hp)-(shot.kind==='bolt'?2:1);
    if(left<=0){const events=[];breakShield(state,enemy,m,events,false,shot);return ok(events);}
    enemy.shield=left;
  }
  if(state.embeds.length>=COMBAT_LIMITS.embeds)state.embeds.shift();
  state.embeds.push({id:shot.id,kind:shot.kind,...(shot.golden?{golden:true}:{}),targetId:m.targetId,part:m.part||'torso',localPoint:[...m.localPoint],localQuaternion:[...m.localQuaternion],point:[...m.point],normal:[...m.normal],...(m.localNormal?{localNormal:[...m.localNormal]}:{}),...(shield?{surface:'shield'}:{}),penetration:shield?.035:embedDepth(shot.kind,m.part,m.impactThickness,m.targetId),...(m.boneName?{boneName:m.boneName}:{})});
  const events=[{kind:'embed',id:shot.id,ownerId:shot.ownerId,position:[...m.point],targetId:m.targetId,impact:shield||!enemy,normal:[...m.normal],material:shield?'wood':detached?.kind==='skeleton'?'bone':'stone',...(shield?{blocked:true}: {}),...(shot.golden?{golden:true}:{})}];
  if(shot.kind==='arrow'&&Math.hypot(...shot.curve)>.000001)events.push(...ctx.fireContact(state,shot,m));
  if(enemy&&!shield)strikeEnemy(state,shot,enemy,m,ctx,events);
  return ok(events);
}
export const GOLDEN_PIERCE=Object.freeze({max:6,keep:.85,radius:1.8,damage:24,push:2.2});
export const SKEWER=Object.freeze({max:3});
// Ember Volley: minimum draw for the extra arrows and their yaw either side of the aim (radians, about 7 degrees).
export const VOLLEY=Object.freeze({draw:.95,spread:.12});
function strikeEnemy(state,shot,enemy,m,ctx,events){
  // Siegebird mastery: every bolt that lands on a foe makes the golden bird a little more likely.
  const owner=shot.kind==='bolt'&&state.players.find(p=>p.id===shot.ownerId);if(owner?.siegebird)owner.siegebird.hits=Math.min(SIEGEBIRD.hitCap,owner.siegebird.hits+1);
  const speed=vec(shot.velocity,100)?Math.hypot(...shot.velocity):0,direction=speed>1e-6?shot.velocity.map(v=>v/speed):undefined;
  hitEnemyPart(state,enemy,m.part,shot.kind==='bolt'?SIEGEBIRD.damage*(shot.golden?SIEGEBIRD.goldenMultiplier:1):38,{...m,ownerId:shot.ownerId,side:shot.side,shot:shot.kind,...(direction?{direction}:{}),...(shot.golden?{golden:true}:{})},ctx,events,{projectile:true});
  // Phoenix headshot: the bird tears the skull off the ragdoll it just dropped and tries to fly away with it (phoenix-carry.js).
  const skull=shot.kind==='arrow'&&Math.hypot(...shot.curve)>.000001&&enemy.kind==='skeleton'&&m.part==='head'&&!state.enemies.includes(enemy)&&state.detachedParts.find(d=>d.sourceId===enemy.id&&d.part==='head'&&!d.heldBy);
  if(skull&&state.detachedParts.filter(d=>d.carry).length<PHOENIX_CARRY.maxActive){
    tear(state,skull,events);
    skull.carry=startCarry({position:skull.position,velocity:shot.velocity,from:state.players.find(p=>p.id===shot.ownerId)?.position,by:shot.ownerId,arrow:shot.id,tick:state.tick});
    skull.velocity=[0,0,0];skull.angularVelocity=[0,0,0];skull.throwerId=null;
    events.push({kind:'phoenix_carry',id:skull.id,arrowId:shot.id,by:shot.ownerId,position:[...skull.position]});
  }
}
// The shield splinters: its arrows fall with the shards and the skeleton reels back, shield arm empty.
function breakShield(state,enemy,m,events,golden,shot){
  enemy.shieldBroken=true;delete enemy.shield;enemy.flinchTick=state.tick;
  state.embeds=state.embeds.filter(e=>!(e.targetId===enemy.id&&e.surface==='shield'));
  events.push({kind:'shield_break',id:enemy.id,position:[...m.point],normal:[...m.normal],material:skeletonShield(enemy.id).material,...(golden?{golden:true}:{}),...(shot?{projectileId:shot.id}:{})});
}
// Radiant burst where a golden bolt passes through: a short-range blast of light that scorches nearby
// foes and throws loose bones.
function radiantBurst(state,shot,m,ctx,events){
  const R=GOLDEN_PIERCE.radius;
  for(const e of [...state.enemies])if(e.id!==m.targetId&&e.kind!=='ent'&&dist(partPosition(e,'torso'),m.point)<R)hitEnemyPart(state,e,'torso',GOLDEN_PIERCE.damage,{point:[...m.point],normal:[...m.normal],ownerId:shot.ownerId,side:shot.side,energy:1.2},ctx,events);
  for(const d of state.detachedParts){const off=d.position.map((v,i)=>v-m.point[i]),r=Math.hypot(...off);if(r>R*1.4||d.heldBy)continue;const k=GOLDEN_PIERCE.push*(1-r/(R*1.4))*partMass(d),n=r>1e-4?off.map(v=>v/r):[0,1,0];applyImpulse(state,d,[n[0]*k,(Math.abs(n[1])*.5+.22)*k,n[2]*k],d.position);}
  events.push({kind:'radiant_burst',id:shot.id,position:[...m.point],radius:R});
}
export function releaseHeld(state,p,direction,throwing=false){const held=state.detachedParts.find(d=>d.heldBy===p.id);if(!held)return false;held.heldBy=null;held.velocity=throwing?direction.map((v,i)=>v*12+(i===1?2:0)):[0,0,0];held.angularVelocity=throwing?[5,2,3]:[0,0,0];held.throwerId=throwing?p.id:null;if(throwing)held.throwerSide=p.side||'party';else delete held.throwerSide;held.hitIds=[];if(p.tool==='limb')p.tool='axe';return true;}
export function combatAction(state,p,m,ctx){
  if(m.action==='flame'||m.action==='pour'){
    const flame=m.action==='flame';
    if(p.tool!==(flame?'wyrmspout':'flask')||!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction)||(m.aimed!==undefined&&typeof m.aimed!=='boolean'))return fail('invalid_action');
    if(flame&&(p.overheatUntil||0)>state.tick)return fail('overheated');
    if(state.tick-p.attackTick<(flame?WYRMSPOUT.acceptTicks:60))return fail('cooldown');
    if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.attackTick=state.tick;
    // Wyrmspout: one glob of sticky liquid fire from the tank (shared/wyrmspout.js).
    const spray=flame?sprayTuning(p):null;if(flame)spendGlob(state,p,spray.cost);
    // Emberdew: a hip toss lobs an unlit puddle; an aimed throw (right click held) lights the rag and hurls it far.
    const aimed=!flame&&m.aimed===true,throwing=aimed?EMBERDEW.hurl:EMBERDEW.toss;
    const id=ctx.nextId(state,'q'),speed=flame?spray.speed:throwing.speed,motion=flame?[0,0,0]:ctx.playerVelocity?.(p);
    const inherited=vec(motion,100)?motion:[0,0,0];
    state.projectiles.push({id,ownerId:p.id,side:p.side||'party',kind:flame?'flame':'fuel',lit:!flame&&(aimed||!!p.flaskLit),position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map((n,i)=>n*speed+(!flame&&i===1?throwing.loft:0)+inherited[i]),curve:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});
    return ok([{kind:flame?'flame_emit':'fuel_throw',weapon:p.tool,position:[...m.origin],id,...(flame?{by:p.id}:{by:p.id,...(aimed?{aimed:true}:{})})}]);
  }
  // Gout (Wyrmspout Q): one big lobbed ball of sticky fire that bursts into a wide burning splash. Costs part of the tank.
  if(m.action==='special'&&p.tool==='wyrmspout'){
    const G=WYRMSPOUT.gout;
    if((p.overheatUntil||0)>state.tick)return fail('overheated');
    if(state.tick-(p.specialTick??-1000)<specialCooldown('wyrmspout',p))return fail('cooldown');
    if(!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.specialTick=state.tick;p.flameTick=state.tick;p.heat=Math.min(1,(p.heat||0)+G.cost);if(p.heat>=.999){p.heat=1;p.overheatUntil=state.tick+WYRMSPOUT.refillTicks;}
    const id=ctx.nextId(state,'q');
    state.projectiles.push({id,ownerId:p.id,side:p.side||'party',kind:'flame',gout:true,position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map((n,i)=>n*G.speed+(i===1?G.loft:0)),curve:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});
    return ok([{kind:'gout_launch',weapon:'wyrmspout',by:p.id,position:[...m.origin],id}]);
  }
  // Emberdew's rag is lit while its thrower aims (right click held); everyone sees the flame on the held bottle.
  if(m.action==='wick'&&p.tool==='flask'){if(typeof m.lit!=='boolean')return fail('invalid_action');p.flaskLit=m.lit;return ok([]);}
  // Cinder Cluster (Emberdew Q): a big lit jug lobbed high; stepCombat pops it at the top of its arc into a ring of lit bottles.
  if(m.action==='special'&&p.tool==='flask'){
    if(state.tick-(p.specialTick??-1000)<specialCooldown('flask',p))return fail('cooldown');
    if(!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.specialTick=state.tick;
    const id=ctx.nextId(state,'q'),motion=ctx.playerVelocity?.(p),inherited=vec(motion,100)?motion:[0,0,0];
    state.projectiles.push({id,ownerId:p.id,side:p.side||'party',kind:'fuel',lit:true,cluster:true,position:[...m.origin],previousPosition:[...m.origin],velocity:cinderLaunch(m.direction,inherited),curve:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});
    return ok([{kind:'cinder_throw',weapon:'flask',by:p.id,position:[...m.origin],id}]);
  }
  // Phoenix Flare (Emberwing Q): a flare arrow climbs along the aim, bursts overhead, lights the area and rains
  // embers that set what is under it alight (fire.js flareBurst). Contact before the burst bursts it there.
  if(m.action==='special'&&p.tool==='bow'){
    if(state.tick-(p.specialTick??-1000)<specialCooldown('bow',p))return fail('cooldown');
    if(!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.specialTick=state.tick;const id=ctx.nextId(state,'q'),speed=FLARE.speed;
    state.projectiles.push({id,ownerId:p.id,side:p.side||'party',kind:'arrow',flare:true,position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map((n,i)=>n*speed+(i===1?FLARE.loft:0)),curve:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});
    return ok([{kind:'shoot',weapon:'bow',flare:true,position:[...m.origin],id}]);
  }
  if(m.action==='fire'){
    if(!['bow','crossbow'].includes(p.tool)||!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    const curve=m.curve===undefined?[0,0,0]:m.curve;if(!vec(curve,1.31)||Math.hypot(...curve)>1.31||m.draw!==undefined&&(!Number.isFinite(m.draw)||m.draw<0||m.draw>1))return fail('invalid_action');
    if(state.tick-p.attackTick<(p.tool==='bow'?33:p.siegebird?.quick?SIEGEBIRD.quickAcceptTicks:SIEGEBIRD.acceptTicks))return fail('cooldown');if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.attackTick=state.tick;const id=ctx.nextId(state,'q'),speed=p.tool==='bow'?18+18*Math.max(.2,m.draw??.67):42;
    // The bolt on the rail was decided when the previous bird was sent; roll the next bird now.
    let golden=false,reload;
    if(p.tool==='crossbow'){const sb=p.siegebird??={n:0,golden:false,hits:0};golden=sb.golden;sb.n=Math.min(1e9,sb.n+1);sb.golden=siegebirdRoll(p.id,sb.n,state.tick)<siegebirdGoldenChance(sb.hits,hasTalent(p,'crossbow','flock'));sb.quick=sb.wind===1;sb.wind=0;reload={n:sb.n,golden:sb.golden,...(sb.quick?{quick:true}:{})};}
    const skewer=p.tool==='crossbow'&&!golden&&hasTalent(p,'crossbow','skewer');
    state.projectiles.push({id,ownerId:p.id,side:p.side||'party',kind:p.tool==='bow'?'arrow':'bolt',position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map(n=>n*speed),curve:p.tool==='bow'?[...curve]:[0,0,0],bornTick:state.tick,trail:[[...m.origin]],...(golden?{golden:true}:{}),...(skewer?{skewer:true}:{})});
    // Ember Volley (Emberwing talent): a full draw looses two more arrows fanned either side of the aim.
    const volley=[];
    if(p.tool==='bow'&&(m.draw??.67)>=VOLLEY.draw&&hasTalent(p,'bow','volley'))for(const sign of [-1,1]){
      if(state.projectiles.length>=COMBAT_LIMITS.projectiles)break;
      const a=sign*VOLLEY.spread,c=Math.cos(a),sn=Math.sin(a),[dx,dy,dz]=m.direction,extra=ctx.nextId(state,'q');
      state.projectiles.push({id:extra,ownerId:p.id,side:p.side||'party',kind:'arrow',position:[...m.origin],previousPosition:[...m.origin],velocity:[dx*c+dz*sn,dy,-dx*sn+dz*c].map(n=>n*speed),curve:[...curve],bornTick:state.tick,trail:[[...m.origin]]});
      volley.push(extra);
    }
    return ok([{kind:'shoot',weapon:p.tool,phoenix:p.tool==='bow'&&Math.hypot(...curve)>.000001,position:[...m.origin],id,...(golden?{golden:true}:{}),...(skewer?{skewer:true}:{}),...(volley.length?{volley}:{}),...(reload?{reload}:{})}]);
  }
  // Perfect wind press (see SIEGEBIRD). Never fails visibly: a late, early or repeated press just changes nothing.
  if(m.action==='wind'){
    if(p.tool!=='crossbow'||m.hand!==undefined&&typeof m.hand!=='boolean')return fail('invalid_action');
    const sb=p.siegebird,elapsed=state.tick-p.attackTick;
    if(sb&&!sb.wind&&elapsed<siegebirdReloadTicks(sb.quick)){sb.quick=!!sb.quick;sb.wind=siegebirdPerfect(elapsed,{quick:sb.quick,hand:m.hand===true})?1:-1;}
    return ok([]);
  }
  if(m.action==='projectileHit')return fail('host_required');
  if(m.action==='grab'){const d=state.detachedParts.find(q=>q.id===m.id);if(!d||d.heldBy||d.carry||state.detachedParts.some(q=>q.heldBy===p.id)||dist(d.position,p.position.map((n,i)=>n+(i===1?1:0)))>2.8)return fail('out_of_reach');d.heldBy=p.id;d.velocity=[0,0,0];d.angularVelocity=[0,0,0];heldPose(d,p);p.tool='limb';return ok([{kind:'grab',id:d.id,position:[...d.position]}]);}
  if(m.action==='release'){if(m.throw!==undefined&&typeof m.throw!=='boolean')return fail('invalid_action');const dir=m.direction??[-Math.sin(p.yaw),.1,-Math.cos(p.yaw)];if(!vec(dir,1.01))return fail('invalid_action');const n=Math.hypot(...dir);if(n<.9||n>1.1)return fail('invalid_action');return releaseHeld(state,p,dir.map(v=>v/n),m.throw===true)?ok([]):fail('nothing_held');}
  if(m.action==='special'&&['axe','pick'].includes(p.tool))return terrainSpecial(state,p,ctx,hitEnemyPart,m);
  if(m.action==='special'){
    if(p.tool!=='hammer')return fail('invalid_action');
    if(state.tick-(p.specialTick??-1000)<specialCooldown('hammer'))return fail('cooldown');
    const at=[p.position[0]-Math.sin(p.yaw)*1.5,p.position[1],p.position[2]-Math.cos(p.yaw)*1.5],events=[];
    p.specialTick=state.tick;
    // Each foe is struck by the shockwave from the slam's centre outward, so shattered bones fly away from it.
    for(const e of [...state.enemies])if(dist(e.position,at)<5){
      const dx=e.position[0]-at[0],dz=e.position[2]-at[2],r=Math.hypot(dx,dz),direction=r>.05?[dx/r,0,dz/r]:[-Math.sin(p.yaw),0,-Math.cos(p.yaw)],torso=partPosition(e,'torso');
      hitEnemyPart(state,e,'torso',65,{tool:p.tool,point:[torso[0]-direction[0]*.2,torso[1],torso[2]-direction[2]*.2],direction,ownerId:p.id},ctx,events);
    }
    events.push({kind:'hammer_slam',id:p.id,position:at});return ok(events);
  }
  return null;
}
export function stepCombat(state,ctx,events){
  const dt=1/60;
  for(const p of [...state.projectiles]){
    p.previousPosition=[...p.position];const age=(state.tick-p.bornTick-1)*dt,len=Math.hypot(...p.curve),fraction=t=>1-Math.pow(1-clamp(t/.85,0,1),3),angle=len*(fraction(age+dt)-fraction(age));
    let v=p.velocity;if(len>.000001){const a=p.curve.map(n=>n/len),c=Math.cos(angle),s=Math.sin(angle),dot=a.reduce((n,q,i)=>n+q*v[i],0),cross=[a[1]*v[2]-a[2]*v[1],a[2]*v[0]-a[0]*v[2],a[0]*v[1]-a[1]*v[0]];v=v.map((n,i)=>n*c+cross[i]*s+a[i]*dot*(1-c));}
    const nv=v.map((n,i)=>n*Math.exp(-.045*dt)-(i===1?(p.kind==='arrow'?5.8:p.kind==='flame'?WYRMSPOUT.gravity:p.kind==='fuel'?15:3)*dt:0));p.position=p.position.map((n,i)=>n+(p.velocity[i]+nv[i])*.5*dt);p.velocity=nv;p.trail.push([...p.position]);if(p.trail.length>16)p.trail.shift();
    // Cinder Cluster: at the top of its arc the jug pops and rains lit bottles in a ring (each an ordinary lit throw).
    if(p.cluster&&p.velocity[1]<=0){
      state.projectiles.splice(state.projectiles.indexOf(p),1);const bottles=[];
      for(const v of cinderVelocities(p.velocity)){if(state.projectiles.length>=COMBAT_LIMITS.projectiles)break;const id=ctx.nextId(state,'q');bottles.push(id);
        state.projectiles.push({id,ownerId:p.ownerId,side:p.side,kind:'fuel',lit:true,position:[...p.position],previousPosition:[...p.position],velocity:v,curve:[0,0,0],bornTick:state.tick,trail:[[...p.position]]});}
      events.push({kind:'cinder_pop',id:p.id,by:p.ownerId,position:[...p.position],bottles});
      continue;}
    if(p.flare&&state.tick-p.bornTick>=FLARE.fuse){state.projectiles.splice(state.projectiles.indexOf(p),1);events.push(...ctx.flareBurst(state,p.position,p.ownerId));continue;}
    // Apple on a stick (shared/fruit.js): an arrow or bolt through a hanging apple takes it off the tree and stops.
    const fruit=ctx.fruitStrike?.(state,p.previousPosition,p.position,p);if(fruit){state.projectiles.splice(state.projectiles.indexOf(p),1);events.push(fruit);continue;}
    if(state.tick-p.bornTick>(p.kind==='flame'?(p.gout?WYRMSPOUT.gout.lifeTicks:sprayTuning(state.players.find(q=>q.id===p.ownerId)).lifeTicks):p.kind==='fuel'?180:480)||beyondWorld(p.position[0],p.position[2])||p.position[1]<ctx.terrainHeight(state,p.position[0],p.position[2])-.5)state.projectiles.splice(state.projectiles.indexOf(p),1);
  }
  const before=new Map();
  for(const d of [...state.detachedParts]){
    if(d.carry){stepCarry(state,d,ctx,events);continue;}
    const holder=state.players.find(p=>p.id===d.heldBy&&p.role==='hero');if(d.heldBy&&!holder)d.heldBy=null;
    if(holder)heldPose(d,holder);else if(d.throwerId)before.set(d,[...d.position]);
  }
  pushRemains(state);
  stepRemains(state,ctx);
  for(const [d,old] of before){
    const speed=Math.hypot(...d.velocity);if(speed>4)for(const enemy of [...state.enemies])if(!d.hitIds.includes(enemy.id)&&segmentDistance(partPosition(enemy,'torso'),old,d.position)<.9){d.hitIds.push(enemy.id);hitEnemyPart(state,enemy,'torso',Math.min(60,speed*4),{ownerId:d.throwerId,side:d.throwerSide},ctx,events);d.velocity=d.velocity.map(n=>n*.55);}
  }
}
// Heroes and walking enemies shove the remains they wade through (a light kick, enough to scatter bones).
function pushRemains(state){
  const walkers=state.players.filter(p=>p.role==='hero');
  for(const d of state.detachedParts){
    if(d.heldBy)continue;
    for(const w of walkers){
      const dx=d.position[0]-w.position[0],dz=d.position[2]-w.position[2],r=Math.hypot(dx,dz),reach=w.kind==='golem'?.8:.5;
      if(r>reach||d.position[1]<w.position[1]-.4||d.position[1]>w.position[1]+1.9)continue;
      const moving=Math.hypot(w.velocity?.[0]||0,w.velocity?.[2]||0);if(moving<.3)continue;
      const k=(reach-r)/reach*Math.min(2.5,moving)*.6,nx=r>1e-4?dx/r:1,nz=r>1e-4?dz/r:0;
      applyImpulse(state,d,[nx*k*partMass(d),.25*k*partMass(d),nz*k*partMass(d)],[d.position[0]-nx*.1,d.position[1]+.05,d.position[2]-nz*.1]);
    }
  }
}
// The carried skull follows the shared flight path and always holds its current flight velocity, so if the carry
// is ever dropped (saved and restored, or the phoenix lets go) it falls naturally from where it was.
function stepCarry(state,d,ctx,events){
  const pose=carryPose(d.carry,state.tick,(x,z)=>ctx.terrainHeight(state,x,z),state.players.find(p=>p.id===d.carry.by)?.position||null);
  d.position=pose.position;d.quaternion=pose.quaternion;d.velocity=pose.velocity.map(n=>clamp(n,-40,40));d.angularVelocity=[0,0,0];d.bornTick=state.tick;
  if(!pose.done)return;
  // The proud drop at the archer's feet: a little hop and a tumble; the phoenix (the arrow stuck in it) flies off.
  d.velocity=[0,1.4,0];d.angularVelocity=[5.5,1.5,3.5];wake(d);
  const arrow=state.embeds.findIndex(e=>e.id===d.carry.arrow&&e.targetId===d.id);if(arrow>=0)state.embeds.splice(arrow,1);
  events.push({kind:'phoenix_drop',id:d.id,arrowId:d.carry.arrow,by:d.carry.by,position:[...d.position],material:'bone'});
  delete d.carry;
}
export function validateCombat(saved,ids){
  const unique=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&!ids.has(id)&&(ids.add(id),true);
  const tick=n=>Number.isSafeInteger(n)&&n>=0&&n<=saved.tick;
  for(const [key,cap]of Object.entries(COMBAT_LIMITS))if(saved[key]!==undefined&&(!Array.isArray(saved[key])||saved[key].length>cap))throw Error('Invalid combat limit');
  for(const p of saved.projectiles||[])if(!p||!unique(p.id)||typeof p.ownerId!=='string'||(p.side!==undefined&&!['party','rivals'].includes(p.side))||!['arrow','bolt','flame','fuel'].includes(p.kind)||(p.lit!==undefined&&typeof p.lit!=='boolean')||(p.golden!==undefined&&(p.golden!==true||p.kind!=='bolt'))||(p.skewer!==undefined&&(p.skewer!==true||p.kind!=='bolt'||p.golden))||(p.flare!==undefined&&(p.flare!==true||p.kind!=='arrow'))||(p.gout!==undefined&&(p.gout!==true||p.kind!=='flame'))||(p.cluster!==undefined&&(p.cluster!==true||p.kind!=='fuel'))||(p.pierced!==undefined&&(!(p.golden||p.skewer)||!Array.isArray(p.pierced)||p.pierced.length>(p.golden?GOLDEN_PIERCE.max:SKEWER.max)||!p.pierced.every(k=>typeof k==='string'&&k.length<=72)))||!vec(p.position)||!vec(p.previousPosition)||!vec(p.velocity,p.kind==='fuel'?120:80)||!vec(p.curve,1.31)||Math.hypot(...p.curve)>1.31||!tick(p.bornTick)||!Array.isArray(p.trail)||p.trail.length<1||p.trail.length>16||!p.trail.every(q=>vec(q)))throw Error('Invalid projectile');
  for(const e of [...saved.enemies,...(saved.detachedParts||[])])if(e.burnUntil!==undefined&&(!Number.isSafeInteger(e.burnUntil)||e.burnUntil<0||e.burnUntil>saved.tick+240||!PARTS.includes(e.burnPart))||e.burnPart!==undefined&&!PARTS.includes(e.burnPart))throw Error('Invalid burning part');
  for(const d of saved.detachedParts||[])if(d.scorch!==undefined&&(!Number.isFinite(d.scorch)||d.scorch<0||d.scorch>1))throw Error('Invalid detached scorch');
  for(const d of saved.detachedParts||[])if(d.rest!==undefined&&(!Number.isInteger(d.rest)||d.rest<0||d.rest>64)||d.joint!==undefined&&(!d.joint||typeof d.joint!=='object'||Object.keys(d.joint).length!==3||!vec(d.joint.a,4)||!vec(d.joint.b,4)||d.joint.to===d.id||(saved.detachedParts.find(o=>o.id===d.joint.to)?.sourceId)!==d.sourceId))throw Error('Invalid remains joint');
  const held=new Set();
  for(const d of saved.detachedParts||[])if(!d||!unique(d.id)||typeof d.sourceId!=='string'||!['skeleton','golem'].includes(d.kind)||!PARTS.includes(d.part)||!vec(d.position)||!quat(d.quaternion)||d.localBounds!==undefined&&!bounds(d.localBounds)||!vec(d.velocity,100)||!vec(d.angularVelocity,30)||!tick(d.bornTick)||(d.miningHits!==undefined&&(d.kind!=='golem'||!Number.isInteger(d.miningHits)||d.miningHits<0||d.miningHits>1))||(d.heldBy!==null&&(!saved.players.some(p=>p.id===d.heldBy&&p.role==='hero')||held.has(d.heldBy)))||(d.throwerSide!==undefined&&!['party','rivals'].includes(d.throwerSide))||(d.throwerId!==undefined&&d.throwerId!==null&&typeof d.throwerId!=='string')||(d.hitIds!==undefined&&(!Array.isArray(d.hitIds)||d.hitIds.length>64||!d.hitIds.every(q=>typeof q==='string'&&q.length<=64))))throw Error('Invalid detached part');else if(d.heldBy)held.add(d.heldBy);
  for(const e of saved.embeds||[])if(!e||!unique(e.id)||!['arrow','bolt'].includes(e.kind)||(e.golden!==undefined&&(e.golden!==true||e.kind!=='bolt'))||!PARTS.includes(e.part)||!validContact(e)||(e.surface==='shield'&&(!['leftArm','rightArm'].includes(e.part)||(saved.enemies.find(q=>q.id===e.targetId)||saved.detachedParts?.find(q=>q.id===e.targetId))?.kind!=='skeleton'))||!(e.targetId==='world'||e.targetId==='terrain'||saved.enemies.some(q=>q.id===e.targetId)||saved.detachedParts?.some(q=>q.id===e.targetId)))throw Error('Invalid embed');
  for(const e of saved.enemies)if(e.kind!==undefined&&!['skeleton','golem','ent','stumpling'].includes(e.kind)||e.armor!==undefined&&(!Number.isInteger(e.armor)||e.armor<0||e.armor>3)||e.parts!==undefined&&(!e.parts||!PARTS.every(p=>Number.isFinite(e.parts[p])&&e.parts[p]>=0&&e.parts[p]<=enemyPartMax(e,p)))||e.missingParts!==undefined&&(!Array.isArray(e.missingParts)||e.missingParts.length>6||new Set(e.missingParts).size!==e.missingParts.length||!e.missingParts.every(p=>PARTS.includes(p)&&e.parts?.[p]===0))||e.shield!==undefined&&(e.kind!=='skeleton'||!Number.isInteger(e.shield)||e.shield<1||e.shield>skeletonShield(e.id).hp||e.shieldBroken)||e.shieldBroken!==undefined&&(e.shieldBroken!==true||e.kind!=='skeleton')||e.flinchTick!==undefined&&(!Number.isSafeInteger(e.flinchTick)||e.flinchTick<0||e.flinchTick>saved.tick)||e.scorch!==undefined&&(!e.scorch||typeof e.scorch!=='object'||Object.keys(e.scorch).length!==PARTS.length||!PARTS.every(p=>Number.isFinite(e.scorch[p])&&e.scorch[p]>=0&&e.scorch[p]<=1)))throw Error('Invalid enemy anatomy');
}

// Only known fields survive a user-imported checkpoint. Validation above checks
// numeric bounds; this prevents unknown nested payloads inflating every snapshot.
export function restoreCombat(saved){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
  return {
    projectiles:(saved.projectiles||[]).map(p=>pick(p,['id','ownerId','side','kind','position','previousPosition','velocity','curve','bornTick','trail','lit','golden','skewer','pierced','flare','gout','cluster'])),
    embeds:(saved.embeds||[]).map(e=>pick(e,['id','kind','targetId','part','localPoint','localQuaternion','point','normal','localNormal','penetration','boneName','surface','golden'])),
    detachedParts:(saved.detachedParts||[]).map(d=>({...pick(d,['id','sourceId','kind','part','position','quaternion','velocity','angularVelocity','heldBy','bornTick','throwerId','throwerSide','hitIds','miningHits','scorch','burnUntil','burnPart','rest']),...(d.joint?{joint:{to:d.joint.to,a:[...d.joint.a],b:[...d.joint.b]}}:{}),...(d.localBounds?{localBounds:{min:[...d.localBounds.min],max:[...d.localBounds.max]}}:{})})),
  };
}
