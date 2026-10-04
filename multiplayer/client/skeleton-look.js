import * as THREE from 'three';
import {hashId} from './enemy-motion.js';
import {skeletonKindIndex} from '../shared/skeleton-kinds.js';

// Skeleton warband: six authored archetypes on one rig (assets/skeleton-warband-20261004/build_skeleton.py), like the
// Siegebird songbirds. Each skeleton keeps its archetype's headgear and shield, drops the rest, and takes the
// archetype's bone, cloth and eye colours plus a small personal jitter. Everything derives from the enemy id, so every
// peer sees the same skeleton.
export const SKELETON_VARIANTS = Object.freeze([
  {id: 'mossward', name: 'Mossward', gear: ['Gear_MossCap', 'Gear_MossRag', 'Shield_Kite'], bone: [1, .98, .94], cloth: [.36, .5, .22], eyes: [.35, 1, .55]},
  {id: 'rustguard', name: 'Rustguard', gear: ['Gear_IronHelm', 'Gear_Pauldron', 'Shield_Round'], bone: [.93, .9, .84], cloth: [.56, .22, .14], eyes: [1, .62, .22]},
  {id: 'thornhood', name: 'Thornhood', gear: ['Gear_Hood', 'Shield_Heater'], bone: [.96, .96, .93], cloth: [.34, .25, .33], eyes: [.42, .72, 1]},
  {id: 'oldbones', name: 'Old Bones', gear: ['Gear_Cracks', 'Shield_Buckler'], bone: [.8, .69, .5], cloth: [.6, .52, .4], eyes: [.32, .75, .38]},
  {id: 'bloomcaller', name: 'Bloomcaller', gear: ['Gear_FlowerCrown', 'Shield_Living'], bone: [1, 1, .97], cloth: [.62, .7, .5], eyes: [1, .86, .42]},
  {id: 'antlerbound', name: 'Antlerbound', gear: ['Gear_Antlers', 'Shield_Tower'], bone: [.88, .78, .62], cloth: [.3, .36, .2], eyes: [.3, .95, .85]},
]);
const OPTIONAL = /^(Gear|Shield)_/;
const unit = (seed, n) => { let h = Math.imul(seed ^ Math.imul(n, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

export function skeletonVariant(id) {
  const seed = hashId(id);
  return {index: skeletonKindIndex(id), seed, scale: .95 + unit(seed, 1) * .1, shade: .95 + unit(seed, 2) * .08};
}

// Shared per-archetype material clones (bounded: 6 archetypes x 3 materials per template).
const looks = new WeakMap();
function lookMaterial(source, v, shade) {
  let byVariant = looks.get(source); if (!byVariant) looks.set(source, byVariant = new Map());
  const key = v.id + ':' + shade.toFixed(2);
  let m = byVariant.get(key); if (m) return m;
  m = source.clone(); m.name = source.name;
  if (source.name === 'Bone') m.color.setRGB(v.bone[0] * shade, v.bone[1] * shade, v.bone[2] * shade);
  else if (source.name === 'Cloth') m.color.setRGB(...v.cloth);
  else if (source.name === 'EyeGlow') { m.emissive.setRGB(...v.eyes); m.emissiveIntensity = .9; m.color.setRGB(v.eyes[0] * .12, v.eyes[1] * .12, v.eyes[2] * .12); }
  byVariant.set(key, m); return m;
}

// Call on the cloned visual before it is shown. index overrides the id-derived archetype (studios, reviews).
export function dressSkeleton(visual, id = 0, index) {
  const pick = typeof id === 'number' && index === undefined ? {index: id, seed: id * 7919, scale: 1, shade: 1} : skeletonVariant(id);
  if (index !== undefined) pick.index = index;
  const v = SKELETON_VARIANTS[((pick.index % SKELETON_VARIANTS.length) + SKELETON_VARIANTS.length) % SKELETON_VARIANTS.length];
  const drop = [];
  // Multi-material meshes load as a Group named after the authored object with _1, _2 primitive children.
  visual.traverse(n => { if (OPTIONAL.test(n.name) && !v.gear.includes(n.name.replace(/_\d+$/, '')) && !OPTIONAL.test(n.parent?.name || '')) drop.push(n); });
  for (const n of drop) n.removeFromParent();
  const shade = Math.round(pick.shade * 50) / 50;
  visual.traverse(n => {
    if (!n.isMesh) return;
    if (Array.isArray(n.material)) n.material = n.material.map(m => /^(Bone|Cloth|EyeGlow)$/.test(m.name) ? lookMaterial(m, v, shade) : m);
    else if (/^(Bone|Cloth|EyeGlow)$/.test(n.material?.name)) n.material = lookMaterial(n.material, v, shade);
  });
  const norm = visual.children[0];
  if (norm && pick.scale !== 1) norm.scale.multiplyScalar(pick.scale), norm.position.multiplyScalar(pick.scale);
  visual.userData.skeletonLook = {variant: v.id, index: pick.index, seed: pick.seed};
  steadyBounds(visual);
  return v;
}
// three.js measures a skinned mesh's culling sphere once, in whatever pose it is first drawn. A summoned skeleton is
// first drawn buried by the crawl-out, so its legs kept a sphere two metres underground and vanished whenever the
// ground below them left the view. Every part gets one sphere around the whole standing body instead.
const _box = new THREE.Box3(), _sphere = new THREE.Sphere(), _toVisual = new THREE.Matrix4(), _toMesh = new THREE.Matrix4();
function steadyBounds(visual) {
  const meshes = []; visual.traverse(n => { if (n.isSkinnedMesh) meshes.push(n); }); if (!meshes.length) return;
  visual.updateWorldMatrix(true, true); const inv = _toVisual.copy(visual.matrixWorld).invert(); _box.makeEmpty();
  for (const m of meshes) { m.computeBoundingSphere(); _sphere.copy(m.boundingSphere).applyMatrix4(_toMesh.multiplyMatrices(inv, m.matrixWorld)); _box.expandByPoint(_sphere.center.clone().addScalar(_sphere.radius)).expandByPoint(_sphere.center.clone().addScalar(-_sphere.radius)); }
  _box.getBoundingSphere(_sphere); _sphere.radius *= 1.25; // reach, lean and a stagger stay inside
  for (const m of meshes) m.boundingSphere.copy(_sphere).applyMatrix4(_toMesh.multiplyMatrices(inv, m.matrixWorld).invert());
}
export function prepareSkeletonTemplate() {}

// A splintered shield is gone for good (shared/combat.js shieldBroken). Hidden meshes drop out of contacts and of
// the detached-arm snapshot, so arrows pass and a severed arm carries no ghost shield.
export function setShieldBroken(visual, broken) {
  const look = visual?.userData.skeletonLook; if (!look || look.shieldBroken === broken) return;
  look.shieldBroken = broken;
  visual.traverse(n => { if (/^Shield_/.test(n.name)) n.visible = !broken; });
}
