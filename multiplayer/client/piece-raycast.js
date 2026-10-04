// Keep a merged draw while testing only the individual pieces crossed by a ray.
// Ranges use the original non-indexed vertex offsets: faceIndex/target IDs and
// Three's exact material-side/triangle/UV tests remain unchanged.
export function installPieceRaycast(T, mesh, pieces) {
 const original = mesh.raycast, inverse = new T.Matrix4(), localRay = new T.Ray();
 const entry = new T.Vector3(), worldEntry = new T.Vector3();
 mesh.raycast = function(raycaster, hits) {
  inverse.copy(this.matrixWorld).invert(); localRay.copy(raycaster.ray).applyMatrix4(inverse);
  const geometry = this.geometry, box = geometry.boundingBox;
  const {start, count} = geometry.drawRange, end = start + count;
  try {
   for (const piece of pieces) {
    if (!piece.box.containsPoint(localRay.origin)) {
     if (!localRay.intersectBox(piece.box, entry)) continue;
     worldEntry.copy(entry).applyMatrix4(this.matrixWorld);
     if (worldEntry.distanceTo(raycaster.ray.origin) > raycaster.far + 1e-7) continue;
    }
    const first = Math.max(start, piece.start), last = Math.min(end, piece.start + piece.count);
    if (last <= first) continue;
    geometry.boundingBox = piece.box; geometry.setDrawRange(first, last - first);
    original.call(this, raycaster, hits);
   }
  } finally { geometry.boundingBox = box; geometry.setDrawRange(start, count); }
 };
}
