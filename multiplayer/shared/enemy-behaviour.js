// Fixed-tick movement and committed melee. No clocks, rendering or random streams.
// Strike remains tick 18: the existing authored animations depend on that contract.
export const ENEMY_STRIKE_TICK=18;
const flat=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const radius=e=>e.kind==='golem'?.5:.32;

export function stepEnemies(state,{ground,resolve,damageHero,events}){
 const heroes=state.players.filter(p=>p.role==='hero'),grid=new Map(),cell=2;
 const originals=state.enemies.map(e=>({id:e.id,position:[...e.position],radius:radius(e)}));
 for(const e of originals){const k=`${Math.floor(e.position[0]/cell)},${Math.floor(e.position[2]/cell)}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
 const blocked=(a,b)=>{const n=Math.ceil(flat(a,b)/.18);for(let i=1;i<n;i++){const t=i/n,p=a.map((v,k)=>v+(b[k]-v)*t);p[1]+=1.05;const q=[...p];resolve(q,0,.04);if(flat(p,q)>.003||ground(p[0],p[2])>p[1])return true;}return false;};
 for(const e of state.enemies){
  if(e.meteorBorn&&state.tick-e.unfurlTick<90)continue;
  let target=null,best=Infinity;for(const h of heroes){const d=flat(e.position,h.position);if(d<best){best=d;target=h;}}
  if(!target)continue;
  let age=state.tick-e.attackTick;
  // Old saves can contain a wind-up without a locked target: let it recover harmlessly.
  const committed=age>=0&&age<34;
  const staggered=state.tick-(e.hurtTick??-1000)<22;
  if(!committed&&!staggered){
   const dx=target.position[0]-e.position[0],dz=target.position[2]-e.position[2];
   const desired=Math.atan2(-dx,-dz);e.yaw=wrap(e.yaw+clamp(wrap(desired-e.yaw),-.15,.15));
   const legs=e.missingParts.filter(p=>p.endsWith('Leg')).length;
   const speed=(e.kind==='golem'?1.25:2)*(legs===2?.2:legs===1?.55:1)*(e.slowUntil>state.tick?.35:1);
   let vx=best>1.5?dx/Math.max(best,.001)*speed:0,vz=best>1.5?dz/Math.max(best,.001)*speed:0;
   const ci=Math.floor(e.position[0]/cell),cj=Math.floor(e.position[2]/cell);
   for(let i=ci-1;i<=ci+1;i++)for(let j=cj-1;j<=cj+1;j++)for(const other of grid.get(`${i},${j}`)||[]){
    if(other.id===e.id||Math.abs(e.position[1]-other.position[1])>1.5)continue;
    let ox=e.position[0]-other.position[0],oz=e.position[2]-other.position[2],d=Math.hypot(ox,oz);const gap=radius(e)+other.radius+.18;
    if(d>=gap)continue;
    if(d<.0001){const pair=[e.id,other.id].sort().join(':');let h=0;for(const c of pair)h=(Math.imul(h,31)+c.charCodeAt(0))|0;const a=(h>>>0)*.0001,sign=e.id<other.id?1:-1;ox=Math.cos(a)*sign;oz=Math.sin(a)*sign;d=1;}
    const force=1.8*(1-Math.min(flat(e.position,other.position)/gap,1));vx+=ox/d*force;vz+=oz/d*force;
   }
   const length=Math.hypot(vx,vz);if(length>.001){
    vx/=length;vz/=length;let chosen=null,score=-Infinity;
    // A small deterministic fan steers around trunks and solid landmarks instead of walking through them.
    for(const angle of [0,.65,-.65,1.25,-1.25]){const c=Math.cos(angle),s=Math.sin(angle),x=vx*c-vz*s,z=vx*s+vz*c;
     const probe=[clamp(e.position[0]+x*.65,-55,55),e.position[1],clamp(e.position[2]+z*.65,-55,55)],before=[...probe];resolve(probe,radius(e));
     if(flat(probe,before)>.025||Math.abs(ground(probe[0],probe[2])-e.position[1])>.8)continue;
     const value=x*vx+z*vz;if(value>score){score=value;chosen=[x,z];}
    }
    if(chosen){const pace=Math.min(length,speed+1)/60;e.position[0]=clamp(e.position[0]+chosen[0]*pace,-55,55);e.position[2]=clamp(e.position[2]+chosen[1]*pace,-55,55);}
   }
  }
  // Keep all bodies outside the player's camera, including overlapping summons.
  for(const h of heroes){const d=flat(e.position,h.position);if(d<1&&Math.abs(e.position[1]-h.position[1])<2.5){const x=d>.001?(e.position[0]-h.position[0])/d:1,z=d>.001?(e.position[2]-h.position[2])/d:0;e.position[0]=clamp(h.position[0]+x,-55,55);e.position[2]=clamp(h.position[2]+z,-55,55);}}
  resolve(e.position,radius(e));e.position[1]=ground(e.position[0],e.position[2]);
  const range=flat(e.position,target.position),facing=(-Math.sin(e.yaw)*(target.position[0]-e.position[0])-Math.cos(e.yaw)*(target.position[2]-e.position[2]))/Math.max(range,.001);
  if(!committed&&!staggered&&range<1.8&&facing>.7&&Math.abs(e.position[1]-target.position[1])<1.8&&state.tick-e.attackTick>60&&!blocked(e.position,target.position)){
   e.attackTick=state.tick;e.attackTarget=target.id;age=0;
  }
  if(age===ENEMY_STRIKE_TICK){
   const victim=heroes.find(p=>p.id===e.attackTarget);if(!victim)continue;
   const d=flat(e.position,victim.position),dot=(-Math.sin(e.yaw)*(victim.position[0]-e.position[0])-Math.cos(e.yaw)*(victim.position[2]-e.position[2]))/Math.max(d,.001);
   if(d<2&&dot>.65&&Math.abs(e.position[1]-victim.position[1])<1.8&&(e.hurtTick??-1000)<e.attackTick&&!blocked(e.position,victim.position)){
    const arms=e.missingParts.filter(p=>p.endsWith('Arm')).length;damageHero(state,victim,(e.kind==='golem'?22:10)*(arms===2?.25:arms===1?.65:1),events);
   }
  }
 }
}
