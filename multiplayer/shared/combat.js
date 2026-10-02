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
const fail=code=>({ok:false,code,events:[]}), ok=events=>({ok:true,events});
export function enemyParts(kind='skeleton') {return Object.fromEntries(PARTS.map(part=>[part,kind==='golem'?120:part==='torso'?100:55]));}
export function createEnemy(id,position,kind='skeleton') {return {id,position,kind,yaw:0,hp:kind==='golem'?320:100,parts:enemyParts(kind),missingParts:[],...(kind==='golem'?{armor:3}:{}),attackTick:-1000};}
const centers={head:[0,1.75,0],torso:[0,1.15,0],leftArm:[.48,1.12,0],rightArm:[-.48,1.12,0],leftLeg:[.2,.48,0],rightLeg:[-.2,.48,0]};
export function partPosition(enemy,part){const canonical=centers[part]||centers.torso,a=enemy.kind==='golem'?[-canonical[0],canonical[1],canonical[2]]:canonical,s=enemy.kind==='golem'?1.45:1,c=Math.cos(enemy.yaw),t=Math.sin(enemy.yaw);return [enemy.position[0]+(a[0]*c+a[2]*t)*s,enemy.position[1]+a[1]*s,enemy.position[2]+(-a[0]*t+a[2]*c)*s];}
export function validPartHit(enemy,part,point) {if(!PARTS.includes(part)||enemy.missingParts?.includes(part)||!vec(point))return false;const s=enemy.kind==='golem'?1.45:1;return dist(point,partPosition(enemy,part)) <= (part==='head'?.4:part==='torso'?.68:.95)*s;}
function removeDetached(state,part){state.detachedParts.splice(state.detachedParts.indexOf(part),1);state.embeds=state.embeds.filter(e=>e.targetId!==part.id);}
function detach(state,enemy,part,hit,ctx,events){
  if(enemy.missingParts.includes(part))return null;
  if(state.detachedParts.length>=COMBAT_LIMITS.detachedParts){const old=state.detachedParts.find(p=>!p.heldBy);if(old)removeDetached(state,old);else return null;}
  enemy.missingParts.push(part);enemy.parts[part]=0;
  const supplied=hit?.partPoses?.[part]||(hit?.part===part?{position:hit.partPosition,quaternion:hit.partQuaternion,localBounds:hit.localBounds}:null);
  const usePose=partPose(supplied)&&dist(supplied.position,partPosition(enemy,part))<2.4;
  const d={id:ctx.nextId(state,'d'),sourceId:enemy.id,kind:enemy.kind,part,position:usePose?[...supplied.position]:partPosition(enemy,part),quaternion:usePose?[...supplied.quaternion]:[0,Math.sin(enemy.yaw/2),0,Math.cos(enemy.yaw/2)],localBounds:usePose&&bounds(supplied.localBounds)?structuredClone(supplied.localBounds):{min:[-.25,part.endsWith('Leg')?-.5:-.25,-.25],max:[.25,part.endsWith('Leg')?.5:.25,.25]},velocity:[0,2,0],angularVelocity:[1.8,.7,1.1],heldBy:null,bornTick:state.tick};
  state.detachedParts.push(d);
  for(const e of state.embeds)if(e.targetId===enemy.id&&e.part===part)e.targetId=d.id;
  events.push({kind:'detach',position:[...d.position],id:d.id,sourceId:enemy.id,part});return d;
}
export function hitEnemyPart(state,enemy,part,amount,hit,ctx,events,{projectile=false}={}) {
  if(!PARTS.includes(part)||enemy.missingParts.includes(part))return false;
  if(enemy.kind==='golem'&&(enemy.armor??3)>0){if(hit?.tool==='pick'){enemy.armor=Math.max(0,(enemy.armor??3)-1);events.push({kind:'armor_break',position:[...(hit.point||enemy.position)],id:enemy.id});}amount*=.45;}
  enemy.hurtTick=state.tick;enemy.parts[part]=Math.max(0,enemy.parts[part]-amount);
  const headshot=projectile&&part==='head'&&enemy.kind!=='golem';
  // Body hits take normal damage: one arrow cannot kill a fresh skeleton, but
  // repeated body shots must not leave it immortal at one HP.
  enemy.hp-=headshot?enemy.hp:amount;
  events.push({kind:headshot?'headshot':'hit',position:[...(hit?.point||enemy.position)],id:enemy.id,part,material:enemy.kind==='golem'?'stone':'bone',normal:unit(hit?.normal)?[...hit.normal]:[0,1,0],energy:hit?.tool==='hammer'?1.8:1});
  if(!projectile&&part!=='torso'&&enemy.parts[part]===0)detach(state,enemy,part,hit,ctx,events);
  if(part==='head'&&enemy.missingParts.includes('head'))enemy.hp=0;
  if(enemy.hp<=0){for(const limb of PARTS)detach(state,enemy,limb,hit,ctx,events);events.push({kind:'death',position:[...enemy.position],id:enemy.id});state.enemies.splice(state.enemies.indexOf(enemy),1);}
  return true;
}
function segmentDistance(p,a,b){const d=b.map((n,i)=>n-a[i]),l=d.reduce((n,v)=>n+v*v,0),t=l?clamp(p.reduce((n,v,i)=>n+(v-a[i])*d[i],0)/l,0,1):0;return dist(p,a.map((n,i)=>n+d[i]*t));}
function validContact(m){return vec(m.point)&&unit(m.normal)&&vec(m.localPoint,m.targetId==='world'||m.targetId==='terrain'?200:8)&&quat(m.localQuaternion)&&(m.boneName===undefined||(typeof m.boneName==='string'&&m.boneName.length<=128))&&(m.partPosition===undefined||vec(m.partPosition))&&(m.partQuaternion===undefined||quat(m.partQuaternion))&&(m.localBounds===undefined||bounds(m.localBounds))&&(m.partPoses===undefined||(m.partPoses&&typeof m.partPoses==='object'&&Object.keys(m.partPoses).length<=6&&Object.entries(m.partPoses).every(([k,v])=>PARTS.includes(k)&&partPose(v))));}
export function projectileContact(state,m,ctx){
  if(!m||typeof m!=='object')return fail('invalid_contact');
  const shot=state.projectiles.find(q=>q.id===m.projectileId);if(!shot||!validContact(m))return fail('invalid_contact');
  // Keep 250 ms of fixed-step sweeps so a 20 Hz snapshot can report actual triangles.
  const paths=shot.trail||[shot.previousPosition,shot.position];if(!paths.slice(1).some((b,i)=>segmentDistance(m.point,paths[i],b)<.22))return fail('invalid_contact');
  const enemy=state.enemies.find(e=>e.id===m.targetId), detached=state.detachedParts.find(e=>e.id===m.targetId);
  if(enemy?!validPartHit(enemy,m.part,m.point):detached?m.part!==detached.part||dist(m.point,detached.position)>1.8: m.targetId!=='world'&&(m.targetId!=='terrain'||Math.abs(m.point[1]-ctx.terrainHeight(state,m.point[0],m.point[2]))>.3))return fail('invalid_contact');
  state.projectiles.splice(state.projectiles.indexOf(shot),1);
  if(['flame','fuel'].includes(shot.kind))return ok(ctx.fireContact(state,shot,m));
  if(state.embeds.length>=COMBAT_LIMITS.embeds)state.embeds.shift();
  state.embeds.push({id:shot.id,kind:shot.kind,targetId:m.targetId,part:m.part||'torso',localPoint:[...m.localPoint],localQuaternion:[...m.localQuaternion],point:[...m.point],normal:[...m.normal],...(m.boneName?{boneName:m.boneName}:{})});
  const events=[{kind:'embed',id:shot.id,ownerId:shot.ownerId,position:[...m.point],targetId:m.targetId,impact:!enemy,normal:[...m.normal],material:detached?.kind==='skeleton'?'bone':'stone'}];
  if(enemy)hitEnemyPart(state,enemy,m.part,shot.kind==='bolt'?48:38,m,ctx,events,{projectile:true});
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
    const id=ctx.nextId(state,'q'),speed=flame?10.5:6;
    state.projectiles.push({id,ownerId:p.id,kind:flame?'flame':'fuel',lit:!flame&&!!p.flaskLit,position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map((n,i)=>n*speed+(!flame&&i===1?2:0)),curve:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});
    return ok([{kind:flame?'flame_emit':'fuel_throw',weapon:p.tool,position:[...m.origin],id}]);
  }
  if(m.action==='special'&&p.tool==='wyrmspout'){
    if((p.overheatUntil||0)>state.tick)return fail('overheated');
    if(state.tick-(p.flameTick??-1000)<10)return fail('release_to_vent');
    if(state.tick-(p.specialTick??-1000)<120)return fail('cooldown');
    p.specialTick=state.tick;p.heat=Math.max(0,(p.heat||0)-.5);return ok([]);
  }
  if(m.action==='special'&&p.tool==='flask'){p.flaskLit=!p.flaskLit;return ok([]);}
  if(m.action==='fire'){
    if(!['bow','crossbow'].includes(p.tool)||!vec(m.origin)||dist(m.origin,p.position)>2.7||!unit(m.direction))return fail('invalid_action');
    const curve=m.curve===undefined?[0,0,0]:m.curve;if(!vec(curve,1.31)||Math.hypot(...curve)>1.31||m.draw!==undefined&&(!Number.isFinite(m.draw)||m.draw<0||m.draw>1))return fail('invalid_action');
    if(state.tick-p.attackTick<(p.tool==='bow'?33:42))return fail('cooldown');if(state.projectiles.length>=COMBAT_LIMITS.projectiles)return fail('world_limit');
    p.attackTick=state.tick;const id=ctx.nextId(state,'q'),speed=p.tool==='bow'?18+18*Math.max(.2,m.draw??.67):42;
    state.projectiles.push({id,ownerId:p.id,kind:p.tool==='bow'?'arrow':'bolt',position:[...m.origin],previousPosition:[...m.origin],velocity:m.direction.map(n=>n*speed),curve:p.tool==='bow'?[...curve]:[0,0,0],bornTick:state.tick,trail:[[...m.origin]]});return ok([{kind:'shoot',weapon:p.tool,position:[...m.origin],id}]);
  }
  if(m.action==='projectileHit')return fail('host_required');
  if(m.action==='grab'){const d=state.detachedParts.find(q=>q.id===m.id);if(!d||d.heldBy||state.detachedParts.some(q=>q.heldBy===p.id)||dist(d.position,p.position.map((n,i)=>n+(i===1?1:0)))>2.8)return fail('out_of_reach');d.heldBy=p.id;d.velocity=[0,0,0];d.angularVelocity=[0,0,0];p.tool='limb';return ok([{kind:'grab',id:d.id,position:[...d.position]}]);}
  if(m.action==='release'){if(m.throw!==undefined&&typeof m.throw!=='boolean')return fail('invalid_action');const dir=m.direction??[-Math.sin(p.yaw),.1,-Math.cos(p.yaw)];if(!vec(dir,1.01))return fail('invalid_action');const n=Math.hypot(...dir);if(n<.9||n>1.1)return fail('invalid_action');return releaseHeld(state,p,dir.map(v=>v/n),m.throw===true)?ok([]):fail('nothing_held');}
  if(m.action==='special'){
    if(!['axe','hammer','pick'].includes(p.tool))return fail('invalid_action');if(state.tick-(p.specialTick??-1000)<240)return fail('cooldown');
    const at=[p.position[0]-Math.sin(p.yaw)*1.5,p.position[1],p.position[2]-Math.cos(p.yaw)*1.5],events=[];p.specialTick=state.tick;
    for(const e of [...state.enemies])if(dist(e.position,at)<(p.tool==='hammer'?5:3))hitEnemyPart(state,e,p.tool==='axe'?'leftArm':'torso',p.tool==='hammer'?65:55,{tool:p.tool,point:at},ctx,events);
    if(p.tool==='pick')for(const ore of state.deposits){if(ore.depleted||Math.hypot(ore.x-at[0],ore.z-at[2])>4||ore.hits===ore.maxHits-1&&state.pickups.length>=256)continue;ore.hits++;events.push({kind:'stone_hit',id:ore.id,position:[ore.x,ctx.terrainHeight(state,ore.x,ore.z),ore.z]});if(ore.hits===ore.maxHits){ore.depleted=true;state.pickups.push({id:ctx.nextId(state,'p'),kind:ore.kind==='meteor'?'gems':'stone',amount:2,x:ore.x,z:ore.z,y:ctx.terrainHeight(state,ore.x,ore.z)});}}
    events.push({kind:p.tool==='hammer'?'hammer_slam':p.tool==='pick'?'pick_burst':'axe_cleave',id:p.id,position:at});return ok(events);
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
    if(holder){const hand=holder.hands?.[1]||holder.hands?.[0],target=hand?holder.position.map((n,i)=>n+hand.position[i]):[holder.position[0]-Math.sin(holder.yaw)*1.2,holder.position[1]+1.1,holder.position[2]-Math.cos(holder.yaw)*1.2];d.position=d.position.map((n,i)=>n+(target[i]-n)*.4);d.quaternion=hand?[...hand.quaternion]:[0,Math.sin(holder.yaw/2),0,Math.cos(holder.yaw/2)];continue;}
    d.velocity[1]-=15*dt;const old=[...d.position];d.position=d.position.map((n,i)=>clamp(n+d.velocity[i]*dt,i===1?-150:-54.5,i===1?150:54.5));
    const [x,y,z,w]=d.quaternion,[a,b,c]=d.angularVelocity;const q=[x+dt*.5*(a*w+b*z-c*y),y+dt*.5*(b*w+c*x-a*z),z+dt*.5*(c*w+a*y-b*x),w-dt*.5*(a*x+b*y+c*z)],l=Math.hypot(...q);d.quaternion=q.map(n=>n/l);
    // Project all eight corners of the complete frozen limb (including feet) onto
    // terrain. A pivot-only collider otherwise buries knees/feet after rotation.
    const [qx,qy,qz,qw]=d.quaternion,box=d.localBounds||{min:[-.3,-.5,-.3],max:[.3,.5,.3]};let floor=-Infinity;
    for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]]){const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x),rx=x+qw*tx+qy*tz-qz*ty,ry=y+qw*ty+qz*tx-qx*tz,rz=z+qw*tz+qx*ty-qy*tx;floor=Math.max(floor,ctx.terrainHeight(state,d.position[0]+rx,d.position[2]+rz)-ry);}
    if(d.position[1]<floor){d.position[1]=floor;d.velocity[1]=Math.abs(d.velocity[1])>.8?Math.abs(d.velocity[1])*.3:0;d.velocity[0]*=.88;d.velocity[2]*=.88;d.angularVelocity=d.angularVelocity.map(n=>n*.9);}
    const speed=Math.hypot(...d.velocity);if(d.throwerId&&speed>4)for(const enemy of [...state.enemies])if(!d.hitIds.includes(enemy.id)&&segmentDistance(partPosition(enemy,'torso'),old,d.position)<.9){d.hitIds.push(enemy.id);hitEnemyPart(state,enemy,'torso',Math.min(60,speed*4),null,ctx,events);d.velocity=d.velocity.map(n=>n*.55);}
  }
}
export function validateCombat(saved,ids){
  const unique=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&!ids.has(id)&&(ids.add(id),true);
  const tick=n=>Number.isSafeInteger(n)&&n>=0&&n<=saved.tick;
  for(const [key,cap]of Object.entries(COMBAT_LIMITS))if(saved[key]!==undefined&&(!Array.isArray(saved[key])||saved[key].length>cap))throw Error('Invalid combat limit');
  for(const p of saved.projectiles||[])if(!p||!unique(p.id)||typeof p.ownerId!=='string'||!['arrow','bolt','flame','fuel'].includes(p.kind)||(p.lit!==undefined&&typeof p.lit!=='boolean')||!vec(p.position)||!vec(p.previousPosition)||!vec(p.velocity,80)||!vec(p.curve,1.31)||Math.hypot(...p.curve)>1.31||!tick(p.bornTick)||!Array.isArray(p.trail)||p.trail.length<1||p.trail.length>16||!p.trail.every(q=>vec(q)))throw Error('Invalid projectile');
  const held=new Set();
  for(const d of saved.detachedParts||[])if(!d||!unique(d.id)||typeof d.sourceId!=='string'||!['skeleton','golem'].includes(d.kind)||!PARTS.includes(d.part)||!vec(d.position)||!quat(d.quaternion)||d.localBounds!==undefined&&!bounds(d.localBounds)||!vec(d.velocity,100)||!vec(d.angularVelocity,30)||!tick(d.bornTick)||(d.heldBy!==null&&(!saved.players.some(p=>p.id===d.heldBy&&p.role==='hero')||held.has(d.heldBy)))||(d.throwerId!==undefined&&d.throwerId!==null&&typeof d.throwerId!=='string')||(d.hitIds!==undefined&&(!Array.isArray(d.hitIds)||d.hitIds.length>64||!d.hitIds.every(q=>typeof q==='string'&&q.length<=64))))throw Error('Invalid detached part');else if(d.heldBy)held.add(d.heldBy);
  for(const e of saved.embeds||[])if(!e||!unique(e.id)||!['arrow','bolt'].includes(e.kind)||!PARTS.includes(e.part)||!validContact(e)||!(e.targetId==='world'||e.targetId==='terrain'||saved.enemies.some(q=>q.id===e.targetId)||saved.detachedParts?.some(q=>q.id===e.targetId)))throw Error('Invalid embed');
  for(const e of saved.enemies)if(e.kind!==undefined&&!['skeleton','golem'].includes(e.kind)||e.armor!==undefined&&(!Number.isInteger(e.armor)||e.armor<0||e.armor>3)||e.parts!==undefined&&(!e.parts||!PARTS.every(p=>Number.isFinite(e.parts[p])&&e.parts[p]>=0&&e.parts[p]<=(e.kind==='golem'?120:p==='torso'?100:55)))||e.missingParts!==undefined&&(!Array.isArray(e.missingParts)||e.missingParts.length>6||new Set(e.missingParts).size!==e.missingParts.length||!e.missingParts.every(p=>PARTS.includes(p)&&e.parts?.[p]===0)))throw Error('Invalid enemy anatomy');
}

// Only known fields survive a user-imported checkpoint. Validation above checks
// numeric bounds; this prevents unknown nested payloads inflating every snapshot.
export function restoreCombat(saved){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
  return {
    projectiles:(saved.projectiles||[]).map(p=>pick(p,['id','ownerId','kind','position','previousPosition','velocity','curve','bornTick','trail','lit'])),
    embeds:(saved.embeds||[]).map(e=>pick(e,['id','kind','targetId','part','localPoint','localQuaternion','point','normal','boneName'])),
    detachedParts:(saved.detachedParts||[]).map(d=>({...pick(d,['id','sourceId','kind','part','position','quaternion','velocity','angularVelocity','heldBy','bornTick','throwerId','hitIds']),...(d.localBounds?{localBounds:{min:[...d.localBounds.min],max:[...d.localBounds.max]}}:{})})),
  };
}
