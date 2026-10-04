// Startup-only representatives for shader variants absent from an intact forest.
// Share the real runtime materials/textures; own only temporary carved geometry
// and instance buffers. No snapshots, hits, particles or sound events are emitted.
import * as T from 'three';
import {VARIANTS, TREE_PROFILES, notchFor} from '../shared/trees.js';
import {buildNotch, buildFelled, buildTimberSection, toGeometry} from './tree-carve.js';

export function createTreeHarvestWarmup({kits, woodMaterial, uvMap, decorate, pools = []}) {
 const started = performance.now(), group = new T.Group(); group.name = 'TreeHarvestWarmup';
 const geometries = [], instances = [], timings = []; let disposed = false;
 const addCarved = (parent, piece, kit) => {
  for (const [triangles, material, colored] of [[piece.bark, kit.trunkMaterial, kit.trunkColor], [piece.wood, woodMaterial, true]]) {
   if (!triangles.length || !material) continue;
   const geometry = toGeometry(triangles, colored); geometries.push(geometry);
   const mesh = new T.Mesh(geometry, material); mesh.frustumCulled = false; parent.add(mesh);
  }
 };
 try {
  if (woodMaterial) for (const [variant, name] of VARIANTS.entries()) {
   const kit = kits.get(name); if (!kit) continue;
   const start = performance.now(), root = new T.Group(); root.position.set(variant * 4 - 4, 0, -4); group.add(root);
   const tree = {variant, height: TREE_PROFILES[name].height};
   // Exercise both CPU carving paths during loading. Ordinary non-instanced
   // meshes use a different shader from the standing forest's InstancedMeshes.
   const notch = notchFor(tree, {cutHeight: 1, cuts: 1, fallYaw: .4}, 0);
   addCarved(root, buildNotch(kit.trunk, notch, uvMap), kit);
   for (const [part, meshes] of Object.entries(kit.parts)) if (part !== 'Trunk') for (const p of meshes) {
    const mesh = decorate(new T.Mesh(p.geometry, p.material)); mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(p.matrix); mesh.frustumCulled = false; root.add(mesh);
   }
   const notchMs = performance.now() - start, fellStarted = performance.now();
   const felled = buildFelled(kit.trunk, notchFor(tree, {cutHeight: 1, cuts: 2, fallYaw: .4}, 0), uvMap);
   const fallen = new T.Group(); fallen.position.set(0, 0, -3); root.add(fallen);
   addCarved(fallen, felled.stump, kit); addCarved(fallen, felled.top, kit);
   addCarved(fallen, buildTimberSection(felled.top, 1.1, 1.7, uvMap, notch.radius), kit);
   timings.push({variant: name, notchMs, fellAndLogMs: performance.now() - fellStarted});
  }
  // Pools start count=0 or invisible. One visible representative forces the
  // exact instancing/instance-color shader and buffer path before the first hit.
  for (const source of pools) {
   if (!source?.isInstancedMesh) continue;
   const mesh = new T.InstancedMesh(source.geometry, source.material, 1);
   mesh.name = `warm-${source.name || 'wood-chips'}`; mesh.frustumCulled = false;
   mesh.customDepthMaterial = source.customDepthMaterial; mesh.customDistanceMaterial = source.customDistanceMaterial;
   mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
   mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(0, 1, -2));
   if (source.instanceColor) mesh.setColorAt(0, new T.Color(0xffffff));
   instances.push(mesh); group.add(mesh);
  }
 } catch (error) { dispose(); throw error; }
 function dispose() {
  if (disposed) return; disposed = true; group.removeFromParent();
  for (const geometry of geometries) geometry.dispose();
  for (const mesh of instances) mesh.dispose();
  group.clear();
 }
 return {group, dispose, stats: {variants: timings, geometryCount: geometries.length, poolCount: instances.length, prepareMs: performance.now() - started}};
}
