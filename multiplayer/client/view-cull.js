// Shared "can the player see this at all?" test for presentation work that is expensive and pointless off-screen
// (mixers, IK, forced matrix rebuilds). Callers keep their own state ticking and only skip the posing, so a thing
// that comes back into view is posed correctly on that same frame, before it is drawn. The sphere is generous on
// purpose: nothing at the edge of the screen may ever be caught mid-skip.
import * as THREE from 'three';

const frustum = new THREE.Frustum(), clip = new THREE.Matrix4(), sphere = new THREE.Sphere(), eye = new THREE.Vector3();
let lastCamera = null, lastStamp = NaN;

// radius: metres around the object's origin (lifted by `lift` on +Y); maxDistance: beyond this the detail is a few
// pixels and is treated as unseen. With no camera everything counts as seen.
export function inView(camera, object, {radius = 6, lift = 0, maxDistance = Infinity} = {}) {
  if (!camera) return true;
  const e = camera.matrixWorldInverse.elements, stamp = e[12] + e[13] * 3.1 + e[14] * 7.7 + e[2] * 11.3 + e[6] * 13.9 + camera.projectionMatrix.elements[0];
  if (camera !== lastCamera || stamp !== lastStamp) { frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); lastCamera = camera; lastStamp = stamp; }
  object.getWorldPosition(sphere.center).y += lift; sphere.radius = radius;
  if (maxDistance !== Infinity && camera.getWorldPosition(eye).distanceTo(sphere.center) - radius > maxDistance) return false;
  return frustum.intersectsSphere(sphere);
}

// Ray prefilter for the aim probe. The probe raycasts recursively into every structure, home-base part and keep
// (hundreds of meshes) ten times a second, though its ray is only 8 m long. Each root's world bounding sphere is
// cached and rebuilt when the root moves or gains/loses children, so roots that cannot be within reach are skipped
// before three walks them. Spheres get a margin for parts that swing inside their root (turret heads, gates).
const reachCache = new WeakMap(), box = new THREE.Box3(), toCenter = new THREE.Vector3();
export const RAY_PREFILTER = Object.freeze({margin: 1.5});
function rootSphere(root) {
  const e = root.matrixWorld.elements, key = `${e[12]},${e[13]},${e[14]},${e[0]},${e[2]},${root.children.length}`;
  let c = reachCache.get(root);
  if (!c || c.key !== key) {
    box.setFromObject(root); // geometry bounds, conservative and cheap
    c = {key, sphere: box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere())};
    reachCache.set(root, c);
  }
  return c.sphere;
}
export function rootsNearRay(roots, origin, direction, far) {
  const out = [];
  for (const root of roots) {
    const s = rootSphere(root); if (!s) continue;
    const r = s.radius + RAY_PREFILTER.margin;
    toCenter.subVectors(s.center, origin); const along = toCenter.dot(direction);
    if (along < -r || along > far + r) continue;
    if (toCenter.lengthSq() - along * along > r * r) continue;
    out.push(root);
  }
  return out;
}
