// Settlements, discoveries and cave mouths of a generated world, built from the Blender kits (shared/worldgen/places.js
// says what stands where; the simulation collides with the same pieces). Presentation only: pieces stream in around
// the view focus, mill sails turn, lanterns glow at night through their emissive materials. Until a kit arrives its
// pieces are simply not drawn (no placeholder clutter).
import * as THREE from 'three';
import {placesFor} from '../shared/worldgen/places.js';

const NEAR = 420, FAR = 520; // stream in / out radii (m)

export function createWildsPlacesView({scene, height}) {
  const root = new THREE.Group(); root.name = 'wilds-places'; root.visible = false; scene.add(root);
  const kits = {town: null, backtown: null, landmarks: null};
  const live = new Map(); // piece id -> {group, sails}
  let world = null, pieces = [], lastAt = [NaN, NaN], kitRev = 0, builtRev = -1;
  function installKit(name, sceneRoot) {
    const nodes = new Map();
    if (name === 'landmarks') { sceneRoot.updateMatrixWorld(true); sceneRoot.traverse(o => { if (o.isMesh && !nodes.has(o.name)) nodes.set(o.name, o); }); }
    else for (const o of sceneRoot.children) nodes.set(o.name, o);
    kits[name] = nodes; kitRev++;
  }
  function make(p) {
    const nodes = kits[p.kit]; if (!nodes) return null;
    const src = nodes.get(p.node); if (!src) return null;
    const g = new THREE.Group(), body = src.clone(true);
    if (p.kit === 'landmarks') { body.position.set(0, 0, 0); body.quaternion.copy(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(src.matrixWorld))); body.scale.setFromMatrixScale(src.matrixWorld); }
    else { body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); }
    g.add(body);
    let sails = null;
    if (p.node === 'D_Mill') {
      const s = nodes.get('D_MillSails'), c = nodes.get('D_MillCrank'), hub = body.getObjectByName('D_Mill_Hub')?.position, crank = body.getObjectByName('D_Mill_Crank')?.position;
      if (s) { sails = s.clone(true); sails.position.copy(hub || new THREE.Vector3(0, 7.2, 2.3)); sails.rotation.set(0, 0, 0); g.add(sails); }
      if (c) { const k = c.clone(true); k.position.copy(crank || new THREE.Vector3(-2, 0, 3)); k.rotation.set(0, 0, 0); g.add(k); }
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.ignoreContact = true; } });
    g.position.set(p.x, height(p.x, p.z) + (p.lift || 0) - .05, p.z); g.rotation.y = p.yaw; g.name = p.id;
    root.add(g);
    return {group: g, sails, spin: .25 + (p.x * 7 % 1 + 1) % 1 * .2};
  }
  function setWorld(next) {
    for (const e of live.values()) root.remove(e.group);
    live.clear(); world = next; pieces = world ? placesFor(world) : []; lastAt = [NaN, NaN]; root.visible = !!world;
  }
  function update(focus, dt) {
    if (!world) return;
    for (const e of live.values()) if (e.sails) e.sails.rotation.z -= e.spin * dt;
    if (builtRev === kitRev && Math.hypot(focus.x - lastAt[0], focus.z - lastAt[1]) < 24) return;
    if (builtRev !== kitRev) { for (const e of live.values()) root.remove(e.group); live.clear(); builtRev = kitRev; }
    lastAt = [focus.x, focus.z];
    for (const p of pieces) {
      const d2 = (p.x - focus.x) * (p.x - focus.x) + (p.z - focus.z) * (p.z - focus.z), have = live.get(p.id);
      if (!have && d2 < NEAR * NEAR) { const e = make(p); if (e) live.set(p.id, e); }
      else if (have && d2 > FAR * FAR) { root.remove(have.group); live.delete(p.id); }
    }
  }
  return {root, installKit, setWorld, update, stats: () => ({pieces: pieces.length, live: live.size, kits: Object.keys(kits).filter(k => kits[k])})};
}
