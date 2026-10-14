// Cottages, wells and lantern posts placed from the map editor's build menu (shared/map-extras.js), drawn from the
// back-town kit once it loads (the back-town view prepares the kit's materials first). Static scenery: built once,
// re-seated on the ground when terrain moves under it.
import * as THREE from 'three';
import {extraBuildings} from '../shared/map-extras.js';

export const EXTRA_KIT_NODES = Object.freeze({cottage: 'Cottage', cottageB: 'CottageB', well: 'Well', lantern: 'Lantern'});

/** One placed extra built from the kit's node map ('D_Cottage' -> Object3D), or null when the kit lacks it. */
export function buildExtraModel(nodes, extra) {
  const node = nodes.get(`${extra.style === 'rivals' ? 'G' : 'D'}_${EXTRA_KIT_NODES[extra.kind]}`);
  if (!node) return null;
  const g = new THREE.Group(), body = node.clone(true);
  body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); g.add(body);
  g.rotation.y = extra.yaw; g.name = `map-extra-${extra.id}`;
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

export function createMapExtrasView({scene, height}) {
  const root = new THREE.Group(); root.name = 'map-extras'; scene.add(root);
  const placed = extraBuildings();
  const built = [];
  function installKit(gltf) {
    if (!placed.length) return true;
    const nodes = new Map(); for (const o of gltf.scene.children) nodes.set(o.name, o);
    for (const e of placed) { const g = buildExtraModel(nodes, e); if (!g) continue; g.position.set(e.x, height(e.x, e.z), e.z); root.add(g); built.push([g, e]); }
    return true;
  }
  /** Re-seat every building on the ground (after terrain edits). */
  function settle() { for (const [g, e] of built) g.position.y = height(e.x, e.z); }
  return {installKit, settle, object: root, stats: () => ({placed: placed.length, built: built.length})};
}
