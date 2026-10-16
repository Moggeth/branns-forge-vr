import {BATTLE,battleBot,battleObjectives,battleWaypoint} from './battle-mode.js';
// Fixed-tick movement and committed melee. No clocks, rendering or random streams.
// Strike remains tick 18: the existing authored animations depend on that contract.
import {PICK_WALL} from './terrain.js';
import {entSpec,entWaking,entRooting} from './ents.js';
import {STUMPLING,stepStumplingMotion} from './stumplings.js';
import {clampToWorld} from './keep-sites.js';
import {skeletonKindIndex} from './skeleton-kinds.js';
import {CRITTER,isCritter,stepCritter} from './critters.js';
export const ENEMY_STRIKE_TICK=18;
// A skeleton whose shield splinters reels for this long (no steering, no new swing, a swing in progress misses).
export const FLINCH_TICKS=45;
// A summoned skeleton crawls out of the ground before it can walk or swing (matches the client crawl).
export const EMERGE_TICKS=190;
const flat=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
// Pace personality per warband archetype (shared/skeleton-kinds.js order): Thornhood scurry, Old Bones dawdle.
const SKELETON_PACE=[1,.96,1.08,.88,1.04,1];
const AVOID_AHEAD=1.7,TURN_RATE=.15;
const radius=e=>isCritter(e.kind)?CRITTER[e.kind].radius:e.kind==='ent'?entSpec(e).radius:e.kind==='stumpling'?STUMPLING.radius:e.kind==='golem'?.5:.32;

// Home-base Stormspires (b.home) belong to the base, so roaming foes never march across the map for them.
export function stepEnemies(state,{ground,resolve,damageHero,damageStructure,damageEnemy,damageBase,events}){
 const heroes=state.players.filter(p=>p.role==='hero'),defenders=(state.inventions?.defenders||[]).filter(d=>d.hp>0),buildings=(state.inventions?.structures||[]).filter(b=>b.type!=='forge'&&b.type!=='stormspire'&&!b.home&&b.hp>0),targets=[...heroes,...defenders,...buildings],grid=new Map(),cell=2;
 const battleBots=state.enemies.filter(battleBot),baseTargets=battleObjectives(state),pendingHits=[];
 const originals=state.enemies.map(e=>({id:e.id,position:[...e.position],radius:radius(e),yaw:e.yaw,side:e.side}));
 for(const e of originals){const k=`${Math.floor(e.position[0]/cell)},${Math.floor(e.position[2]/cell)}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
 const blocked=(a,b)=>{const n=Math.ceil(flat(a,b)/.18);for(let i=1;i<n;i++){const t=i/n,p=a.map((v,k)=>v+(b[k]-v)*t);p[1]+=1.05;const q=[...p];resolve(q,0,.04);if(flat(p,q)>.003||ground(p[0],p[2])>p[1])return true;}return false;};
 for(const e of [...state.enemies]){
  if(!state.enemies.includes(e)||e.hp<=0)continue;
  if(e.meteorBorn&&state.tick-e.unfurlTick<90)continue;
  if(e.kind==='skeleton'&&state.tick-(e.emergeTick??-1e9)<EMERGE_TICKS)continue;
  // An ent tearing free of the ground, or sinking its roots for good, neither walks nor strikes.
  if(e.kind==='ent'&&(entWaking(e,state.tick)||entRooting(e,state.tick)))continue;
  // Root critters never fight: they wander, flee and burrow (shared/stumplings.js).
  if(e.kind==='stumpling'){stepStumplingMotion(state,e,{heroes,ground,resolve});continue;}
  // Tossed by a crystal wall front: a fixed parabola above the (rising) ground, no steering or strikes until it lands.
  if(e.launchTick!==undefined){const u=(state.tick-e.launchTick)/PICK_WALL.launchTicks;
   if(u<1){e.position[1]=ground(e.position[0],e.position[2])+4*PICK_WALL.launchPeak*u*(1-u);continue;}delete e.launchTick;}
  // Kettlebellies, Bramblehogs and Kegtoters run their own rules (shared/critters.js); they never join battle lanes.
  if(isCritter(e.kind)){stepCritter(state,e,{heroes,foes:state.enemies,buildings,ground,resolve,damageHero,damageEnemy:(f,n,ev,side,ownerId)=>damageEnemy?.(f,n,ev,side,ownerId),damageStructure:(id,n,ev)=>damageStructure?.(id,n,ev),events});continue;}
  const foes=battleBot(e)?[...targets.filter(h=>(h.side||'party')!==e.side),...battleBots.filter(h=>h.side!==e.side&&h.hp>0)]:targets;
  let target=null,best=Infinity;for(const h of foes){const d=flat(e.position,h.position);if(d<best){best=d;target=h;}}
  let patrol=false;
  if(battleBot(e)&&(!target||best>BATTLE.aggroRange)){target=battleWaypoint(state,e,ground);best=flat(e.position,target.position);patrol=!!target.battleLane;}
  if(e.id.startsWith('camp_')&&best>14){const n=Number(e.id.replace(/\D/g,''))||0,a=state.tick/360+n;target={id:'patrol',position:[(n%2?-37:37)+Math.sin(a)*2,e.position[1],30+Math.cos(a)*2]};best=flat(e.position,target.position);patrol=true;}
  if(!target)continue;
  const ent=e.kind==='ent'?entSpec(e):null,building=buildings.includes(target)||baseTargets.includes(target),reach=building?3.2:ent?ent.reach:1.8;
  let age=state.tick-e.attackTick;
  // Old saves can contain a wind-up without a locked target: let it recover harmlessly.
  const committed=age>=0&&age<34;
  const staggered=state.tick-(e.hurtTick??-1000)<22||state.tick-(e.flinchTick??-1000)<FLINCH_TICKS;
  if(!committed&&!staggered){
   const dx=target.position[0]-e.position[0],dz=target.position[2]-e.position[2];
   const legs=e.missingParts.filter(p=>p.endsWith('Leg')).length;
   const speed=(ent?ent.speed:e.kind==='golem'?1.25:2*SKELETON_PACE[skeletonKindIndex(e.id)])*(legs===2?.2:legs===1?.55:1)*(e.slowUntil>state.tick?.35:1);
   let vx=best>1.5?dx/Math.max(best,.001)*speed:0,vz=best>1.5?dz/Math.max(best,.001)*speed:0;
   const sx=vx/speed||0,sz=vz/speed||0,self=radius(e);let ax=0,az=0;
   const ci=Math.floor(e.position[0]/cell),cj=Math.floor(e.position[2]/cell);
   for(let i=ci-1;i<=ci+1;i++)for(let j=cj-1;j<=cj+1;j++)for(const other of grid.get(`${i},${j}`)||[]){
    if(other.id===e.id||Math.abs(e.position[1]-other.position[1])>1.5)continue;
    let ox=e.position[0]-other.position[0],oz=e.position[2]-other.position[2],d=Math.hypot(ox,oz);const gap=self+other.radius+.18;
    // Look ahead: a body in the path is passed on one side (each pair agrees which), so a crowd flows round itself
    // instead of shoving. Someone already walking the same way is followed, not dodged.
    if(best>1.5&&d>gap&&d<AVOID_AHEAD&&other.id!==target.id&&other.side===e.side){ // dodge friends only: a foe in the way is a fight
     const ahead=-(ox*sx+oz*sz),lat=-(ox*-sz+oz*sx),width=gap+.25;
     if(ahead>0&&Math.abs(lat)<width){
      const same=Math.max(0,-Math.sin(other.yaw)*sx-Math.cos(other.yaw)*sz),side=Math.abs(lat)>.04?-Math.sign(lat):e.id<other.id?1:-1;
      const push=(1-d/AVOID_AHEAD)*(1-Math.abs(lat)/width)*(1-.6*same);ax+=-sz*side*push;az+=sx*side*push;
     }
    }
    if(d>=gap)continue;
    if(d<.0001){const pair=[e.id,other.id].sort().join(':');let h=0;for(const c of pair)h=(Math.imul(h,31)+c.charCodeAt(0))|0;const a=(h>>>0)*.0001,sign=e.id<other.id?1:-1;ox=Math.cos(a)*sign;oz=Math.sin(a)*sign;d=1;}
    const force=1.8*(1-Math.min(flat(e.position,other.position)/gap,1));vx+=ox/d*force;vz+=oz/d*force;
   }
   {const a=Math.hypot(ax,az),k=a>1?speed*.85/a:speed*.85;vx+=ax*k;vz+=az*k;}
   const length=Math.hypot(vx,vz);let heading=Math.atan2(-dx,-dz);
   if(length>.001){
    vx/=length;vz/=length;let chosen=null,score=-Infinity;
    // A small deterministic fan steers around trunks and solid landmarks instead of walking through them.
    for(const angle of [0,.65,-.65,1.25,-1.25]){const c=Math.cos(angle),s=Math.sin(angle),x=vx*c-vz*s,z=vx*s+vz*c;
     const [px,pz]=clampToWorld(e.position[0]+x*.65,e.position[2]+z*.65),probe=[px,e.position[1],pz],before=[...probe];resolve(probe,radius(e));
     if(flat(probe,before)>.025||Math.abs(ground(probe[0],probe[2])-e.position[1])>.8)continue;
     const value=x*vx+z*vz;if(value>score){score=value;chosen=[x,z];}
    }
    if(chosen){
     // Walkers face where they are going and ease off while turning hard, so feet and body agree (no moonwalking).
     const facing=-Math.sin(e.yaw)*chosen[0]-Math.cos(e.yaw)*chosen[1],pace=Math.min(length,speed+1)/60*clamp(.6+.4*facing,.6,1);
     if(best>1.5)heading=Math.atan2(-chosen[0],-chosen[1]);
     [e.position[0],e.position[2]]=clampToWorld(e.position[0]+chosen[0]*pace,e.position[2]+chosen[1]*pace);
    }
   }
   // Turn rate eases into small corrections (no twitching) and caps big ones (a weighty pivot, not a snap).
   const turn=wrap(heading-e.yaw);e.yaw=wrap(e.yaw+clamp(turn*.35,-TURN_RATE,TURN_RATE));
  }
  // Keep all bodies outside the player's camera, including overlapping summons.
  for(const h of heroes){const d=flat(e.position,h.position);if(d<1&&Math.abs(e.position[1]-h.position[1])<2.5){const x=d>.001?(e.position[0]-h.position[0])/d:1,z=d>.001?(e.position[2]-h.position[2])/d:0;[e.position[0],e.position[2]]=clampToWorld(h.position[0]+x,h.position[2]+z);}}
  resolve(e.position,radius(e));e.position[1]=ground(e.position[0],e.position[2]);
  const range=flat(e.position,target.position),facing=(-Math.sin(e.yaw)*(target.position[0]-e.position[0])-Math.cos(e.yaw)*(target.position[2]-e.position[2]))/Math.max(range,.001);
  if(!committed&&!staggered&&!patrol&&range<reach&&facing>.7&&Math.abs(e.position[1]-target.position[1])<1.8&&state.tick-e.attackTick>60&&(building||!blocked(e.position,target.position))){
   e.attackTick=state.tick;e.attackTarget=target.id;age=0;
  }
  if(age===ENEMY_STRIKE_TICK){
   const victim=[...foes,...baseTargets.filter(b=>b.side!==e.side)].find(p=>p.id===e.attackTarget);if(!victim)continue;
   const d=flat(e.position,victim.position),dot=(-Math.sin(e.yaw)*(victim.position[0]-e.position[0])-Math.cos(e.yaw)*(victim.position[2]-e.position[2]))/Math.max(d,.001);
   if(d<((buildings.includes(victim)||baseTargets.includes(victim))?3.5:ent?ent.strike:2)&&dot>.65&&Math.abs(e.position[1]-victim.position[1])<1.8&&(e.hurtTick??-1000)<e.attackTick&&(e.flinchTick??-1000)<e.attackTick&&((buildings.includes(victim)||baseTargets.includes(victim))||!blocked(e.position,victim.position))){
    const arms=e.missingParts.filter(p=>p.endsWith('Arm')).length;const amount=(ent?ent.damage:e.kind==='golem'?22:10)*(arms===2?.25:arms===1?.65:1);if(baseTargets.includes(victim))pendingHits.push(()=>damageBase?.(victim.id,amount,e.side));else if(battleBots.includes(victim))pendingHits.push(()=>damageEnemy?.(victim,amount,events,e.side));else if(buildings.includes(victim))damageStructure?.(victim.id,amount,events,e.side);else if(defenders.includes(victim))victim.hp=Math.max(0,victim.hp-amount);else{const start=events.length;damageHero(state,victim,amount,events,e.position);if(ent)for(let i=start;i<events.length;i++)if(events[i].kind==='hit')events[i].sourceMaterial='wood';}
   }
  }
 }
 // Resolve bot exchanges together so insertion order cannot cancel the opposing wind-up.
 for(const hit of pendingHits)hit();
}
