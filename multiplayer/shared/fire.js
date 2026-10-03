// One bounded heat/fuel field consumed by all fire sources. Fixed 10 Hz ecology,
// 60 Hz packet flight remains in combat.js. No renderer or client hit authority.
import {applyEnemyScorch} from './combat.js';
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
  for(const c of state.fireCells)if(Math.hypot(c.x-point[0],c.z-point[2])<=radius){c.heat=0;c.burning=false;c.wetUntil=state.tick+300;}
  state.fireSurfaces=state.fireSurfaces.filter(p=>Math.hypot(p.position[0]-point[0],p.position[2]-point[2])>radius);
}

export function fireContact(state,shot,hit,ctx){
  const events=[],point=hit.point,ground=ctx.terrainHeight(state,point[0],point[2]);
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

export function stepFire(state,ctx,events){
  for(const player of state.players){
    if((player.overheatUntil||0)>state.tick)player.heat=1;
    else if(player.overheatUntil){player.overheatUntil=0;player.heat=.4;}
    else if(state.tick-(player.flameTick??-1000)>9)player.heat=Math.max(0,(player.heat||0)-.18/60);
  }
  if(state.tick%6)return;
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
  const hot=state.fireCells.filter(c=>c.burning).map(c=>[c.x,ctx.terrainHeight(state,c.x,c.z),c.z]);
  hot.push(...state.fireSurfaces.map(p=>p.position));
  const exposed=actor=>hot.some(p=>Math.hypot(actor.position[0]-p[0],actor.position[2]-p[2])<.7&&Math.abs(actor.position[1]-p[1])<1.8);
  for(const enemy of [...state.enemies])if(exposed(enemy)){
    // Ground fire reaches the feet first; heat rises through the torso. Keep
    // these six bounded bone values after the flame patch burns out.
    applyEnemyScorch(enemy,'leftLeg',.07);
    applyEnemyScorch(enemy,'rightLeg',.07);
    applyEnemyScorch(enemy,'torso',.035);
    ctx.damageEnemy(state,enemy,6,events);
  }
  for(const player of state.players)if(player.role==='hero'&&exposed(player))ctx.damageHero(state,player,2,events);
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
