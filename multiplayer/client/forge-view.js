import * as THREE from 'three';

// Artist-authored metres/+Y/-Z assets; only the world placement turns toward spawn.
export function createForgeView() {
  const root = new THREE.Group();
  root.name = 'WayfarersForge';
  root.userData.targetId = 'shrine';
  root.visible = false;
  const lod = new THREE.LOD();
  lod.rotation.y = Math.PI;
  root.add(lod);
  const glow = [], models = new Map();
  let powered = true;
  function power(enabled) {
    powered = enabled;
    for (const {material, intensity} of glow) material.emissiveIntensity = enabled ? intensity : intensity * .04;
  }
  function install(gltf, distant = false) {
    const model = gltf.scene;
    model.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material.emissive?.getHex() && !glow.some(entry => entry.material === material))
          glow.push({material, intensity: material.emissiveIntensity});
      }
    });
    models.set(distant ? 'distant' : 'near', model);
    // Until both arrive, the available model serves every distance.
    for (const level of lod.levels) lod.remove(level.object);
    lod.levels.length = 0;
    lod.addLevel(models.get('near') || models.get('distant'), 0);
    if (models.size === 2) lod.addLevel(models.get('distant'), 24);
    power(powered);
  }
  function sync(anchor, height) {
    root.visible = !!anchor;
    if (!anchor) return;
    root.position.set(anchor.position[0], height, anchor.position[2]);
    power(anchor.hp > 0);
  }
  return {root, install, sync, stats() {return {loaded:models.size,level:lod.getCurrentLevel(),powered};}, get ready() {return models.size > 0;}};
}
