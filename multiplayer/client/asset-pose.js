import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

// Engine contract: metres, +Y up, -Z forward. Model axes are independently
// authored facts, never inferred from a bounding box or camera angle.
export const ASSET_POSES = Object.freeze({
  skeleton: {forward: [0, 0, 1], up: [0, 1, 0], pivot: 'feet', height: 1.7},
  pick: {forward: [1, 0, 0], up: [0, 1, 0], pivot: 'Grip', height: .75},
  axe: {forward: [1, 0, 0], up: [0, 1, 0], pivot: 'Grip_Center', height: 0.7},
  tree_b: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'feet', height: 4},
  tree_young: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'feet', height: 4},
  tree: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'feet', height: 4},
});

export function assetBasis(contract) {
  const forward = new THREE.Vector3(...contract.forward).normalize();
  const up = new THREE.Vector3(...contract.up).normalize();
  if (forward.lengthSq() < .99 || up.lengthSq() < .99 || Math.abs(forward.dot(up)) > 1e-6)
    throw new Error('Asset forward/up must be nonzero perpendicular axes');
  const back = forward.clone().negate();
  const right = up.clone().cross(back);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back)).invert();
}

export function prepareAsset(template, name, height = ASSET_POSES[name]?.height) {
  const contract = ASSET_POSES[name];
  if (!contract || !(height > 0)) throw new Error(`Unreviewed asset pose: ${name}`);
  const model = clone(template.scene);
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!(size.y > .001)) throw new Error(`Invalid asset bounds: ${name}`);
  const pivot = new THREE.Vector3(0, bounds.min.y, 0);
  if (contract.pivot === 'bounds') {
    pivot.x = (bounds.min.x + bounds.max.x) / 2;
    pivot.z = (bounds.min.z + bounds.max.z) / 2;
  } else if (contract.pivot !== 'feet') {
    const socket = model.getObjectByName(contract.pivot);
    if (!socket) throw new Error(`Missing ${name} socket ${contract.pivot}`);
    socket.getWorldPosition(pivot);
  }
  // Keep conversion OUTSIDE the animated hierarchy. Animation tracks must not
  // overwrite units/pivot/basis; asymmetric shields must not recenter the actor.
  const normalization = new THREE.Group();
  const factor = height / size.y;
  normalization.scale.setScalar(factor);
  normalization.position.copy(pivot).multiplyScalar(-factor);
  normalization.add(model);
  const visual = new THREE.Group();
  visual.name = `${name}:canonical`;
  visual.quaternion.copy(assetBasis(contract));
  visual.add(normalization);
  return {visual, model};
}

// Separate presentation transforms from the canonical asset basis. Both XR
// hands use the same unmirrored model; gripSpace is the attachment origin.
export function setWeaponGrip(visual, xr = false, tool = 'axe') {
  visual.position.set(0, 0, 0);
  visual.quaternion.copy(assetBasis(ASSET_POSES[tool]));
  if (xr) visual.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 4));
}

export const FPS_WEAPON_POSE = Object.freeze({position: [.33, -.38, -.48], rotation: [-.2, .55, .12]});
