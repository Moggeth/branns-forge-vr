import {Mesh, Matrix4} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Only remote axe/pick/hammer templates use this. Their whole weapon moves at
// the grip; bows, reload mechanisms, liquids and skinned assets are excluded.
// Retain named grip/tip nodes. Merge exact triangles only in the same local frame
// (local-position material effects must keep their coordinates), grouped
// by material identity. No decimation, material substitutions or extra textures.
export function batchRigidWeapon(gltf) {
  if (gltf.animations?.length) return {gltf, dispose() {}, savedDraws: 0};
  const scene = gltf.scene.clone(true), groups = new Map(), owned = [];
  scene.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(scene.matrixWorld).invert();
  scene.traverseVisible(node => {
    if (!node.isMesh || node.isSkinnedMesh || node.isInstancedMesh || Array.isArray(node.material) ||
        node.geometry.morphAttributes.position?.length || node.geometry.groups.length > 1 ||
        node.material.transparent || Object.hasOwn(node.material,'onBeforeRender') || !new Matrix4().multiplyMatrices(inverse,node.matrixWorld).equals(new Matrix4())) return;
    const layout=Object.entries(node.geometry.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|');
    const key = `${layout}|${!!node.geometry.index}|${node.material.uuid}|${node.castShadow}|${node.receiveShadow}|${node.renderOrder}|${node.layers.mask}`;
    const list = groups.get(key) || []; list.push(node); groups.set(key,list);
  });
  let savedDraws = 0;
  for (const nodes of groups.values()) {
    if (nodes.length < 2) continue;
    const pieces = nodes.map(n => n.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse,n.matrixWorld)));
    const geometry = mergeGeometries(pieces, false); pieces.forEach(g=>g.dispose());
    if (!geometry) continue;
    const first = nodes[0], mesh = new Mesh(geometry, first.material);
    mesh.name = 'RemoteRigidBatch'; mesh.castShadow=first.castShadow; mesh.receiveShadow=first.receiveShadow;
    mesh.renderOrder=first.renderOrder; mesh.layers.mask=first.layers.mask;
    for (const node of nodes) node.visible = false;
    scene.add(mesh); owned.push(geometry); savedDraws += nodes.length-1;
  }
  // The template's hierarchy is rigid; parent grip motion still propagates normally.
  scene.traverse(n=>{n.updateMatrix(); n.matrixAutoUpdate=false;});
  return {gltf:{...gltf,scene}, savedDraws, dispose(){owned.forEach(g=>g.dispose());}};
}
