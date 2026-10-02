import * as THREE from 'three';

// Conservative rejection bounds, NOT hitboxes. Every candidate still raycasts
// the actual posed triangles. A normalized skin vertex is a convex combination
// of its weighted bone transforms, hence lies inside their transformed union.
// Build bind-local bone envelopes once per shared geometry/bind layout, then
// update O(bones), rather than CPU-skinning every vertex for every hover frame.
const shared = new WeakMap(), records = new WeakMap();
const p = new THREE.Vector3(), box = new THREE.Box3(), matrix = new THREE.Matrix4();
function envelopes(mesh) {
  let record = records.get(mesh);
  if (record?.geometry === mesh.geometry) return record.boxes;
  const geometry = mesh.geometry, indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  if (!indices || !weights || geometry.morphAttributes.position?.length) return null;
  const signature = mesh.bindMatrix.elements.join(',') + '|' + mesh.skeleton.boneInverses.map(m=>m.elements.join(',')).join(';');
  let layouts = shared.get(geometry); if (!layouts) shared.set(geometry, layouts = new Map());
  let boxes = layouts.get(signature);
  if (!boxes) {
    boxes = mesh.skeleton.bones.map(()=>new THREE.Box3());
    for (let v=0; v<geometry.attributes.position.count; v++) {
      let sum=0;
      for (let c=0;c<4;c++) {
        const weight=weights.getComponent(v,c); sum+=weight;
        if (weight<0) return null;
        if (!weight) continue;
        const bone=indices.getComponent(v,c); if (!boxes[bone]) return null;
        p.fromBufferAttribute(geometry.attributes.position,v).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[bone]);
        boxes[bone].expandByPoint(p);
      }
      if (Math.abs(sum-1)>1e-5) return null; // unnormalised skin needs exact fallback
    }
    layouts.set(signature,boxes);
  }
  records.set(mesh,{geometry,boxes}); return boxes;
}
export function updateSkinBounds(mesh) {
  const boxes=envelopes(mesh);
  if (!boxes) { mesh.computeBoundingBox(); return mesh.boundingBox; }
  mesh.boundingBox ||= new THREE.Box3(); mesh.boundingBox.makeEmpty();
  for (let b=0;b<boxes.length;b++) if (!boxes[b].isEmpty()) {
    matrix.multiplyMatrices(mesh.bindMatrixInverse,mesh.skeleton.bones[b].matrixWorld);
    mesh.boundingBox.union(box.copy(boxes[b]).applyMatrix4(matrix));
  }
  return mesh.boundingBox;
}
