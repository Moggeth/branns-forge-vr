// Authored "bowling axe" special (Opus 2026-10-03). Camera space: +X right, +Y up, -Z forward; rest = {position, quaternion}
// of the held visual (grip pivot). The head loops BACKWARD: pull back/down, swing underhand low past the hip like a bowling
// delivery with the blade leading, release at .45 as a rising forward sundering strike, then recover. Not a slash.
import * as T from 'three';
export const SPECIAL_MOTION=Object.freeze({axe:{duration:.8,release:.45,cooldown:.9}});
const V=(x,y,z)=>new T.Vector3(x,y,z),X=V(1,0,0),Y=V(0,1,0),Z=V(0,0,1);
// time, hand offset from rest (m), pitch about camera +X (deg; +Y rotates toward +Z/back), yaw (deg, about +Y), roll (deg, about -Z)
const KEYS=[
 [0,   V(0,0,0),          0,   0,  0],
 [.16, V(.07,-.26,.30),   118, 10, -18], // pull back and down: head swings behind, arm out to the side
 [.31, V(.03,-.50,.06),   182, 4,  -6],  // bottom of the pendulum beside the hip, head hanging, blade leading
 [.45, V(-.05,-.34,-.40), 246, -8, 6],   // RELEASE: underhand delivery, head rising forward, edge toward target
 [.60, V(-.07,-.06,-.56), 292, -12, 8],  // sundering follow-through: blade driven out level along the lane
 [.80, V(-.03,-.06,-.22), 334, -5, 3],
 [1,   V(0,0,0),          360, 0,  0],
];
function scalarCurve(i,t,get){ // Catmull-Rom over non-uniform keys, zero end tangents (C1, monotone keys here)
 const k0=KEYS[i],k1=KEYS[i+1],span=k1[0]-k0[0],u=(t-k0[0])/span,u2=u*u,u3=u2*u;
 const tan=j=>j<=0||j>=KEYS.length-1?0:(get(KEYS[j+1])-get(KEYS[j-1]))/(KEYS[j+1][0]-KEYS[j-1][0])*span;
 return get(k0)*(2*u3-3*u2+1)+tan(i)*(u3-2*u2+u)+get(k1)*(-2*u3+3*u2)+tan(i+1)*(u3-u2);
}
const _q=new T.Quaternion(),_e=new T.Quaternion();
// tool: 'axe' (other tools reuse the same authored path); progress normalized 0..1 over SPECIAL_MOTION.axe.duration.
export function specialPose(tool,progress,rest){
 const p=T.MathUtils.clamp(Number(progress)||0,0,1);
 if(p<=0||p>=1)return {position:rest.position.clone(),quaternion:rest.quaternion.clone()};
 let i=0;while(i<KEYS.length-2&&p>=KEYS[i+1][0])i++;
 const offset=V(scalarCurve(i,p,k=>k[1].x),scalarCurve(i,p,k=>k[1].y),scalarCurve(i,p,k=>k[1].z));
 const D=T.MathUtils.DEG2RAD,pitch=scalarCurve(i,p,k=>k[2])*D,yaw=scalarCurve(i,p,k=>k[3])*D,roll=scalarCurve(i,p,k=>k[4])*D;
 const q=new T.Quaternion().setFromAxisAngle(Z,-roll).multiply(_e.setFromAxisAngle(Y,yaw)).multiply(_q.setFromAxisAngle(X,pitch)).multiply(rest.quaternion);
 return {position:rest.position.clone().add(offset),quaternion:q.normalize()};
}
// Event helper for the controller: true exactly once when progress crosses the release (.45).
export function crossedRelease(prev,next,tool='axe'){const r=(SPECIAL_MOTION[tool]||SPECIAL_MOTION.axe).release;return prev<r&&next>=r;}
