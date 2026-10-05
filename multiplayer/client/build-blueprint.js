// Blueprint ghost for building placement: a see-through copy of the real model with glowing edges.
// Presentation only. It never validates or writes; the caller passes the shared validator's verdict each frame.
import * as THREE from 'three';
import {createInventionModel} from './invention-art.js';

export const BLUEPRINT_COLORS = Object.freeze({
  valid: {fill: 0x4fb4ff, edge: 0xa6e4ff, ring: 0x7fd0ff},
  invalid: {fill: 0xff4f43, edge: 0xffa196, ring: 0xf06458},
});

/**
 * createBlueprintGhost({scene, timberlineReady, timberline}) -> {show({type, position, yaw, valid, dt, time}), hide(), stats(), dispose()}
 * timberline: () => the authored Timberline {object, dispose}, called once timberlineReady() says its glTF has loaded.
 * The ghost eases towards the target every frame so snapped tiles glide instead of popping.
 */
export function createBlueprintGhost({scene, timberlineReady = () => false, timberline = () => null}) {
  const fill = new THREE.MeshBasicMaterial({color: BLUEPRINT_COLORS.valid.fill, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide});
  const edge = new THREE.LineBasicMaterial({color: BLUEPRINT_COLORS.valid.edge, transparent: true, opacity: .9, depthWrite: false});
  const root = new THREE.Group(); root.name = 'build-blueprint'; root.visible = false; root.renderOrder = 15; scene.add(root);
  const models = new Map(), edgeCache = new Map();
  let current = null, currentType = null, valid = true, placed = false, appear = 0;
  const target = new THREE.Vector3();

  function edgesFor(geometry) {
    let e = edgeCache.get(geometry);
    if (!e) { e = new THREE.EdgesGeometry(geometry, 32); edgeCache.set(geometry, e); }
    return e;
  }
  function blueprint(object) {
    const meshes = [];
    object.traverse(o => { if (o.isMesh) meshes.push(o); else if (o.isLine || o.isPoints || o.isSprite) o.visible = false; });
    for (const mesh of meshes) {
      mesh.material = fill; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 15;
      // Instanced or skinned parts would need their own edge passes; a plain fill is enough for those.
      if (mesh.geometry && !mesh.isInstancedMesh && !mesh.isSkinnedMesh) {
        const lines = new THREE.LineSegments(edgesFor(mesh.geometry), edge);
        lines.renderOrder = 16; lines.raycast = () => {}; mesh.add(lines);
      }
      mesh.raycast = () => {};
    }
    return object;
  }
  function model(type) {
    let m = models.get(type);
    if (m && !(m.placeholder && timberlineReady())) return m;
    if (m) { m.dispose?.(); m.object.removeFromParent(); }
    let object, dispose = null, placeholder = false;
    const authored = type === 'timberline' && timberlineReady() ? timberline() : null;
    if (authored) { object = authored.object; dispose = () => authored.dispose?.(); }
    else { try { object = createInventionModel(type); } catch { object = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 1.6, 12).translate(0, .8, 0)); dispose = () => object.geometry.dispose(); } placeholder = type === 'timberline'; }
    blueprint(object); object.visible = false; root.add(object);
    m = {object, dispose, placeholder}; models.set(type, m);
    return m;
  }
  function tint(ok) {
    if (ok === valid) return;
    valid = ok; const c = ok ? BLUEPRINT_COLORS.valid : BLUEPRINT_COLORS.invalid;
    fill.color.setHex(c.fill); edge.color.setHex(c.edge);
  }
  return {
    show({type, position, yaw = 0, valid: ok = true, dt = 1 / 60, time = 0}) {
      if (!type || !position) { this.hide(); return; }
      if (type !== currentType) { if (current) current.object.visible = false; current = model(type); currentType = type; placed = false; appear = 0; }
      else if (current.placeholder && timberlineReady()) { current.object.visible = false; current = model(type); }
      current.object.visible = true; root.visible = true; tint(ok);
      target.set(position[0], position[1], position[2]);
      // Ease towards the aim (fast enough to feel attached, smooth across tile snaps); jump on first show or long hops.
      if (!placed || root.position.distanceToSquared(target) > 36) { root.position.copy(target); root.rotation.y = yaw; placed = true; }
      else {
        const k = 1 - Math.exp(-dt * 28);
        root.position.lerp(target, k);
        root.rotation.y += Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y)) * (1 - Math.exp(-dt * 22));
      }
      appear = Math.min(1, appear + dt * 6);
      const breathe = .5 + .5 * Math.sin(time * 3.2);
      fill.opacity = (ok ? .16 + .08 * breathe : .24 + .06 * breathe) * appear;
      edge.opacity = (ok ? .7 + .25 * breathe : .85) * appear;
      root.scale.set(1, .92 + .08 * appear, 1);
    },
    hide() { root.visible = false; placed = false; appear = 0; },
    get object() { return root; },
    stats: () => ({visible: root.visible, type: currentType, valid, position: root.position.toArray(), yaw: root.rotation.y, edgeSets: edgeCache.size}),
    dispose() {
      for (const m of models.values()) { m.dispose?.(); m.object.removeFromParent(); }
      models.clear(); for (const e of edgeCache.values()) e.dispose(); edgeCache.clear();
      fill.dispose(); edge.dispose(); root.removeFromParent();
    },
  };
}
