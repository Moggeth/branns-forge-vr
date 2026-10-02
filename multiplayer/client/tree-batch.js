// Instanced batches for INTACT trees: one InstancedMesh per (variant, level, authored part mesh), shared template
// geometry/material, so draw calls depend on variant/LOD/part counts and not on how many trees are planted.
// Slots are swap-removed; ids[slot] is the stable logical tree id, slotOf(id) the reverse map. Only changed slots are
// rewritten, and each flush uploads one contiguous dirty range per batch. Template geometry/materials are never disposed.
import * as T from 'three';

const tmp = new T.Matrix4(), nm = new T.Matrix3();

export function createTreeBatches({group, minCapacity = 64}) {
 const batches = new Map(), where = new Map(); let writes = 0, moves = 0;
 const keyOf = (variant, level) => variant + ':' + level;
 function makeMeshes(b, capacity) {
  return b.parts.map(p => { const im = new T.InstancedMesh(p.geometry, p.material, capacity); im.instanceMatrix.setUsage(T.DynamicDrawUsage); im.count = 0;
   im.name = `TreeBatch:${b.key}:${p.part}`; im.matrixAutoUpdate = false; im.userData.treeBatch = b; im.userData.part = p.part; group.add(im); return im; });
 }
 function batch(variant, level, kit) {
  const key = keyOf(variant, level); let b = batches.get(key); if (b) return b;
  const parts = []; for (const [part, list] of Object.entries(kit.parts)) for (const p of list) parts.push({part, geometry: p.geometry, material: p.material, matrix: p.matrix});
  b = {key, variant, level, parts, ids: [], capacity: minCapacity, dirtyMin: Infinity, dirtyMax: -1, roots: new Float32Array(minCapacity*16)};
  b.meshes = makeMeshes(b, b.capacity); b.trunks = b.meshes.filter(m => m.userData.part === 'Trunk'); batches.set(key, b); return b;
 }
 function grow(b) { // capacity doubling: new InstancedMeshes, copied matrices, old instance buffers released (geometry untouched)
  const cap = b.capacity*2, old = b.meshes, roots = new Float32Array(cap*16); roots.set(b.roots); b.roots = roots; b.capacity = cap; b.meshes = makeMeshes(b, cap);
  b.meshes.forEach((im, k) => { im.instanceMatrix.array.set(old[k].instanceMatrix.array); im.count = b.ids.length; }); for (const im of old) { im.removeFromParent(); im.dispose(); }
  b.trunks = b.meshes.filter(m => m.userData.part === 'Trunk'); b.dirtyMin = 0; b.dirtyMax = b.ids.length - 1;
 }
 const touch = (b, i) => { if (i < b.dirtyMin) b.dirtyMin = i; if (i > b.dirtyMax) b.dirtyMax = i; };
 // local (optional): {partName: Matrix4} applied between the root and the authored part matrix (cosmetic staged growth).
 // roots[] always keeps the plain mature root, so rootOf()/anchors never see transient growth.
 function write(b, i, root, local) { root.toArray(b.roots, i*16); for (let k = 0; k < b.meshes.length; k++) { const p = b.parts[k], l = local?.[p.part];
   (l ? tmp.multiplyMatrices(root, l).multiply(p.matrix) : tmp.multiplyMatrices(root, p.matrix)).toArray(b.meshes[k].instanceMatrix.array, i*16); } writes++; touch(b, i); }
 function remove(id) {
  const w = where.get(id); if (!w) return false; const b = w.batch, i = w.slot, last = b.ids.length - 1; where.delete(id);
  if (i !== last) { const moved = b.ids[last]; b.ids[i] = moved; where.get(moved).slot = i; b.roots.copyWithin(i*16, last*16, last*16 + 16);
   for (const im of b.meshes) im.instanceMatrix.array.copyWithin(i*16, last*16, last*16 + 16); touch(b, i); moves++; }
  b.ids.pop(); for (const im of b.meshes) im.count = b.ids.length; b.bounds = true; return true;
 }
 /** Add or update one intact tree. root: Tree-root matrix (trunk axis at ground, uniform scale). local: optional
  *  per-part-name Matrix4 map (tree-growth.js); omit for the exact mature authored shape. */
 function place(id, variant, level, kit, root, local = null) {
  let w = where.get(id); if (w && w.batch.key !== keyOf(variant, level)) { remove(id); w = null; }
  if (!w) { const b = batch(variant, level, kit); if (b.ids.length >= b.capacity) grow(b); w = {batch: b, slot: b.ids.length}; b.ids.push(id); where.set(id, w); for (const im of b.meshes) im.count = b.ids.length; }
  write(w.batch, w.slot, root, local); w.batch.bounds = true;
 }
 function flush() { // one contiguous update range per batch (bounded upload); lazily recomputed bounds for culling/raycast
  for (const b of batches.values()) { if (b.dirtyMax >= b.dirtyMin) { for (const im of b.meshes) { const a = im.instanceMatrix; a.clearUpdateRanges(); a.addUpdateRange(b.dirtyMin*16, (b.dirtyMax - b.dirtyMin + 1)*16); a.needsUpdate = true; } b.dirtyMin = Infinity; b.dirtyMax = -1; }
   if (b.bounds) { for (const im of b.meshes) im.boundingSphere = null; b.bounds = false; } }
 }
 /** Logical tree id for an InstancedMesh raycast hit, or null. */
 const idOf = hit => { const b = hit?.object?.userData?.treeBatch; return b && Number.isInteger(hit.instanceId) ? b.ids[hit.instanceId] ?? null : null; };
 /** World-space face normal for an instanced hit (face.normal is geometry-local). */
 function worldNormal(hit) { hit.object.getMatrixAt(hit.instanceId, tmp); tmp.premultiply(hit.object.matrixWorld); return hit.face.normal.clone().applyMatrix3(nm.getNormalMatrix(tmp)).normalize(); }
 function rootOf(id, out = new T.Matrix4()) { const w = where.get(id); return w ? out.fromArray(w.batch.roots, w.slot*16) : null; }
 function clear() { for (const b of batches.values()) for (const im of b.meshes) { im.removeFromParent(); im.dispose(); } batches.clear(); where.clear(); }
 return {place, remove, flush, idOf, worldNormal, rootOf, clear, dispose: clear, has: id => where.has(id),
  slotOf: id => { const w = where.get(id); return w ? {variant: w.batch.variant, level: w.batch.level, slot: w.slot, key: w.batch.key} : null; },
  targets: () => { const out = []; for (const b of batches.values()) if (b.ids.length) out.push(...b.trunks); return out; },
  batches: () => [...batches.values()], meshes: () => [...batches.values()].flatMap(b => b.meshes),
  counters: () => ({writes, moves}), resetCounters: () => { writes = 0; moves = 0; }};
}
