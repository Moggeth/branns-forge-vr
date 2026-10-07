import {Matrix4, SkinnedMesh} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// One-time template optimization, never a per-frame or per-actor rebuild. Keep gear,
// shields, named attachment nodes and bones independent. All authored vertex data
// and skin weights survive; damage/contact classification uses those weights.
const BODY = /^(Head|Torso|LeftArm|RightArm|LeftLeg|RightLeg)(?:_\d+)?$/;
const identity = new Matrix4();
export function mergeCreatureSkins(gltf) {
  const root = gltf.scene;
  // Clips could animate a mesh/group rather than its bones. Fail closed for new rigs.
  if (gltf.animations?.length) return 0;
  const groups = [];
  root.updateWorldMatrix(true, true);
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || mesh.children.length || Array.isArray(mesh.material) || mesh.material.transparent ||
        mesh.morphTargetInfluences?.length || !BODY.test(mesh.name)) return;
    for (let n = mesh; n !== root; n = n.parent) {
      if (!n || n.isBone || !n.visible || !n.matrix.equals(identity) || /^Gear_|^Shield/.test(n.name)) return;
    }
    const g = mesh.geometry;
    if (!g.index || g.drawRange.start !== 0 || g.drawRange.count !== Infinity || Object.keys(g.morphAttributes).length) return;
    const compatible = a => a.material === mesh.material && a.bindMode === mesh.bindMode && a.bindMatrix.equals(mesh.bindMatrix) &&
      a.castShadow === mesh.castShadow && a.receiveShadow === mesh.receiveShadow && a.layers.mask === mesh.layers.mask &&
      a.renderOrder === mesh.renderOrder && a.skeleton.bones.length === mesh.skeleton.bones.length &&
      a.skeleton.bones.every((b,i) => b === mesh.skeleton.bones[i] && a.skeleton.boneInverses[i].equals(mesh.skeleton.boneInverses[i]));
    let group = groups.find(group => compatible(group[0]));
    if (!group) groups.push(group = []);
    group.push(mesh);
  });
  let saved = 0;
  for (const group of groups) {
    if (group.length < 2) continue;
    const geometry = mergeGeometries(group.map(m => m.geometry), false);
    if (!geometry) continue; // incompatible future vertex layouts retain their original meshes
    const first = group[0], merged = new SkinnedMesh(geometry, first.material);
    merged.name = `BodyBatch_${first.material.name}`;
    merged.bindMode = first.bindMode;
    merged.bind(first.skeleton, first.bindMatrix);
    merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow;
    merged.layers.mask = first.layers.mask; merged.renderOrder = first.renderOrder;
    // Debug provenance is also useful for equivalence tests; no source geometry retained.
    merged.userData.mergedSources = group.map(m => ({name:m.name, vertices:m.geometry.attributes.position.count}));
    root.add(merged);
    for (const mesh of group) mesh.removeFromParent();
    saved += group.length - 1;
  }
  return saved;
}
