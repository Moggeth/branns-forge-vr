// Dawnhold's troops: the skeleton rig re-dressed as stone-and-brass forgelings with
// blue crystal eyes, and Dawnhold golems with blue resonance crystals. Combat surfaces,
// parts and animation stay those of the shared rigs; only materials and gear change.
import * as THREE from 'three';

const cache = new Map();
function shared(name, make) { if (!cache.has(name)) cache.set(name, make()); return cache.get(name); }
const LOOK = {
  Bone: () => new THREE.MeshStandardMaterial({name: 'ForgelingStone', color: 0xa89a82, roughness: .88, flatShading: false}),
  Cloth: () => new THREE.MeshStandardMaterial({name: 'ForgelingCloth', color: 0x2f6fd0, roughness: .9}),
  Fabric: () => new THREE.MeshStandardMaterial({name: 'ForgelingFabric', color: 0x24508f, roughness: .9}),
  Iron: () => new THREE.MeshStandardMaterial({name: 'ForgelingBrass', color: 0xc49a52, roughness: .42, metalness: .55}),
  Wood: () => new THREE.MeshStandardMaterial({name: 'ForgelingWood', color: 0x8a6440, roughness: .8}),
  EyeGlow: () => new THREE.MeshStandardMaterial({name: 'ForgelingEye', color: 0x9fd8ff, emissive: 0x5fb4ff, emissiveIntensity: 2.4}),
  Crystal: () => new THREE.MeshStandardMaterial({name: 'DawnCrystal', color: 0x5fa8ff, emissive: 0x3f8fff, emissiveIntensity: 1.6, roughness: .25}),
  Stone: () => new THREE.MeshStandardMaterial({name: 'DawnStone', color: 0xb5a78f, roughness: .9}),
};
const GOLEM = new Set(['Crystal', 'Iron']), SKELETON = new Set(['Bone', 'Cloth', 'Fabric', 'Iron', 'Wood', 'EyeGlow']);
const swap = (m, allowed) => {
  const key = (m?.name || '').replace(/^(\w+?)(\.\d+)?$/, '$1');
  return allowed.has(key) && LOOK[key] ? shared(key, LOOK[key]) : m;
};

/** Re-dresses a party battle bot. Returns true when the look changed. */
export function dressForgeling(visual, kind) {
  if (!visual || visual.userData.forgeling) return false;
  const allowed = kind === 'golem' ? GOLEM : SKELETON;
  visual.traverse(n => {
    if (!n.isMesh) return;
    n.material = Array.isArray(n.material) ? n.material.map(m => swap(m, allowed)) : swap(n.material, allowed);
  });
  visual.userData.forgeling = true;
  return true;
}
