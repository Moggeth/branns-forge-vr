import * as T from 'three';
// Input semantics only; shared simulation owns damage, ammunition and cooldowns.
export function createWeaponController({getTool,getAim,getDraw=()=>null,fire,emitFlame=()=>{},pourFuel=()=>{},canFlame=()=>true,special,onDraw=()=>{},clock=()=>performance.now()}) {
 let started=null,curveBase=null,lastShot=-Infinity,flameHeld=false,nextFlame=0;
 const vector=v=>new T.Vector3(...v);
 function state(){const draw=started===null?0:T.MathUtils.clamp(getDraw()??(clock()-started)/850,.15,1);return{firing:flameHeld&&canFlame(),drawing:started!==null,draw,curved:!!curveBase,recoil:Math.max(0,1-(clock()-lastShot)/450)};}
 function tick(){if(flameHeld&&getTool()==='wyrmspout'&&clock()>=nextFlame){nextFlame=clock()+105;if(canFlame()){emitFlame(getAim());lastShot=clock();}}}
 function begin(){if(getTool()==='wyrmspout'){flameHeld=true;tick();return true;}if(getTool()==='flask'){pourFuel(getAim());lastShot=clock();return true;}if(getTool()==='bow'){if(started===null)started=clock();onDraw(state());return true;}if(getTool()==='crossbow'){const aim=getAim();fire({...aim,curve:[0,0,0],draw:1});lastShot=clock();return true;}return false;}
 function end(){flameHeld=false;if(started===null)return;const aim=getAim(),d=vector(aim.direction).normalize();let direction=d,curve=new T.Vector3();if(curveBase){direction=curveBase;const angle=Math.min(1.1,Math.acos(T.MathUtils.clamp(direction.dot(d),-1,1)));curve.crossVectors(direction,d);if(curve.lengthSq()>1e-8)curve.normalize().multiplyScalar(angle);}fire({origin:aim.origin,direction:direction.toArray(),curve:curve.toArray(),draw:state().draw});lastShot=clock();cancel();}
 function specialDown(){if(getTool()==='bow'){if(started!==null&&!curveBase)curveBase=vector(getAim().direction).normalize();onDraw(state());}else special();}
 function cancel(){flameHeld=false;nextFlame=0;started=null;curveBase=null;onDraw(state());}
 return{begin,end,tick,special:specialDown,cancel,state};
}
