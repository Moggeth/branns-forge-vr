import {clone} from 'three/addons/utils/SkeletonUtils.js';

// SkeletonUtils correctly clones joints, but creates a separate Skeleton for
// every mesh primitive. glTF bodies commonly use the SAME joints/inverse binds
// across many primitives. Share that palette within this fresh actor only: Three
// then updates and uploads it once per frame, including the shadow pass.
// Mesh bind matrices, geometry, materials, names and individual visibility stay
// untouched. Never share a palette between independently animated actors.
export function cloneSkinnedAsset(source) {
  const result = clone(source), buckets = new Map();
  result.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const skeleton = mesh.skeleton;
    const key = skeleton.bones.map(bone => bone?.uuid ?? 'missing').join('|');
    let candidates = buckets.get(key);
    if (!candidates) buckets.set(key, candidates = []);
    const same = candidates.find(other => other.boneInverses.length === skeleton.boneInverses.length &&
      other.boneInverses.every((inverse, i) => inverse.equals(skeleton.boneInverses[i])));
    if (same) mesh.skeleton = same;
    else candidates.push(skeleton);
  });
  return result;
}
