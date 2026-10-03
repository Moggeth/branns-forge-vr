import * as THREE from 'three';
// Subtle pooled flight streaks drawn *behind* the existing arrow/bolt meshes.
// One InstancedMesh (1 draw) for every arrow and bolt; additive vertex-colour
// fade (dark tail = invisible), no lights, no bloom-sized missiles.

// Identity: Emberwing arrow = long warm ember-gold wisp with soft head glint;
// Siegebird bolt = short, tight, pale bone-steel dart line.
export const STREAK_STYLE = Object.freeze({
  arrow: {color: 0xf3b25e, length: .55, perSpeed: .018, width: .018, max: 1.1},
  bolt: {color: 0xdcd4c2, length: .32, perSpeed: .006, width: .011, max: .6},
  // Golden Siegebird bolt (quad damage): a longer, brighter gold comet.
  golden: {color: 0xffc845, length: .7, perSpeed: .016, width: .03, max: 1.4},
});

// Crossed ribbons along +Z (head at z=0, tail at z=-1), so streaks read from
// every side including VR without camera-facing math. Head vertices brighter
// than the tail, with a tiny overbright glint band right behind the head.
export function buildStreakGeometry() {
  const rows = [[0, .0, 1.0], [-.06, 1.0, 1.35], [-.25, .55, .55], [-1, 0, 0]]; // z, halfWidthScale, brightness
  const pos = [], col = [], idx = [];
  for (const plane of [0, 1]) {
    const base = pos.length / 3;
    for (const [z, w, b] of rows) for (const side of [-1, 1]) {
      pos.push(plane ? side * w * .5 : 0, plane ? 0 : side * w * .5, z); col.push(b, b * .92, b * .8);
    }
    for (let r = 0; r < rows.length - 1; r++) { const i = base + r * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); return g;
}

export function createProjectileStreaks({capacity = 96} = {}) { // COMBAT_LIMITS.projectiles
  const geometry = buildStreakGeometry();
  const material = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: true});
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
  mesh.name = 'ranged-projectile-streaks'; mesh.userData.ignoreContact = true;
  mesh.setColorAt(0, new THREE.Color()); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const colors = {arrow: new THREE.Color(STREAK_STYLE.arrow.color), bolt: new THREE.Color(STREAK_STYLE.bolt.color), golden: new THREE.Color(STREAK_STYLE.golden.color).multiplyScalar(1.6)};
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), v = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1), dim = new THREE.Color();

  // projectiles: snapshot.projectiles (or the rendered interpolated subset).
  // Uses rendered position if positionOf(data) is given, else data.position.
  // hidden: optional Set of projectile ids already reported as hits.
  function update(projectiles, {positionOf = null, hidden = null} = {}) {
    let n = 0;
    for (const data of projectiles || []) {
      if (n >= capacity) break;
      const look = data.golden && data.kind === 'bolt' ? 'golden' : data.kind, style = STREAK_STYLE[look]; if (!style || hidden?.has(data.id)) continue;
      v.fromArray(data.velocity); const speed = v.length(); if (speed < 1) continue;
      positionOf ? p.copy(positionOf(data)) : p.fromArray(data.position);
      q.setFromUnitVectors(z, v.multiplyScalar(1 / speed));
      const length = Math.min(style.max, style.length + speed * style.perSpeed);
      // Fade in over the first ~4 ticks so the streak never covers the bow at release.
      const born = data.trail?.length ?? 16, fade = Math.min(1, born / 4);
      s.set(style.width, style.width, length * fade);
      m.compose(p, q, s); mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, dim.copy(colors[look]).multiplyScalar(.55 + .45 * fade)); n++;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return n;
  }
  function dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); mesh.dispose(); }
  return {object: mesh, update, dispose, capacity, drawCalls: 1};
}
