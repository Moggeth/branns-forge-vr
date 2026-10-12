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
// Flame ribbons streaming from the phoenix wing tips while the wings are out. One pooled, camera-facing
// mesh (1 draw, no lights); trails outlive their arrow until they fade.
//
// Each sample is a row of four vertices, not two: a solid flame band down the middle with the outer pair
// at zero alpha, so the ribbon has soft edges instead of reading as a flat bar. The ribbon also licks:
// every sample carries a seed that waves it across its own width and lifts it as it cools, so the trail
// behaves like flame coming off a wing rather than a clean contrail. Ember motes shed from the cooling
// half of each trail and drift up (a second pooled draw) — the wing is on fire, and it sheds.
export const CONTRAIL = Object.freeze({life: .34, samples: 24, trails: 16, width: .055, spread: .26, minStep: .04,
  brightness: .95, core: .45, lick: .045, rise: .22, motes: 160, moteRate: 26, moteLife: .8, moteSize: .11});
// Offsets across the ribbon and the alpha at each: the middle two columns are the solid flame, and the
// outer pair sits at zero alpha, so the band fades out at its edges instead of ending on a hard line.
const COLUMN_OFFSET = [-1, -CONTRAIL.core, CONTRAIL.core, 1], COLUMN_LIGHT = [0, 1, 1, 0], COLUMNS = 4;
// Three quads span the four columns of each segment.
const SEGMENT_INDICES = (COLUMNS - 1) * 6;

// Soft round spark, built in code so the module stays loadable under Node (tests) with no image decode.
let sharedMote = null;
function moteTexture(size = 32) {
  if (sharedMote) return sharedMote;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - Math.hypot(dx, dy)), 2.4));
  }
  sharedMote = new THREE.DataTexture(data, size, size); sharedMote.needsUpdate = true;
  sharedMote.colorSpace = THREE.SRGBColorSpace; return sharedMote;
}

export function createPhoenixContrails({capacity = CONTRAIL.trails, samples = CONTRAIL.samples} = {}) {
  const verts = capacity * samples * COLUMNS;
  const position = new Float32Array(verts * 3), color = new Float32Array(verts * 4);
  const index = new Uint16Array(capacity * (samples - 1) * SEGMENT_INDICES);
  for (let t = 0, o = 0; t < capacity; t++) for (let i = 0; i < samples - 1; i++) {
    const a = (t * samples + i) * COLUMNS;
    for (let c = 0; c < COLUMNS - 1; c++, o += 6) {
      const l = a + c, r = l + COLUMNS; index.set([l, r, l + 1, l + 1, r, r + 1], o);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.setDrawRange(0, 0);
  // Painted, not additive: adding light onto a bright sky or a sunlit field washes every warm hue out to
  // lemon. The ribbon carries its own colour with per-vertex alpha instead, so the flame stays orange in
  // daylight and still glows against a night sky.
  const material = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: true});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'emberwing-contrails'; mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.userData.ignoreContact = true;

  // Ember motes: sparks shed from the cooling half of the ribbon, drifting up as they die (1 draw).
  const moteGeometry = new THREE.BufferGeometry();
  const motePosition = new Float32Array(CONTRAIL.motes * 3), moteColor = new Float32Array(CONTRAIL.motes * 4);
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePosition, 3).setUsage(THREE.DynamicDrawUsage));
  moteGeometry.setAttribute('color', new THREE.BufferAttribute(moteColor, 4).setUsage(THREE.DynamicDrawUsage));
  const moteMaterial = new THREE.PointsMaterial({size: CONTRAIL.moteSize, vertexColors: true, transparent: true,
    depthWrite: false, toneMapped: false, sizeAttenuation: true, map: moteTexture()});
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  motes.name = 'emberwing-contrail-motes'; motes.frustumCulled = false; motes.renderOrder = 2; motes.userData.ignoreContact = true;
  mesh.add(motes); // one object for the caller to add and dispose; motes keep their own draw
  const live = []; // {p, v, age, life, seed}
  const motePool = [];

  // key -> {points: [{p, t, s, seed}], live}
  const trails = new Map(), pool = [];
  // Gold to orange, never red: a thin red at partial alpha over sunlit grass reads as a brown smear.
  const head = new THREE.Color(0xfff6d0), mid = new THREE.Color(0xffbc30), tail = new THREE.Color(0xff7a14), tmp = new THREE.Color();
  const side = new THREE.Vector3(), along = new THREE.Vector3(), view = new THREE.Vector3(), cam = new THREE.Vector3();
  const lift = new THREE.Vector3(), place = new THREE.Vector3();
  let clock = 0, seeded = 0, moteDebt = 0;
  // Record a wing tip this frame. strength 0..1 scales the light (wings folding away dim their trails).
  function emit(key, point, strength = 1) {
    let trail = trails.get(key);
    if (!trail) { if (trails.size >= capacity) return; trail = {points: [], strength}; trails.set(key, trail); }
    trail.live = true; trail.strength = strength;
    const last = trail.points[trail.points.length - 1];
    if (last && last.p.distanceToSquared(point) < CONTRAIL.minStep * CONTRAIL.minStep) { last.p.copy(point); last.t = clock; last.s = strength; return; }
    const sample = pool.pop() || {p: new THREE.Vector3(), t: 0, s: 1, seed: 0};
    sample.p.copy(point); sample.t = clock; sample.s = strength; sample.seed = (seeded = (seeded * 9301 + 49297) % 233280) / 233280 * Math.PI * 2;
    trail.points.push(sample);
    if (trail.points.length > samples) pool.push(trail.points.shift());
  }
  // Shed a spark from a point on the ribbon that has started to cool.
  function shed(point, strength) {
    if (live.length >= CONTRAIL.motes) return;
    const mote = motePool.pop() || {p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, seed: 0};
    mote.p.copy(point); mote.age = 0; mote.seed = Math.random() * Math.PI * 2;
    mote.life = CONTRAIL.moteLife * (.55 + .45 * Math.random()) * strength;
    mote.v.set((Math.random() - .5) * .7, .5 + Math.random() * 1.1, (Math.random() - .5) * .7);
    live.push(mote);
  }
  function updateMotes(dt) {
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const mote = live[i]; mote.age += dt;
      if (mote.age >= mote.life) { live.splice(i, 1); motePool.push(mote); continue; }
      // Embers slow, float up on their own heat, and wander.
      mote.v.multiplyScalar(Math.exp(-2.1 * dt)); mote.v.y += 1.35 * dt;
      mote.p.addScaledVector(mote.v, dt);
      mote.p.x += Math.sin(mote.age * 7 + mote.seed) * .22 * dt;
      const k = 1 - mote.age / mote.life, o = n * 3, c = n * 4;
      motePosition[o] = mote.p.x; motePosition[o + 1] = mote.p.y; motePosition[o + 2] = mote.p.z;
      // A spark glows white-hot, then settles to ember orange and dims as it dies.
      tmp.setRGB(1, .45 + .5 * k * k, .12 + .5 * k * k * k);
      moteColor[c] = tmp.r; moteColor[c + 1] = tmp.g; moteColor[c + 2] = tmp.b; moteColor[c + 3] = k * k; n++;
    }
    moteGeometry.setDrawRange(0, n);
    moteGeometry.attributes.position.clearUpdateRanges(); moteGeometry.attributes.position.addUpdateRange(0, n * 3);
    moteGeometry.attributes.color.clearUpdateRanges(); moteGeometry.attributes.color.addUpdateRange(0, n * 4);
    moteGeometry.attributes.position.needsUpdate = moteGeometry.attributes.color.needsUpdate = true;
    motes.visible = n > 0;
    return n;
  }
  function update(dt, camera) {
    clock += dt; let n = 0;
    if (camera) camera.getWorldPosition(cam);
    moteDebt += dt * CONTRAIL.moteRate;
    for (const [key, trail] of trails) {
      while (trail.points.length && clock - trail.points[0].t > CONTRAIL.life) pool.push(trail.points.shift());
      if (!trail.points.length) { trails.delete(key); continue; }
      trail.live = false;
      const pts = trail.points, count = pts.length; if (count < 2) continue;
      for (let i = 0; i < samples; i++) {
        const sample = pts[Math.min(i, count - 1)], row = (n * samples + i) * COLUMNS;
        const prev = pts[Math.max(0, Math.min(i, count - 1) - 1)].p, next = pts[Math.min(count - 1, i + 1)].p;
        along.subVectors(next, prev); if (along.lengthSq() < 1e-10) along.set(0, 0, 1);
        view.subVectors(cam, sample.p); side.crossVectors(along, view); if (side.lengthSq() < 1e-10) side.set(0, 1, 0);
        // Age 0 at the wing tip: thin and bright; it widens, cools and rises as it drifts back, then fades out.
        // Alpha, not colour, ends the trail: a dimmed deep red over sunlit grass reads as brown smoke.
        const age = Math.min(1, (clock - sample.t) / CONTRAIL.life), fade = Math.pow(1 - age, 1.6) * sample.s;
        const width = (CONTRAIL.width + CONTRAIL.spread * age * age) * .5;
        side.normalize();
        // Flame, not vapour: the cooling tail waves across its own width and floats upward.
        lift.copy(side).multiplyScalar(Math.sin(clock * 9 + sample.seed) * CONTRAIL.lick * age);
        lift.y += CONTRAIL.rise * age * age;
        const alive = i < count ? 1 : 0;
        if (age < .3) tmp.copy(head).lerp(mid, age / .3); else tmp.copy(mid).lerp(tail, (age - .3) / .7);
        // Fresh samples ease in so the trail never starts as a hard bar at the wing.
        const ease = Math.min(1, (count - 1 - Math.min(i, count - 1)) / 2 + .35);
        const alpha = Math.min(1, fade * alive * ease * CONTRAIL.brightness);
        for (let c = 0; c < COLUMNS; c++) {
          const o = (row + c) * 3, a = (row + c) * 4, reach = COLUMN_OFFSET[c] * width, light = COLUMN_LIGHT[c];
          position[o] = sample.p.x + side.x * reach + lift.x;
          position[o + 1] = sample.p.y + side.y * reach + lift.y;
          position[o + 2] = sample.p.z + side.z * reach + lift.z;
          color[a] = tmp.r; color[a + 1] = tmp.g; color[a + 2] = tmp.b; color[a + 3] = alpha * light;
        }
        // Sparks come off the half of the ribbon that has begun to cool, where the flame is breaking up.
        if (alive && age > .35 && age < .8 && moteDebt >= 1 && trail.strength > .25) {
          moteDebt -= 1; shed(place.copy(sample.p).add(lift), trail.strength);
        }
      }
      n++;
    }
    if (moteDebt > 4) moteDebt = 4;
    geometry.setDrawRange(0, n * (samples - 1) * SEGMENT_INDICES);
    geometry.attributes.position.clearUpdateRanges(); geometry.attributes.position.addUpdateRange(0, n * samples * COLUMNS * 3);
    geometry.attributes.color.clearUpdateRanges(); geometry.attributes.color.addUpdateRange(0, n * samples * COLUMNS * 4);
    geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true;
    const sparks = updateMotes(dt);
    mesh.visible = n > 0 || sparks > 0;
    if (!n) geometry.setDrawRange(0, 0);
    return n;
  }
  function dispose() {
    mesh.removeFromParent(); geometry.dispose(); material.dispose(); trails.clear();
    motes.removeFromParent(); moteGeometry.dispose(); moteMaterial.dispose(); live.length = 0;
  }
  return {object: mesh, emit, update, dispose, capacity,
    stats: () => ({trails: trails.size, motes: live.length, drawCalls: (geometry.drawRange.count > 0 ? 1 : 0) + (motes.visible ? 1 : 0)})};
}
