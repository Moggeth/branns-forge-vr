// Direct port of godot/desktop_weapon_pose.gd (2026-10-02).
// Authored tip path, not a sinusoidal wrist wobble. Camera never moves.
import * as T from 'three';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const smooth=(a,b,t)=>{const u=T.MathUtils.clamp((t-a)/(b-a),0,1);return u*u*(3-2*u);};
export const SWING_PROFILES={
 hammer:{duration:.54,cooldown:.65,a:.21,f:.72,wind:V(.38,.52,.22),follow:V(-.19,-.34,.08),push:.95,through:.12,bulge:.06,lag:.08,cant:.22,pre:.05,lead:1.2,wrist:[V(),V(.10,-.02,.16),V(-.08,.04,-.02),V(-.13,.04,-.12),V()]},
 limb:{duration:.48,cooldown:.58,a:.14,f:.72,wind:V(.38,.38,.14),follow:V(-.40,-.34,.14),push:1.1,through:.5,bulge:.04,lag:.04,cant:.32,pre:.05,lead:1.6,wrist:[V(),V(.05,-.03,.22),V(-.08,.05,-.02),V(-.07,.05,-.20),V()]},
 axe:{duration:.38,cooldown:.46,a:.13,f:.76,wind:V(.40,.34,.14),follow:V(-.45,-.36,.20),push:1.15,through:.85,bulge:.05,lag:.04,cant:.32,pre:.06,lead:1.6,wrist:[V(),V(.04,-.03,.26),V(-.09,.06,-.03),V(-.06,.05,-.24),V()]},
 pick:{duration:.40,cooldown:.48,a:.12,f:.64,wind:V(.27,.40,.10),follow:V(-.15,-.22,.27),push:1.3,through:.22,bulge:.03,lag:.025,cant:.42,pre:.04,lead:1.8,wrist:[V(),V(.09,-.02,.15),V(-.13,.04,-.02),V(.10,.03,-.12),V()]},
};
export function hermite(p0,v0,p1,v1,t0,t1,t){const span=t1-t0,u=T.MathUtils.clamp((t-t0)/span,0,1),u2=u*u,u3=u2*u;return p0.clone().multiplyScalar(2*u3-3*u2+1).addScaledVector(v0,span*(u3-2*u2+u)).addScaledVector(p1,-2*u3+3*u2).addScaledVector(v1,span*(u3-u2));}
function catmull(times,points,t){let i=0,last=times.length-1;while(i<last-1&&t>=times[i+1])i++;const va=i===0?V():points[i+1].clone().sub(points[i-1]).divideScalar(times[i+1]-times[i-1]);const vb=i+1===last?V():points[i+2].clone().sub(points[i]).divideScalar(times[i+2]-times[i]);return hermite(points[i],va,points[i+1],vb,times[i],times[i+1],t);}
export function swingPose(tool,progress,rest,tip,reach){
 const s=SWING_PROFILES[tool]||SWING_PROFILES.axe,p=T.MathUtils.clamp(progress,0,1),a=s.a,f=s.f;
 const restTip=tip.clone().applyQuaternion(rest.quaternion).add(rest.position),contact=V(0,0,-reach);
 const wind=V(s.wind.x,s.wind.y,restTip.z-s.pre),follow=contact.clone().add(s.follow);
 const chord=V(-wind.x,-wind.y),followXY=V(s.follow.x,s.follow.y);
 const dir=chord.clone().normalize().multiplyScalar(.6).addScaledVector(followXY.normalize(),.4).normalize();
 const vWind=chord.clone().multiplyScalar(.2/(.5-a)),vStart=wind.clone().sub(restTip).multiplyScalar(2/a);
 const vContact=dir.multiplyScalar(chord.length()/(.5-a)*s.push*1.6);vContact.z=s.lead*(contact.z-wind.z)/(.5-a);
 const vFollow=follow.clone().sub(contact).multiplyScalar(s.through/(f-.5));let desired;
 if(p<a){desired=hermite(restTip,vStart,wind,vWind,0,a,p);const u=p/a,lift=wind.clone().sub(restTip);let arc=V(-lift.y,lift.x).normalize();const away=V((restTip.x+wind.x)*.5-.45,(restTip.y+wind.y)*.5+.6);if(arc.dot(away)<0)arc.negate();desired.addScaledVector(arc,.03*16*u*u*(1-u)*(1-u));}
 else if(p<.5){desired=hermite(wind,vWind,contact,vContact,a,.5,p);const u=(p-a)/(.5-a);let bow=V(-chord.y,chord.x).normalize();if(bow.dot(V(-1,1))<0)bow.negate();desired.addScaledVector(bow,s.bulge*16*u*u*(1-u)*(1-u));}
 else if(p<f)desired=hermite(contact,vContact,follow,vFollow,.5,f,p);
 else desired=hermite(follow,vFollow,restTip,V(),f,1,p);
 // Canonical asset handle +Y, working face -Z; align this actual plane.
 const normal=V(-1,0,0),want=V(-1,1,s.cant).normalize();if(normal.dot(want)<0)want.negate();
 const delta=new T.Quaternion().setFromUnitVectors(normal.applyQuaternion(rest.quaternion),want);
 const aligned=delta.multiply(rest.quaternion.clone());
 const activity=smooth(0,a+(.5-a)*.55,p)*(1-smooth(f,1,p));
 const wrist=catmull([0,a,.5+s.lag,f,1],s.wrist,p);
 const q=rest.quaternion.clone().slerp(aligned,activity).premultiply(new T.Quaternion().setFromEuler(new T.Euler(wrist.x,wrist.y,wrist.z,'YXZ')));
 return {position:desired.clone().sub(tip.clone().applyQuaternion(q)),quaternion:q,tip:desired};
}
export function idleOffset(time,speed=0){return V(Math.sin(time*1.07)*.0025+Math.sin(time*8)*.008*speed,Math.sin(time*1.65)*.0035+Math.abs(Math.cos(time*8))*.012*speed,Math.cos(time*1.3)*.0018);}
