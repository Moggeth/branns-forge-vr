import * as THREE from 'three';

// Loose bones flop. A skeleton's detached arm, leg or skull is one rigid body in the shared physics
// (shared/remains-physics.js), but on screen it hangs from real hinges: the elbow and wrist, the knee and ankle,
// and the jaw. Each hinge is a tiny Verlet pendulum in world space: its tip falls under gravity, lags behind when
// the bone it hangs from is flung about, stops on the ground and can only bend the way that joint bends.
// Presentation only (nothing here is synced or saved), cheap enough for phones: two hinges per bone, asleep at rest.
//
//   chain = articulationChain(root, part)              // null when this rig has no such joints (golems)
//   rigHinges(detached, segments, chain, part, root)    // after snapshotDetachedPart has split the geometry
//   stepHinges(detached, dt, height)                    // every frame, after the bone's own pose is set

// Bone order from the joint the body holds outward (build_skeleton.py JOINTS).
export const CHAINS = Object.freeze({
  leftArm: ['LeftArm', 'LeftForearm', 'LeftHand'], rightArm: ['RightArm', 'RightForearm', 'RightHand'],
  leftLeg: ['LeftLeg', 'LeftKnee', 'LeftFoot'], rightLeg: ['RightLeg', 'RightKnee', 'RightFoot'],
  head: ['Head', 'HeadJaw'],
});
// Bend ranges (radians) from straight. Elbows fold forward, knees back; wrists, ankles and the jaw just give a little.
export const HINGE_LIMITS = Object.freeze({
  elbow: [0, 2.35], wrist: [-.75, .75], knee: [0, 2.45], ankle: [-.45, .6], jaw: [-.04, .62],
});
const G = 15; // the shared remains use the same gravity, so a hinge and its bone fall together
const TIP_RADIUS = .028, DAMP = 1.6, SLEEP_FRAMES = 40;

function findBone(root, name) {
  let found = null;
  root.traverse(n => { if (n.name === name && (!found || n.isBone)) found = n; });
  return found;
}
/** The hinge chain for a detached part of this rig, or null. Every entry is {name, bone}. */
export function articulationChain(root, part) {
  const names = CHAINS[part]; if (!names) return null;
  const chain = names.map(name => ({name, bone: findBone(root, name)}));
  return chain.every(c => c.bone) ? chain : null;
}
/** Which chain segment owns a node: its own name or the nearest named ancestor. 0 (the rigid bone) otherwise. */
export function chainIndex(chain, node) {
  for (let n = node; n; n = n.parent) {
    const i = chain.findIndex(c => c.name === n.name);
    if (i >= 0) return i;
  }
  return 0;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _s = new THREE.Vector3(), _b = new THREE.Vector3(), _J = new THREE.Vector3(), _P = new THREE.Vector3();
const perpendicular = (v, axis) => v.addScaledVector(axis, -v.dot(axis));

// Farthest vertex from `from` among a segment's meshes, in the detached root frame (segments start unrotated).
function farthest(segment, offset, from) {
  let best = -1; const out = from.clone();
  segment.traverse(mesh => {
    if (!mesh.isMesh || mesh.parent !== segment) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).add(offset); const d = _v.distanceToSquared(from);
      if (d > best) { best = d; out.copy(_v); }
    }
  });
  return out;
}
function centroid(segment, offset) {
  const out = new THREE.Vector3(); let n = 0;
  segment.traverse(mesh => {
    if (!mesh.isMesh || mesh.parent !== segment) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { out.add(_v.fromBufferAttribute(p, i)); n++; }
  });
  return n ? out.divideScalar(n).add(offset) : null;
}

/**
 * Attach hinge state to a detached part. `segments[0]` is the detached root itself; segments[i] are unrotated
 * child groups placed at each joint. `root` is the posed source actor at the moment the bone came off.
 */
export function rigHinges(detached, segments, chain, part, root) {
  if (!chain || segments.length < 2) return null;
  root.updateWorldMatrix(true, true);
  const toLocal = _m.compose(detached.position, detached.quaternion, _v2.set(1, 1, 1)).invert().clone();
  const joint = chain.map(c => c.bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal));
  const offsets = []; for (let i = 0, o = new THREE.Vector3(); i < segments.length; i++) { if (i) o.add(segments[i].position); offsets.push(o.clone()); }
  const localDir = v => v.applyQuaternion(_q.copy(detached.quaternion).invert());
  const hinges = [];
  if (part === 'head') {
    // The jaw swings on its bone's own X axis, so gravity lets a dead skull gape.
    const axis = localDir(new THREE.Vector3(1, 0, 0).applyQuaternion(chain[1].bone.getWorldQuaternion(new THREE.Quaternion()))).normalize();
    const tip = centroid(segments[1], offsets[1]); if (!tip) return null;
    const s = perpendicular(tip.clone().sub(joint[1]), axis), length = s.length(); if (length < 1e-3) return null;
    s.normalize();
    // Opening swings the jaw away from the cranium, whichever way the rig's bone axis happens to point.
    const cranium = centroid(segments[0], offsets[0]), bend = new THREE.Vector3().crossVectors(axis, s);
    if (cranium && bend.dot(perpendicular(cranium.sub(joint[1]), axis)) > 0) { axis.negate(); bend.negate(); }
    hinges.push({segment: segments[1], parent: segments[0], axis, straight: s, bend, length: length * 1.4,
      limits: HINGE_LIMITS.jaw, rest: 0, theta: 0});
  } else {
    // Which way is "forward" for this skeleton: along its foot (the foot bone's Y axis runs heel to toe).
    const foot = findBone(root, 'LeftFoot') || findBone(root, 'RightFoot');
    const fwd = foot ? localDir(new THREE.Vector3(0, 1, 0).applyQuaternion(foot.getWorldQuaternion(new THREE.Quaternion()))) : localDir(new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
    const arm = part.endsWith('Arm'), names = arm ? ['elbow', 'wrist'] : ['knee', 'ankle'];
    const tips = [joint[2], farthest(segments[2], offsets[2], joint[2])];
    let straight = joint[1].clone().sub(joint[0]).normalize(), axis = null;
    for (let i = 1; i < 3; i++) {
      const dir = tips[i - 1].clone().sub(joint[i]), length = dir.length(); if (length < 1e-3) break;
      dir.normalize();
      if (!axis) {
        // Elbows fold toward the front, knees toward the back.
        const want = perpendicular(fwd.clone().multiplyScalar(arm ? 1 : -1), straight);
        if (want.lengthSq() < 1e-6) want.copy(perpendicular(dir.clone(), straight));
        if (want.lengthSq() < 1e-6) break;
        axis = new THREE.Vector3().crossVectors(straight, want.normalize()).normalize();
      }
      const s = perpendicular(straight.clone(), axis).normalize(), bend = new THREE.Vector3().crossVectors(axis, s);
      const d = perpendicular(dir.clone(), axis).normalize(), rest = Math.atan2(d.dot(bend), d.dot(s));
      const [lo, hi] = HINGE_LIMITS[names[i - 1]];
      hinges.push({segment: segments[i], parent: segments[i - 1], axis, straight: s, bend, length,
        limits: [Math.min(lo, rest), Math.max(hi, rest)], rest, theta: rest});
      straight = d; // the next hinge hangs straight on from this segment's rest direction
    }
  }
  if (!hinges.length) return null;
  detached.userData.hinges = hinges;
  return hinges;
}

/** Advance every hinge of one detached part. height(x, z) is the ground height. Returns true while anything moves. */
export function stepHinges(detached, dt, height = () => -Infinity) {
  const hinges = detached.userData.hinges; if (!hinges || !(dt > 0)) return false;
  dt = Math.min(dt, 1 / 30);
  detached.updateWorldMatrix(true, false);
  // Asleep while the bone lies still and its hinges have settled; any shove wakes it.
  const me = detached.matrixWorld.elements, last = detached.userData.hingeFrame;
  let moved = !last;
  if (last) for (let i = 0; i < 16; i++) if (Math.abs(me[i] - last[i]) > 1e-5) { moved = true; break; }
  if (moved) { (detached.userData.hingeFrame ||= new Float32Array(16)).set(me); detached.userData.hingeIdle = 0; }
  else if ((detached.userData.hingeIdle = (detached.userData.hingeIdle || 0) + 1) > SLEEP_FRAMES) return false;
  const damp = Math.exp(-DAMP * dt), g = G * dt * dt;
  for (const h of hinges) {
    h.parent.updateWorldMatrix(false, false);
    h.parent.getWorldQuaternion(_q);
    _a.copy(h.axis).applyQuaternion(_q); _s.copy(h.straight).applyQuaternion(_q); _b.copy(h.bend).applyQuaternion(_q);
    _J.copy(h.segment.position).applyMatrix4(h.parent.matrixWorld);
    if (!h.P) { h.P = _J.clone().addScaledVector(_s, Math.cos(h.theta) * h.length).addScaledVector(_b, Math.sin(h.theta) * h.length); h.prev = h.P.clone(); }
    // Verlet: carry on moving (a little friction in the joint), fall.
    _P.copy(h.P).sub(h.prev).multiplyScalar(damp); h.prev.copy(h.P); h.P.add(_P); h.P.y -= g;
    let theta = solve(h, _J);
    // The ground stops the tip; it skids a little rather than sliding on ice.
    const ground = height(h.P.x, h.P.z) + TIP_RADIUS;
    if (Number.isFinite(ground) && h.P.y < ground) { h.P.y = ground; h.prev.x += (h.P.x - h.prev.x) * .45; h.prev.z += (h.P.z - h.prev.z) * .45; if (h.prev.y < h.P.y) h.prev.y = h.P.y; theta = solve(h, _J); }
    h.theta = theta;
    h.segment.quaternion.setFromAxisAngle(h.axis, theta - h.rest);
    h.segment.updateMatrixWorld(true);
  }
  return true;
}
// Keep the tip on the hinge's circle and inside its bend range; returns the bend angle.
function solve(h, J) {
  _v.copy(h.P).sub(J); perpendicular(_v, _a);
  if (_v.lengthSq() < 1e-10) _v.copy(_s).multiplyScalar(Math.cos(h.theta)).addScaledVector(_b, Math.sin(h.theta));
  const theta = THREE.MathUtils.clamp(Math.atan2(_v.dot(_b), _v.dot(_s)), h.limits[0], h.limits[1]);
  h.P.copy(J).addScaledVector(_s, Math.cos(theta) * h.length).addScaledVector(_b, Math.sin(theta) * h.length);
  return theta;
}
