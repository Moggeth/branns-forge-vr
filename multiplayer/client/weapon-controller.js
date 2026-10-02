import * as T from 'three';
// Input semantics only; shared simulation owns damage, ammunition and cooldowns.
export function createWeaponController({getTool,getAim,getDraw=()=>null,fire,special,onDraw=()=>{},clock=()=>performance.now()}) {
 let started=null,curveBase=null,lastShot=-Infinity;
 const vector=v=>new T.Vector3(...v);
 function state(){const draw=started===null?0:T.MathUtils.clamp(getDraw()??(clock()-started)/850,.15,1);return{drawing:started!==null,draw,curved:!!curveBase,recoil:Math.max(0,1-(clock()-lastShot)/450)};}
 function begin(){if(getTool()==='bow'){if(started===null)started=clock();onDraw(state());return true;}if(getTool()==='crossbow'){const aim=getAim();fire({...aim,curve:[0,0,0],draw:1});lastShot=clock();return true;}return false;}
 function end(){if(started===null)return;const aim=getAim(),d=vector(aim.direction).normalize();let direction=d,curve=new T.Vector3();if(curveBase){direction=curveBase;const angle=Math.min(1.1,Math.acos(T.MathUtils.clamp(direction.dot(d),-1,1)));curve.crossVectors(direction,d);if(curve.lengthSq()>1e-8)curve.normalize().multiplyScalar(angle);}fire({origin:aim.origin,direction:direction.toArray(),curve:curve.toArray(),draw:state().draw});lastShot=clock();cancel();}
 function specialDown(){if(getTool()==='bow'){if(started!==null&&!curveBase)curveBase=vector(getAim().direction).normalize();onDraw(state());}else special();}
 function cancel(){started=null;curveBase=null;onDraw(state());}
 return{begin,end,special:specialDown,cancel,state};
}
