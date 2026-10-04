// One bounded heat/fuel field consumed by all fire sources. Fixed 10 Hz ecology,
// 60 Hz packet flight remains in combat.js. No renderer or client hit authority.
import {applyEnemyScorch,partPosition,PARTS} from './combat.js';
import {entHeight} from './ents.js';
export const FIRE_LIMITS = Object.freeze({cells:256,surfaces:32,cellSize:.5});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const key=(x,z)=>`${x},${z}`;
const validVector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=200);

export function addFuel(state,point,radius=1,amount=.8,lit=false) {
  const cells=state.fireCells, map=new Map(cells.map(c=>[key(c.x,c.z),c]));
  const x0=Math.round(point[0]*2)/2,z0=Math.round(point[2]*2)/2,n=Math.ceil(radius*2);
  let changed=0;
  for(let ix=-n;ix<=n;ix++)for(let iz=-n;iz<=n;iz++){
    const x=x0+ix*.5,z=z0+iz*.5,d=Math.hypot(x-point[0],z-point[2]);
    if(d>radius||Math.abs(x)>55||Math.abs(z)>55)continue;
    let cell=map.get(key(x,z));
    if(!cell){if(cells.length>=FIRE_LIMITS.cells)continue;cell={x,z,fuel:0,heat:0,burning:false,wetUntil:0,expiresTick:state.tick+1800};cells.push(cell);map.set(key(x,z),cell);}
    cell.fuel=clamp(cell.fuel+amount*(.5+.5*(1-d/radius)),0,1);cell.expiresTick=state.tick+1800;
    if(lit&&cell.wetUntil<=state.tick){cell.heat=1;cell.burning=true;}changed++;
  }
  return changed;
}

export function applyHeat(state,point,radius,strength,ctx){
  for(const cell of state.fireCells)if(Math.hypot(cell.x-point[0],cell.z-point[2])<=radius&&
      Math.abs(ctx.terrainHeight(state,cell.x,cell.z)-point[1])<1.3&&cell.wetUntil<=state.tick){
    cell.heat=clamp(cell.heat+strength,0,1);if(cell.heat>=.6&&cell.fuel>.015)cell.burning=true;
  }
}

export function quenchFire(state,point,radius){
  for(const e of [...state.enemies,...(state.detachedParts||[])])if(Math.hypot(e.position[0]-point[0],e.position[2]-point[2])<=radius){delete e.burnUntil;delete e.burnPart;}
  for(const c of state.fireCells)if(Math.hypot(c.x-point[0],c.z-point[2])<=radius){c.heat=0;c.burning=false;c.wetUntil=state.tick+300;}
  state.fireSurfaces=state.fireSurfaces.filter(p=>Math.hypot(p.position[0]-point[0],p.position[2]-point[2])>radius);
}

export function fireContact(state,shot,hit,ctx){
  const events=[],point=hit.point,ground=ctx.terrainHeight(state,point[0],point[2]);
  if(shot.kind==='arrow'&&Math.hypot(...(shot.curve||[0,0,0]))>.000001){
    const target=state.enemies.find(e=>e.id===hit.targetId)||state.detachedParts?.find(d=>d.id===hit.targetId);
    if(target){target.burnUntil=state.tick+240;target.burnPart=hit.part||target.part||'torso';if(target.parts)applyEnemyScorch(target,target.burnPart,.18);else target.scorch=clamp((target.scorch||0)+.18,0,1);}
    else addFuel(state,[point[0],ground,point[2]],.7,.28,true);
    applyHeat(state,point,1,1,ctx);
    return [{kind:'phoenix_ignite',id:hit.targetId,position:[...point],normal:[...hit.normal],part:hit.part}];
  }
  if(shot.kind==='fuel'){
    addFuel(state,[point[0],ground,point[2]],1.2,.85,!!shot.lit);
    if(shot.lit)applyHeat(state,point,1.5,1,ctx);
    events.push({kind:'fuel_spill',id:shot.id,position:[...point],normal:[...hit.normal]});
  }else{
    applyHeat(state,point,1,1,ctx);
    if(Math.abs(point[1]-ground)<.4)addFuel(state,[point[0],ground,point[2]],.55,.12,true);
    // Static world patches use contact normals. Enemy fire is direct damage;
    // don't leave a world-fixed patch pretending to be attached to a limb.
    else if(!state.enemies.some(e=>e.id===hit.targetId)&&['world','terrain'].includes(hit.targetId)){
      let patch=state.fireSurfaces.find(p=>Math.hypot(...p.position.map((n,i)=>n-point[i]))<.35);
      if(patch)patch.expiresTick=state.tick+150;
      else if(state.fireSurfaces.length<FIRE_LIMITS.surfaces)state.fireSurfaces.push({id:ctx.nextId(state,'f'),position:[...point],normal:[...hit.normal],expiresTick:state.tick+150});
    }
  }
  const enemy=state.enemies.find(e=>e.id===hit.targetId);
  if(enemy&&(shot.kind==='flame'||shot.lit)){
    applyEnemyScorch(enemy,hit.part||'torso',shot.kind==='flame'?.045:.14);
    ctx.damageEnemy(state,enemy,shot.kind==='flame'?4:12,events);
  }
  return events;
}

// A few points per articulated region; the host renderer supplies actual posed
// joints where present, with deterministic anatomical samples for headless hosts.
export function fireSamples(enemy, supplied) {
  const out={};
  for(const part of PARTS){
    if(enemy.missingParts?.includes(part))continue;
    const points=supplied?.[part];
    out[part]=Array.isArray(points)&&points.length<=8&&points.length&&points.every(p=>validVector(p)&&Math.hypot(...p.map((n,i)=>n-enemy.position[i]))<5)?points: [partPosition({...enemy,yaw:enemy.yaw||0},part)];
    if(out[part]!==points&&part.endsWith('Leg'))out[part]=[.12,.42,.8].map(h=>{const p=[...out[part][0]];p[1]=enemy.position[1]+h*(enemy.kind==='golem'?1.45:enemy.kind==='ent'?entHeight(enemy)*.36:1);return p;});
  }
  return out;
}
export function flameExposure(points, sources){
  let exposure=0;
  for(const p of points)for(const f of sources){
    const radial=Math.hypot(p[0]-f.position[0],p[2]-f.position[2]),dy=p[1]-f.position[1];
    if(radial<f.radius&&dy>=-.16&&dy<f.height)exposure=Math.max(exposure,(1-radial/f.radius)*(.55+.45*(1-Math.max(0,dy)/f.height)));
  }
  return exposure;
}

export function stepFire(state,ctx,events){
  for(const player of state.players){
    if((player.overheatUntil||0)>state.tick)player.heat=1;
    else if(player.overheatUntil){player.overheatUntil=0;player.heat=.4;}
    else if(state.tick-(player.flameTick??-1000)>9)player.heat=Math.max(0,(player.heat||0)-.18/60);
  }
  if(state.tick%6)return;
  // Ecology queries the same cell/neighbor repeatedly. This cache lives only
  // for this step, so deformation, bridges and restored worlds cannot go stale.
  const sourceHeight=ctx.terrainHeight,samples=new Map();
  ctx={...ctx,terrainHeight:(s,x,z)=>{const k=key(x,z);if(samples.has(k))return samples.get(k);const h=sourceHeight(s,x,z);samples.set(k,h);return h;}};
  state.fireSurfaces=state.fireSurfaces.filter(p=>p.expiresTick>state.tick);
  state.fireCells=state.fireCells.filter(c=>c.expiresTick>state.tick&&c.fuel>.001);
  const map=new Map(state.fireCells.map(c=>[key(c.x,c.z),c])),heat=new Map(),flows=[];
  // The real forge hearth shares ignition with packets and burning liquid.
  if(state.shrine.hp>0)applyHeat(state,[.3,ctx.terrainHeight(state,0,0)+1.05,-.12],1.25,.35,ctx);
  for(const cell of state.fireCells){
    if(cell.wetUntil>state.tick){cell.heat=0;cell.burning=false;}
    if(cell.burning){
      cell.fuel=Math.max(0,cell.fuel-.008);cell.heat=1;
      if(cell.fuel<=.015)cell.burning=false;
      for(const [dx,dz]of [[.5,0],[-.5,0],[0,.5],[0,-.5]]){
        const other=map.get(key(cell.x+dx,cell.z+dz));
        if(other&&other.wetUntil<=state.tick&&Math.abs(ctx.terrainHeight(state,cell.x,cell.z)-ctx.terrainHeight(state,other.x,other.z))<.65)
          heat.set(other,(heat.get(other)||0)+.22);
      }
    }else cell.heat=Math.max(0,cell.heat-.025);
    // Cheap conservative downhill flow into already wetted neighbours. No
    // unbounded flood expansion and no full fluid simulation on every frame.
    if(cell.fuel>.08){
      const h=ctx.terrainHeight(state,cell.x,cell.z);let lowest=null,drop=.035;
      for(const [dx,dz]of [[.5,0],[-.5,0],[0,.5],[0,-.5]]){
        const other=map.get(key(cell.x+dx,cell.z+dz));if(!other||other.fuel>=.95)continue;
        const d=h-ctx.terrainHeight(state,other.x,other.z);if(d>drop){drop=d;lowest=other;}
      }
      if(lowest)flows.push([cell,lowest,Math.min(.02,cell.fuel*.08)]);
    }
  }
  for(const [cell,amount]of heat){cell.heat=clamp(cell.heat+amount,0,1);if(cell.heat>=.6&&cell.fuel>.015)cell.burning=true;}
  for(const [from,to,amount]of flows){const moved=Math.min(amount,1-to.fuel);from.fuel-=moved;to.fuel+=moved;}
  for(const patch of state.fireSurfaces)applyHeat(state,patch.position,1,.35,ctx);
  if(state.tick%30)return;
  const hot=state.fireCells.filter(c=>c.burning).map(c=>({position:[c.x,ctx.terrainHeight(state,c.x,c.z),c.z],radius:.55,height:.8}));
  hot.push(...state.fireSurfaces.map(p=>({position:p.position,radius:.5,height:.65})));
  for(const enemy of [...state.enemies]){
    const burning=(enemy.burnUntil||0)>state.tick;
    const nearby=hot.filter(f=>(f.position[0]-enemy.position[0])**2+(f.position[2]-enemy.position[2])**2<30.25);
    if(!nearby.length&&!burning)continue;
    const samples=nearby.length?fireSamples(enemy,ctx.fireSamples?.(enemy)):{};let exposed=false;
    for(const [part,points] of Object.entries(samples)){
      const heat=flameExposure(points,nearby);
      if(heat>0){applyEnemyScorch(enemy,part,.16*heat);exposed=true;}
    }
    if(burning)applyEnemyScorch(enemy,enemy.burnPart||'torso',.095);
    // Ents are dry timber: flames catch on them, they burn twice as hard and drop burning litter where they walk.
    if(enemy.kind==='ent'){if(exposed&&!burning){enemy.burnUntil=state.tick+240;enemy.burnPart='torso';}if(burning)addFuel(state,enemy.position,.6,.3,true);}
    if(exposed||burning)ctx.damageEnemy(state,enemy,(burning?7:6)*(enemy.kind==='ent'?2:1),events);
  }
  for(const d of state.detachedParts||[])if((d.burnUntil||0)>state.tick)d.scorch=clamp((d.scorch||0)+.095,0,1);
  for(const player of state.players)if(player.role==='hero'&&flameExposure([[player.position[0],player.position[1]+.12,player.position[2]]],hot)>0)ctx.damageHero(state,player,2,events);
}

export function restoreFire(saved,ids){
  const cells=saved.fireCells??[],surfaces=saved.fireSurfaces??[],seen=new Set();
  if(!Array.isArray(cells)||cells.length>FIRE_LIMITS.cells||!Array.isArray(surfaces)||surfaces.length>FIRE_LIMITS.surfaces)throw Error('Invalid fire limits');
  const tick=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=saved.tick+max;
  for(const c of cells){
    if(!c||![c.x,c.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=55&&Number.isInteger(n*2))||
      ![c.fuel,c.heat].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||typeof c.burning!=='boolean'||!tick(c.wetUntil,300)||!tick(c.expiresTick,1800)||seen.has(key(c.x,c.z)))throw Error('Invalid fuel cell');
    seen.add(key(c.x,c.z));
  }
  for(const p of surfaces){
    if(!p||typeof p.id!=='string'||!/^f\d+$/.test(p.id)||ids.has(p.id)||!validVector(p.position)||Math.abs(p.position[0])>55||Math.abs(p.position[2])>55||!validVector(p.normal)||Math.abs(Math.hypot(...p.normal)-1)>.02||!tick(p.expiresTick,150))throw Error('Invalid fire surface');
    ids.add(p.id);
  }
  for(const p of saved.players)if(p.heat!==undefined&&(!Number.isFinite(p.heat)||p.heat<0||p.heat>1)||p.overheatUntil!==undefined&&!tick(p.overheatUntil,180)||p.flameTick!==undefined&&(!Number.isSafeInteger(p.flameTick)||p.flameTick< -1000||p.flameTick>saved.tick)||p.flaskLit!==undefined&&typeof p.flaskLit!=='boolean')throw Error('Invalid fire equipment state');
  return {fireCells:cells.map(({x,z,fuel,heat,burning,wetUntil,expiresTick})=>({x,z,fuel,heat,burning,wetUntil,expiresTick})),fireSurfaces:surfaces.map(({id,position,normal,expiresTick})=>({id,position:[...position],normal:[...normal],expiresTick}))};
}
