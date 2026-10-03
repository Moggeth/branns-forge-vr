import * as THREE from 'three';
// Emberwing curved-draw forecast. The integrator mirrors shared/combat.js
// stepCombat() term for term (dt, curl fraction, drag, gravity, trapezoid
// position, lifetime and +/-55 bounds). No aim assist: it only draws the path.

export const RANGED_DT = 1 / 60;
const GRAVITY = Object.freeze({arrow: 5.8, flame: 5.2, fuel: 15, bolt: 3});
const LIFE = Object.freeze({flame: 48, fuel: 180, arrow: 480, bolt: 480});

// Same shot the weapon controller's end() would send for the current aim.
// curveBase is the controller's latched direction (null when not curving).
export function bowShotFromAim(aimDirection, curveBase, draw, out = {direction: [0, 0, 0], curve: [0, 0, 0], speed: 0}) {
  const d = new THREE.Vector3().fromArray(aimDirection).normalize();
  if (curveBase) {
    const base = new THREE.Vector3().fromArray(curveBase).normalize();
    const angle = Math.min(1.1, Math.acos(THREE.MathUtils.clamp(base.dot(d), -1, 1)));
    const c = new THREE.Vector3().crossVectors(base, d);
    if (c.lengthSq() > 1e-8) c.normalize().multiplyScalar(angle); else c.set(0, 0, 0);
    base.toArray(out.direction); c.toArray(out.curve);
  } else { d.toArray(out.direction); out.curve[0] = out.curve[1] = out.curve[2] = 0; }
  out.speed = 18 + 18 * Math.max(.2, draw ?? .67);
  return out;
}

// Integrates one projectile. Writes xyz samples into `out` (Float32Array) every
// `sampleEvery` ticks plus the final point. `hit(from, to)` is the root's world
// query (terrain/enemy/prop) returning {point:[x,y,z], normal?:[x,y,z]} or null.
// `terrainHeight(x,z)` optionally mirrors the authoritative under-terrain cull.
// Returns {count, ticks, hit, reason}; reason: 'hit'|'terrain'|'bounds'|'life'|'capacity'.
const _from = [0, 0, 0], _to = [0, 0, 0];
export function forecastTrajectory({origin, velocity, curve = [0, 0, 0], kind = 'arrow', out, sampleEvery = 3, hit = null, terrainHeight = null, maxTicks = LIFE[kind] ?? 480}) {
  const cap = Math.floor(out.length / 3), g = GRAVITY[kind] ?? 3, dt = RANGED_DT, drag = Math.exp(-.045 * dt);
  let px = origin[0], py = origin[1], pz = origin[2], vx = velocity[0], vy = velocity[1], vz = velocity[2];
  const len = Math.hypot(curve[0], curve[1], curve[2]);
  const ax = len > 1e-6 ? curve[0] / len : 0, ay = len > 1e-6 ? curve[1] / len : 0, az = len > 1e-6 ? curve[2] / len : 0;
  const fraction = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t / .85)), 3);
  let count = 0; out[0] = px; out[1] = py; out[2] = pz; count = 1;
  for (let k = 0; k < maxTicks; k++) {
    const age = k * dt; // server: (tick - bornTick - 1) * dt on the k+1th step
    let wx = vx, wy = vy, wz = vz;
    if (len > 1e-6) {
      const angle = len * (fraction(age + dt) - fraction(age)), c = Math.cos(angle), s = Math.sin(angle);
      const dot = ax * vx + ay * vy + az * vz, cx = ay * vz - az * vy, cy = az * vx - ax * vz, cz = ax * vy - ay * vx;
      wx = vx * c + cx * s + ax * dot * (1 - c); wy = vy * c + cy * s + ay * dot * (1 - c); wz = vz * c + cz * s + az * dot * (1 - c);
    }
    const nx = wx * drag, ny = wy * drag - g * dt, nz = wz * drag;
    // Server averages the *pre-curl* stored velocity with the new one.
    const qx = px + (vx + nx) * .5 * dt, qy = py + (vy + ny) * .5 * dt, qz = pz + (vz + nz) * .5 * dt;
    vx = nx; vy = ny; vz = nz;
    let reason = null, contact = null;
    if (hit) { _from[0] = px; _from[1] = py; _from[2] = pz; _to[0] = qx; _to[1] = qy; _to[2] = qz; contact = hit(_from, _to); if (contact) reason = 'hit'; }
    px = qx; py = qy; pz = qz;
    if (!reason && (Math.abs(px) > 55 || Math.abs(pz) > 55)) reason = 'bounds';
    if (!reason && terrainHeight && py < terrainHeight(px, pz) - .5) reason = 'terrain';
    const last = reason || k === maxTicks - 1;
    if (last || (k + 1) % sampleEvery === 0) {
      if (count >= cap) return {count, ticks: k + 1, hit: null, reason: 'capacity'};
      const p = contact?.point;
      out[count * 3] = p ? p[0] : px; out[count * 3 + 1] = p ? p[1] : py; out[count * 3 + 2] = p ? p[2] : pz; count++;
    }
    if (reason) return {count, ticks: k + 1, hit: contact, reason};
  }
  return {count, ticks: maxTicks, hit: null, reason: 'life'};
}

function dotTexture() {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + .5 - n / 2, y + .5 - n / 2) / (n / 2), a = Math.max(0, Math.min(1, (1 - r) * 3));
    const i = (y * n + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(data, n, n); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; return t;
}

// Two draws: one Points dot chain (gold → ember fade) and one flush hit ring.
// Root may pass precomputed authoritative points via setPoints() instead of
// calling update(); both reuse the same preallocated buffers.
export function createTrajectoryGuide({maxPoints = 192, color = 0xecd29a, tail = 0xf08a3c, dotSize = .032} = {}) {
  const positions = new Float32Array(maxPoints * 3), colors = new Float32Array(maxPoints * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const map = dotTexture();
  const material = new THREE.PointsMaterial({size: dotSize, map, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, toneMapped: false});
  const dots = new THREE.Points(geometry, material); dots.frustumCulled = false; dots.renderOrder = 2; dots.userData.ignoreContact = true;
  const ringGeometry = new THREE.RingGeometry(.07, .095, 20);
  const ringMaterial = new THREE.MeshBasicMaterial({color, transparent: true, opacity: .75, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false});
  const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.visible = false; ring.userData.ignoreContact = true;
  const group = new THREE.Group(); group.name = 'emberwing-trajectory'; group.add(dots, ring); group.visible = false;
  const a = new THREE.Color(color), b = new THREE.Color(tail), c = new THREE.Color(), z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3();
  const shot = {direction: [0, 0, 0], curve: [0, 0, 0], speed: 0}, velocity = [0, 0, 0];

  function setPoints(points, count, contact = null) {
    count = Math.min(count, maxPoints);
    if (points !== positions) positions.set(points.subarray ? points.subarray(0, count * 3) : points.slice(0, count * 3));
    for (let i = 0; i < count; i++) {
      // Fade in over the first ~0.4-1.4 m so the guide never sits on the bow/reticle.
      const t = count > 1 ? i / (count - 1) : 0, near = Math.hypot(positions[i * 3] - positions[0], positions[i * 3 + 1] - positions[1], positions[i * 3 + 2] - positions[2]);
      const alpha = Math.min(1, Math.max(0, near - .4)) * (1 - t * .65) * .85;
      c.copy(a).lerp(b, t); colors[i * 4] = c.r; colors[i * 4 + 1] = c.g; colors[i * 4 + 2] = c.b; colors[i * 4 + 3] = alpha;
    }
    geometry.setDrawRange(0, count);
    geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    ring.visible = !!contact && count > 0;
    if (ring.visible) {
      ring.position.fromArray(contact.point);
      n.fromArray(contact.normal || [0, 1, 0]); if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
      ring.quaternion.setFromUnitVectors(z, n.normalize()); ring.position.addScaledVector(n, .004);
    }
    group.visible = count > 1;
  }
  // Convenience: local forecast from the live aim (same equation as server).
  function update({origin, aimDirection, curveBase, draw, hit = null, terrainHeight = null, sampleEvery = 1}) {
    bowShotFromAim(aimDirection, curveBase, draw, shot);
    for (let i = 0; i < 3; i++) velocity[i] = shot.direction[i] * shot.speed;
    const r = forecastTrajectory({origin, velocity, curve: shot.curve, kind: 'arrow', out: positions, sampleEvery, hit, terrainHeight});
    setPoints(positions, r.count, r.hit); return r;
  }
  function hide() { group.visible = false; ring.visible = false; geometry.setDrawRange(0, 0); }
  function dispose() { group.removeFromParent(); geometry.dispose(); material.dispose(); map.dispose(); ringGeometry.dispose(); ringMaterial.dispose(); }
  return {object: group, update, setPoints, hide, dispose, buffer: positions, maxPoints, drawCalls: 2};
}

// Guide only appears during a curved Emberwing draw, never in God/menus/XR-off-hand states.
export const shouldShowTrajectory = ({tool, role = 'hero', menuOpen = false, drawing, curved}) => role === 'hero' && !menuOpen && tool === 'bow' && !!drawing && !!curved;
