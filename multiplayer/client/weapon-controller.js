import * as T from 'three';
import {SIEGEBIRD_RELOAD} from './siegebird-reload.js';
import {bowShotFromAim} from './bow-shot.js';
import {FLOCKWRIGHT} from '../shared/combat.js';
// Input semantics only; shared simulation owns damage, ammunition and cooldowns.
// reload (optional): {time(), press()} supplies the Siegebird presentation clock and hears presses while the bird reloads.
export function createWeaponController({getTool,getAim,getDraw=()=>null,fire,emitFlame=()=>{},pourFuel=()=>{},canFlame=()=>true,canFlock=()=>true,flameInterval=()=>105,special,onDraw=()=>{},clock=()=>performance.now(),reload=null}) {
 let started=null,curveBase=null,lastShot=-Infinity,lastBolt=-Infinity,lastFlock=-Infinity,flameHeld=false,nextFlame=0;
 const vector=v=>new T.Vector3(...v),reloadTime=()=>reload?reload.time():(clock()-lastBolt)/1000;
 function state(){const draw=started===null?0:T.MathUtils.clamp(getDraw()??(clock()-started)/850,.15,1);return{firing:flameHeld&&canFlame(),drawing:started!==null,draw,curved:!!curveBase,curveBase:curveBase?.toArray()??null,recoil:Math.max(0,1-(clock()-lastShot)/450),reload:reloadTime()};}
 function tick(){if(flameHeld&&getTool()==='wyrmspout'&&clock()>=nextFlame){nextFlame=clock()+flameInterval();if(canFlame()){emitFlame(getAim());lastShot=clock();}}}
 function begin(){if(getTool()==='wyrmspout'){flameHeld=true;tick();return true;}if(getTool()==='flask'){pourFuel(getAim());lastShot=clock();return true;}if(getTool()==='bow'){if(started===null)started=clock();onDraw(state());return true;}if(getTool()==='flockwright'){if(!canFlock()||clock()-lastFlock<FLOCKWRIGHT.cycleTicks/60*1000)return true;const aim=getAim();fire({...aim,curve:[0,0,0],draw:1});lastShot=lastFlock=clock();return true;}if(getTool()==='crossbow'){if(reloadTime()<SIEGEBIRD_RELOAD.seconds){reload?.press?.();return true;}const aim=getAim();fire({...aim,curve:[0,0,0],draw:1});lastShot=lastBolt=clock();return true;}return false;}
 function end(){flameHeld=false;if(started===null)return;const aim=getAim(),draw=state().draw,shot=bowShotFromAim(aim.direction,curveBase?.toArray(),draw);fire({origin:aim.origin,direction:shot.direction,curve:shot.curve,draw});lastShot=clock();cancel();}
 function specialDown(){if(getTool()==='bow'){if(started!==null&&!curveBase)curveBase=vector(getAim().direction).normalize();onDraw(state());}else special();}
 function cancel(){flameHeld=false;nextFlame=0;started=null;curveBase=null;onDraw(state());}
 return{begin,end,tick,special:specialDown,cancel,state};
}
