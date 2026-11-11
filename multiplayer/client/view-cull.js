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
