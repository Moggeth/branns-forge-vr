import * as T from 'three';
import {solveSiegebirdBallistics} from './siegebird-ballistics.js';
import {weaponTip} from './asset-pose.js';
import {SIEGEBIRD_PRESENTATION as P,siegebirdAdsPosition} from './siegebird-sight.js';
// The bore, muzzle and sight share one physical transform. Only the optical
// markings move on their elevation slide; projectile origin is never recentered.
export function createSiegebirdAim({anchor,weapon,camera,sight}) {
 const inverse=new T.Quaternion(),gravity=new T.Vector3(),muzzle=new T.Vector3(),direction=new T.Vector3(),forward=new T.Vector3(0,0,-1),adsPosition=new T.Vector3(),hip=new T.Vector3();
 let amount=0,solution=null;
 function update(dt,wanted,motion=new T.Vector3()){
  amount+=(Number(wanted)-amount)*(1-Math.exp(-P.transition*Math.max(0,dt)));
  if(Math.abs(amount-Number(wanted))<.0001)amount=Number(wanted);
  camera.updateWorldMatrix(true,false);inverse.copy(camera.getWorldQuaternion(new T.Quaternion())).invert();gravity.set(0,-3,0).applyQuaternion(inverse);
  hip.fromArray(P.hip);hip.x*=Math.min(1,camera.aspect/.9);hip.addScaledVector(motion,1-amount);
  // Muzzle offset changes as the stock rotates and the eye comes to the peep.
  // Solve that coupling, instead of correcting the fired direction invisibly.
  for(let i=0;i<5;i++){
   siegebirdAdsPosition(T,sight.eye,anchor.quaternion,adsPosition);
   anchor.position.copy(hip).lerp(adsPosition,amount);anchor.updateWorldMatrix(true,true);
   camera.worldToLocal(weaponTip(weapon,'crossbow',muzzle));
   solution=solveSiegebirdBallistics({muzzle:muzzle.toArray(),gravity:gravity.toArray(),ranges:i===4?[50,70]:[]});
   if(solution.valid)anchor.quaternion.setFromUnitVectors(forward,direction.fromArray(solution.direction));
  }
  siegebirdAdsPosition(T,sight.eye,anchor.quaternion,adsPosition);anchor.position.copy(hip).lerp(adsPosition,amount);anchor.updateWorldMatrix(true,true);
  sight.apply({ads:amount,anchorQuaternion:anchor.quaternion,holdovers:(solution?.holdovers||[]).map(h=>({...h,verticalAngle:-h.verticalAngle,horizontalAngle:-h.horizontalAngle}))});
  return amount;
 }
 return {update,reset(){amount=0;},get amount(){return amount;},get solution(){return solution;}};
}
