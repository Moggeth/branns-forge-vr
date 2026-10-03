// Orchard's Edge cleave (2026-10-03; replaces the "bowling axe" Sunder delivery). Camera space: +X right, +Y up, -Z
// forward; rest = {position, quaternion} of the held visual (grip pivot). Cock the axe back over the right shoulder
// with the head pointing behind, drive it round level at waist height so the edge leads right → left, release at .45
// with the head straight ahead (the shared cleave fires here and its crescent sweeps the same way), follow through
// to the left, recover.
import * as T from 'three';
export const SPECIAL_MOTION=Object.freeze({axe:{duration:.8,release:.45,cooldown:.9}});
const V=(x,y,z)=>new T.Vector3(x,y,z),X=V(1,0,0),Y=V(0,1,0),Z=V(0,0,1);
// time, hand offset from rest (m), pitch about camera +X (deg; -82 lays the head out forward), yaw (deg, about +Y; +
// swings the head left), roll (deg, about -Z), twist (deg, about the axe's own shaft; 80 turns the edge to lead left)
const KEYS=[
 [0,   V(0,0,0),           0,   0,    0,  0],
 [.2,  V(.15,.2,.1),      -80, -110, -10, 60], // cock back over the right shoulder, head pointing behind and right
 [.36, V(.05,.2,-.05),    -82, -60,   0,  80], // drive round, level
 [.45, V(-.2,.2,-.12),    -82,  0,    0,  80], // RELEASE: head straight ahead, edge leading left
 [.6,  V(-.42,.16,-.08),  -82,  75,   8,  80], // follow-through: head swept out to the left
 [.8,  V(-.16,.04,-.04),  -40,  30,   4,  30],
 [1,   V(0,0,0),           0,   0,    0,  0],
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
 const D=T.MathUtils.DEG2RAD,pitch=scalarCurve(i,p,k=>k[2])*D,yaw=scalarCurve(i,p,k=>k[3])*D,roll=scalarCurve(i,p,k=>k[4])*D,twist=scalarCurve(i,p,k=>k[5])*D;
 const q=new T.Quaternion().setFromAxisAngle(Z,-roll).multiply(_e.setFromAxisAngle(Y,yaw)).multiply(_q.setFromAxisAngle(X,pitch)).multiply(rest.quaternion).multiply(_e.setFromAxisAngle(Y,twist));
 return {position:rest.position.clone().add(offset),quaternion:q.normalize()};
}
// Event helper for the controller: true exactly once when progress crosses the release (.45).
export function crossedRelease(prev,next,tool='axe'){const r=(SPECIAL_MOTION[tool]||SPECIAL_MOTION.axe).release;return prev<r&&next>=r;}
