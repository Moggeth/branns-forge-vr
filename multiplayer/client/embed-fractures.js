import * as THREE from 'three';
// Small permanent bone/stone fracture motifs at arrow/bolt embed points.
// State holds up to 192 embeds (COMBAT_LIMITS.embeds, oldest evicted); each
// frame the 32 nearest visible ones are drawn through ONE InstancedMesh.
// Contract per embed (root computes anchor + local frame):
//   {embedId, targetId, part, anchor:Object3D, localPoint:[x,y,z],
//    localSurfaceNormal:[x,y,z], penetration:0..1 (or metres), seed:int,
//    material?:'bone'|'stone'}

export const FRACTURE_LIMITS = Object.freeze({state: 192, visible: 32});
const TINT = {bone: new THREE.Color(0x3b2816), stone: new THREE.Color(0x17130f)};

function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296); }

// Flat hairline star in the XY plane (normal +Z), unit radius. Jagged
// tapered branches with a couple of forks; zero thickness so it sits flush.
export function buildFractureGeometry(seed = 7, branches = 6) {
  const r = rng(seed), pos = [];
  const tri = (ax, ay, bx, by, w0, w1) => {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    pos.push(ax + nx * w0, ay + ny * w0, 0, ax - nx * w0, ay - ny * w0, 0, bx + nx * w1, by + ny * w1, 0,
      ax - nx * w0, ay - ny * w0, 0, bx - nx * w1, by - ny * w1, 0, bx + nx * w1, by + ny * w1, 0);
  };
  const crack = (x, y, angle, length, width, depth) => {
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      angle += (r() - .5) * .9; const seg = length / steps;
      const nx = x + Math.cos(angle) * seg, ny = y + Math.sin(angle) * seg, w1 = width * (1 - (i + 1) / (steps + .4));
      tri(x, y, nx, ny, width * (1 - i / (steps + .4)), w1);
      if (depth > 0 && i === 1 && r() < .7) crack(nx, ny, angle + (r() < .5 ? -1 : 1) * (.5 + r() * .5), length * .45, w1, depth - 1);
      x = nx; y = ny;
    }
  };
  // Small crushed pit at the impact itself.
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, b = (i + 1) / 5 * Math.PI * 2, k = .12 + r() * .05; pos.push(0, 0, 0, Math.cos(a) * k, Math.sin(a) * k, 0, Math.cos(b) * k, Math.sin(b) * k, 0); }
  for (let i = 0; i < branches; i++) crack(0, 0, i / branches * Math.PI * 2 + r() * .6, .6 + r() * .4, .055, 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere(); return g;
}

export function createEmbedFractures({camera, visible = FRACTURE_LIMITS.visible, limit = FRACTURE_LIMITS.state, radius = .075} = {}) {
  const geometry = buildFractureGeometry();
  const material = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4});
  const mesh = new THREE.InstancedMesh(geometry, material, visible);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1;
  mesh.name = 'ranged-embed-fractures'; mesh.userData.ignoreContact = true;
  mesh.setColorAt(0, TINT.bone);
  const embeds = new Map(); // insertion order = age
  const order = []; // scratch, reused
  const z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3(), lp = new THREE.Vector3(), wp = new THREE.Vector3(), cam = new THREE.Vector3();
  const lq = new THREE.Quaternion(), spin = new THREE.Quaternion(), aq = new THREE.Quaternion(), as = new THREE.Vector3(), ap = new THREE.Vector3(), m = new THREE.Matrix4(), sc = new THREE.Vector3();

  function add(e) {
    if (!e || e.embedId == null || !e.anchor) return false;
    if (embeds.has(e.embedId)) embeds.delete(e.embedId); // re-add refreshes age
    while (embeds.size >= limit) embeds.delete(embeds.keys().next().value);
    // Orientation fixed at impact in the anchor's local frame, so it persists through bone/limb motion.
    n.fromArray(e.localSurfaceNormal || [0, 0, 1]); if (n.lengthSq() < 1e-10) n.set(0, 0, 1); n.normalize();
    const r = rng(e.seed ?? 1), pen = THREE.MathUtils.clamp(e.penetration ?? .5, 0, 1);
    const local = new THREE.Quaternion().setFromUnitVectors(z, n).multiply(spin.setFromAxisAngle(z, r() * Math.PI * 2));
    const size = radius * (.7 + .6 * pen) * (.85 + r() * .3);
    embeds.set(e.embedId, {id: e.embedId, targetId: e.targetId, part: e.part, anchor: e.anchor, point: new THREE.Vector3().fromArray(e.localPoint), quaternion: local,
      size, squash: .75 + r() * .4, tint: TINT[e.material] || TINT.bone, distance: 0});
    return true;
  }
  const remove = id => embeds.delete(id);
  const removeTarget = targetId => { for (const [id, e] of embeds) if (e.targetId === targetId) embeds.delete(id); };
  // Root calls when a limb detaches so cracks follow the detached anchor.
  function reanchor(targetId, part, anchor) { for (const e of embeds.values()) if (e.targetId === targetId && (part == null || e.part === part)) e.anchor = anchor; }
  const shown = a => { for (let o = a; o; o = o.parent) if (!o.visible) return false; return !!a.parent || a.isScene; };

  function update(viewer = camera) {
    if (!viewer) { mesh.count = 0; return 0; }
    viewer.updateWorldMatrix(true, false);
    viewer.getWorldPosition(cam); order.length = 0;
    for (const e of embeds.values()) {
      if (!shown(e.anchor)) continue;
      e.anchor.updateWorldMatrix(true, false);
      wp.copy(e.point).applyMatrix4(e.anchor.matrixWorld); e.distance = wp.distanceToSquared(cam); order.push(e);
    }
    if (order.length > visible) order.sort((a, b) => a.distance - b.distance);
    const count = Math.min(visible, order.length);
    for (let i = 0; i < count; i++) {
      const e = order[i];
      e.anchor.matrixWorld.decompose(ap, aq, as);
      wp.copy(e.point).applyMatrix4(e.anchor.matrixWorld);
      lq.copy(aq).multiply(e.quaternion);
      n.set(0, 0, 1).applyQuaternion(lq); wp.addScaledVector(n, .0015);
      sc.set(e.size, e.size * e.squash, 1);
      m.compose(wp, lq, sc); mesh.setMatrixAt(i, m); mesh.setColorAt(i, e.tint);
    }
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return count;
  }
  function clear() { embeds.clear(); mesh.count = 0; }
  function dispose() { clear(); mesh.removeFromParent(); geometry.dispose(); material.dispose(); mesh.dispose(); }
  return {object: mesh, add, remove, removeTarget, reanchor, update, clear, dispose, embeds, drawCalls: 1};
}
