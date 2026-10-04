import * as THREE from 'three';
// Emberwing phoenix flight presentation: per-frame arrow prediction and wing contrails.
//
// Snapshots arrive at the network rate, so a curved arrow drawn from the last snapshot plus a straight-line
// extrapolation turns in visible steps. predictArrow() re-runs the authoritative step (shared/combat.js
// stepCombat: curl fraction, drag, gravity, trapezoid position) for the fraction of a tick since the snapshot,
// so the flight and its heading curve every frame. Presentation only: hits still come from the host's sweep.

const DT = 1 / 60, GRAVITY = {arrow: 5.8, bolt: 3, fuel: 15, flame: 5.2}, DRAG = Math.exp(-.045 * DT);
const fraction = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t / .85)), 3);

// data: {kind, position, velocity, curve, bornTick}; tick: snapshot tick; ticks: fractional ticks ahead.
export function predictArrow(data, tick, ticks, outPosition, outVelocity) {
  let px = data.position[0], py = data.position[1], pz = data.position[2];
  let vx = data.velocity[0], vy = data.velocity[1], vz = data.velocity[2];
  const curve = data.curve || [0, 0, 0], len = Math.hypot(curve[0], curve[1], curve[2]), g = GRAVITY[data.kind] ?? 3;
  const ax = len > 1e-6 ? curve[0] / len : 0, ay = len > 1e-6 ? curve[1] / len : 0, az = len > 1e-6 ? curve[2] / len : 0;
  const whole = Math.floor(Math.max(0, ticks)), part = Math.max(0, ticks) - whole;
  for (let k = 0; k <= whole; k++) {
    const share = k < whole ? 1 : part; if (share <= 0) break;
    // The next authoritative step is tick+k+1, whose age is (tick + k - bornTick) * dt.
    const age = (tick + k - data.bornTick) * DT;
    let wx = vx, wy = vy, wz = vz;
    if (len > 1e-6) {
      const angle = len * (fraction(age + DT) - fraction(age)) * share, c = Math.cos(angle), s = Math.sin(angle);
      const dot = ax * vx + ay * vy + az * vz, cx = ay * vz - az * vy, cy = az * vx - ax * vz, cz = ax * vy - ay * vx;
      wx = vx * c + cx * s + ax * dot * (1 - c); wy = vy * c + cy * s + ay * dot * (1 - c); wz = vz * c + cz * s + az * dot * (1 - c);
    }
    const drag = share === 1 ? DRAG : Math.pow(DRAG, share);
    const nx = wx * drag, ny = wy * drag - g * DT * share, nz = wz * drag;
    px += (vx + nx) * .5 * DT * share; py += (vy + ny) * .5 * DT * share; pz += (vz + nz) * .5 * DT * share;
    vx = nx; vy = ny; vz = nz;
  }
  outPosition.set(px, py, pz); outVelocity?.set(vx, vy, vz);
  return outPosition;
}

// ------------------------------------------------------------------ contrails
// Two thin light ribbons streaming from the phoenix wing tips while the wings are out. One pooled, camera-
// facing triangle-strip mesh (1 draw, additive, no lights); trails outlive their arrow until they fade.
export const CONTRAIL = Object.freeze({life: .32, samples: 22, trails: 16, width: .012, spread: .06, minStep: .045, brightness: .6});

export function createPhoenixContrails({capacity = CONTRAIL.trails, samples = CONTRAIL.samples} = {}) {
  const verts = capacity * samples * 2;
  const position = new Float32Array(verts * 3), color = new Float32Array(verts * 3);
  const index = new Uint16Array(capacity * (samples - 1) * 6);
  for (let t = 0, o = 0; t < capacity; t++) for (let i = 0; i < samples - 1; i++, o += 6) {
    const a = (t * samples + i) * 2; index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], o);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: true});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'emberwing-contrails'; mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.userData.ignoreContact = true;
  // key -> {points: [{p: Vector3, t}], live}
  const trails = new Map(), pool = [];
  const head = new THREE.Color(0xfff4d8), mid = new THREE.Color(0xffb347), tail = new THREE.Color(0xd9461c), tmp = new THREE.Color();
  const side = new THREE.Vector3(), along = new THREE.Vector3(), view = new THREE.Vector3(), cam = new THREE.Vector3();
  let clock = 0;
  // Record a wing tip this frame. strength 0..1 scales the light (wings folding away dim their trails).
  function emit(key, point, strength = 1) {
    let trail = trails.get(key);
    if (!trail) { if (trails.size >= capacity) return; trail = {points: [], strength}; trails.set(key, trail); }
    trail.live = true; trail.strength = strength;
    const last = trail.points[trail.points.length - 1];
    if (last && last.p.distanceToSquared(point) < CONTRAIL.minStep * CONTRAIL.minStep) { last.p.copy(point); last.t = clock; last.s = strength; return; }
    const sample = pool.pop() || {p: new THREE.Vector3(), t: 0, s: 1};
    sample.p.copy(point); sample.t = clock; sample.s = strength; trail.points.push(sample);
    if (trail.points.length > samples) pool.push(trail.points.shift());
  }
  function update(dt, camera) {
    clock += dt; let n = 0;
    if (camera) camera.getWorldPosition(cam);
    for (const [key, trail] of trails) {
      while (trail.points.length && clock - trail.points[0].t > CONTRAIL.life) pool.push(trail.points.shift());
      if (!trail.points.length) { trails.delete(key); continue; }
      trail.live = false;
      const pts = trail.points, count = pts.length; if (count < 2) continue;
      for (let i = 0; i < samples; i++) {
        const sample = pts[Math.min(i, count - 1)], v = (n * samples + i) * 2;
        const prev = pts[Math.max(0, Math.min(i, count - 1) - 1)].p, next = pts[Math.min(count - 1, i + 1)].p;
        along.subVectors(next, prev); if (along.lengthSq() < 1e-10) along.set(0, 0, 1);
        view.subVectors(cam, sample.p); side.crossVectors(along, view); if (side.lengthSq() < 1e-10) side.set(0, 1, 0);
        // Age 0 at the wing tip: thin and bright; it widens and cools as it drifts back, then fades out.
        const age = Math.min(1, (clock - sample.t) / CONTRAIL.life), fade = (1 - age) * (1 - age) * sample.s;
        const width = (CONTRAIL.width + CONTRAIL.spread * age) * .5, rise = .12 * age * age;
        side.normalize().multiplyScalar(width);
        const live = i < count ? 1 : 0;
        if (age < .35) tmp.copy(head).lerp(mid, age / .35); else tmp.copy(mid).lerp(tail, (age - .35) / .65);
        // Fresh samples ease in so the trail never starts as a hard bar at the wing.
        const ease = Math.min(1, (count - 1 - Math.min(i, count - 1)) / 2 + .35);
        tmp.multiplyScalar(fade * live * ease * CONTRAIL.brightness);
        for (let s = 0; s < 2; s++) {
          const o = (v + s) * 3, sign = s ? 1 : -1;
          position[o] = sample.p.x + side.x * sign; position[o + 1] = sample.p.y + side.y * sign + rise; position[o + 2] = sample.p.z + side.z * sign;
          color[o] = tmp.r; color[o + 1] = tmp.g; color[o + 2] = tmp.b;
        }
      }
      n++;
    }
    geometry.setDrawRange(0, n * (samples - 1) * 6);
    for (const name of ['position', 'color']) { const a = geometry.attributes[name]; a.clearUpdateRanges(); a.addUpdateRange(0, n * samples * 6); a.needsUpdate = true; }
    mesh.visible = n > 0;
    return n;
  }
  function dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); trails.clear(); }
  return {object: mesh, emit, update, dispose, stats: () => ({trails: trails.size, drawCalls: mesh.visible ? 1 : 0}), capacity};
}
