import {Vector3,Quaternion,MathUtils} from 'three';
const forward=new Vector3(0,0,-1),velocity=new Vector3(),axis=new Vector3(),acceleration=new Vector3(),inverse=new Quaternion();
// Bank the authored wing plane into actual curl acceleration, in projectile axes.
// Positive local Z roll lowers the left wing (-X), raising the right (+X).
export function phoenixBank(curve, speed, age, orientation=null){
 const t=MathUtils.clamp(age/.85,0,1),rate=3/.85*(1-t)**2;
 axis.fromArray(curve||[0,0,0]);velocity.fromArray(speed||[0,0,0]);
 if(axis.lengthSq()<1e-10||velocity.lengthSq()<1e-10||rate===0)return 0;
 if(orientation)inverse.copy(orientation).invert();else inverse.setFromUnitVectors(forward,velocity.clone().normalize()).invert();
 acceleration.crossVectors(axis,velocity).multiplyScalar(rate).applyQuaternion(inverse);
 return MathUtils.clamp(Math.atan2(-acceleration.x,Math.max(3,9.81+acceleration.y)),-1.1,1.1);
}
