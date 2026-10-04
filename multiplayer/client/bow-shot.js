import * as T from 'three';

// One launch contract for the live guide and the released shot. atan2 remains
// precise at tiny angles: every movement across the latched direction responds.
export function bowShotFromAim(aimDirection, curveBase, draw, out = {direction: [0,0,0], curve: [0,0,0], speed: 0}) {
 const aim = new T.Vector3().fromArray(aimDirection).normalize();
 const base = curveBase ? new T.Vector3().fromArray(curveBase).normalize() : aim;
 const curve = new T.Vector3();
 if (curveBase) {
  curve.crossVectors(base, aim);
  const length = curve.length(), dot = T.MathUtils.clamp(base.dot(aim), -1, 1);
  const angle = Math.min(1.1, Math.atan2(length, dot));
  if (length > 1e-12) curve.multiplyScalar(angle / length);
  else if (dot < 0) {
   // Exact reverse aim has no unique turn plane; use a stable perpendicular.
   curve.crossVectors(base, Math.abs(base.y) < .9 ? new T.Vector3(0,1,0) : new T.Vector3(1,0,0)).normalize().multiplyScalar(angle);
  } else curve.set(0,0,0);
 }
 base.toArray(out.direction); curve.toArray(out.curve);
 out.speed = 18 + 18 * Math.max(.2, draw ?? .67);
 return out;
}
