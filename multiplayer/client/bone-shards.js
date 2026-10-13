import * as THREE from 'three';

// Bone splinters and skull chips: the small stuff that breaks off when a bone snaps. A War Hammer kill bursts a
// skeleton into a spray of splinters and knuckle-sized knobs, a skull shot chips the cranium, and an arm or leg
// knocked off a living skeleton sheds a few slivers at the break. Presentation only, seeded from the authoritative
// event so every player sees the same spray. Two instanced meshes (one draw each), a fixed pool that recycles the
// oldest piece, simple bouncing on the terrain, then each piece shrinks away. Phones get half as many.
//
//   const shards = createBoneShards({scene, material, height, quality});
//   shards.handle(event); shards.update(dt);

export const SHARDS = Object.freeze({
  pool: {high: 72, low: 32},
  life: {high: 7, low: 4.5},
  shatter: {splinter: 12, knob: 6, speed: [3, 8.5], lift: [1.5, 4.5]},
  headshot: {chip: 5, speed: [1.6, 3.6], lift: [.6, 1.8]},
  snap: {splinter: 4, speed: [1.2, 3.4], lift: [.8, 2.2]},
});
const G = 15, BOUNCE = .32, SKID = .55;

function rand(seed, n) {
  let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hashOf(...values) {
  let h = 0x811c9dc5;
  for (const c of values.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

// A broken length of bone: a knuckled end, a slightly bowed shaft, and a jagged snapped tip.
function splinterGeometry() {
  const g = new THREE.CylinderGeometry(.013, .013, .15, 7, 6, false), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (y + .075) / .15, a = Math.atan2(z, x);
    let r = t < .16 ? 1.55 - t * 2.4 : t > .72 ? Math.max(.05, (1 - t) / .28) * (.75 + .5 * rand(77, Math.round(a * 10))) : 1;
    const jag = t > .9 ? (rand(91, Math.round(a * 7)) - .5) * .05 : 0;
    p.setXYZ(i, x * r + Math.sin(t * Math.PI) * .006, y + jag, z * r);
  }
  g.computeVertexNormals(); return g;
}
// A knobbly little vertebra-ish lump.
function knobGeometry() {
  const g = new THREE.IcosahedronGeometry(.024, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = .78 + .4 * rand(13, Math.round((p.getX(i) + p.getY(i) * 3 + p.getZ(i) * 7) * 400)); p.setXYZ(i, p.getX(i) * k * 1.25, p.getY(i) * k * .75, p.getZ(i) * k); }
  g.computeVertexNormals(); return g;
}
// A curved flake of skull: a thin patch of a sphere with a broken outline.
function chipGeometry() {
  const g = new THREE.SphereGeometry(.07, 6, 4, 0, 1.1, .9, .8), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = .85 + .3 * rand(29, i); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k - .055, p.getZ(i) * k - .03); }
  g.computeVertexNormals(); return g;
}

export function createBoneShards({scene, material = null, height = () => 0, quality = 'high'} = {}) {
  const low = quality === 'low', cap = SHARDS.pool[low ? 'low' : 'high'], life = SHARDS.life[low ? 'low' : 'high'];
  // The skeleton's bone material tints by vertex colour, which these little pieces do not carry: give them its tint.
  const bone = material ? material.clone() : new THREE.MeshStandardMaterial({color: 0xe9dcc0, roughness: .62});
  if (bone.vertexColors) { bone.vertexColors = false; bone.color.multiply(new THREE.Color(0xe4d6b8)); }
  const skull = bone.clone(); skull.side = THREE.DoubleSide;
  const kinds = {
    splinter: new THREE.InstancedMesh(splinterGeometry(), bone, cap),
    knob: new THREE.InstancedMesh(knobGeometry(), bone, Math.ceil(cap / 2)),
    chip: new THREE.InstancedMesh(chipGeometry(), skull, Math.ceil(cap / 3)),
  };
  const group = new THREE.Group(); group.name = 'bone-shards'; group.userData.ignoreContact = true;
  const pools = {};
  for (const [name, mesh] of Object.entries(kinds)) {
    // Instances move every frame, so the cached instance bounds would lie; the few dozen pieces are never culled.
    mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.ignoreContact = true; mesh.name = `bone-shards:${name}`;
    group.add(mesh);
    const n = mesh.instanceMatrix.count;
    pools[name] = {mesh, n, used: 0, next: 0, p: new Float32Array(n * 3), v: new Float32Array(n * 3), w: new Float32Array(n * 3), q: new Float32Array(n * 4), age: new Float32Array(n), life: new Float32Array(n), size: new Float32Array(n), rest: new Uint8Array(n), alive: new Uint8Array(n)};
  }
  scene?.add(group);
  const stats = {bursts: 0, spawned: 0, recycled: 0};

  function spawn(kind, at, dir, speed, lift, seed, i, scale = 1) {
    const P = pools[kind], k = P.next; P.next = (P.next + 1) % P.n;
    if (P.alive[k]) stats.recycled++; else P.used++;
    const r = j => rand(seed, i * 17 + j);
    const spread = .75, s = speed[0] + (speed[1] - speed[0]) * r(1);
    const vx = dir[0] + (r(2) - .5) * 2 * spread, vz = dir[2] + (r(3) - .5) * 2 * spread, vy = Math.max(0, dir[1]) + (r(4) - .3) * spread;
    const n = Math.hypot(vx, vy, vz) || 1;
    P.p.set([at[0] + (r(5) - .5) * .12, at[1] + (r(6) - .5) * .12, at[2] + (r(7) - .5) * .12], k * 3);
    P.v.set([vx / n * s, vy / n * s + lift[0] + (lift[1] - lift[0]) * r(8), vz / n * s], k * 3);
    P.w.set([(r(9) - .5) * 30, (r(10) - .5) * 30, (r(11) - .5) * 30], k * 3);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r(12) * 6.3, r(13) * 6.3, r(14) * 6.3));
    P.q.set([q.x, q.y, q.z, q.w], k * 4);
    P.age[k] = 0; P.life[k] = life * (.75 + .5 * r(15)); P.size[k] = scale * (.7 + .6 * r(16)); P.rest[k] = 0; P.alive[k] = 1;
    stats.spawned++;
  }
  function burst(kind, count, at, dir, speed, lift, seed, scale) {
    if (!count || !at) return;
    for (let i = 0; i < count; i++) spawn(kind, at, dir, speed, lift, seed, i, scale);
  }
  const fewer = n => low ? Math.ceil(n / 2) : n;
  const flat = n => { const l = Math.hypot(n[0], n[2]); return l > 1e-4 ? [n[0] / l, 0, n[2] / l] : [0, 0, 0]; };
  /** Spray what an authoritative event broke off. Returns true when it threw anything. */
  function handle(event) {
    if (!event || !Array.isArray(event.position)) return false;
    const seed = hashOf(event.kind, event.id, event.style || '', event.part || '');
    if (event.kind === 'death' && event.creature === 'skeleton' && event.style === 'shatter') {
      const S = SHARDS.shatter, at = event.point || [event.position[0], event.position[1] + 1.1, event.position[2]], away = flat((event.normal || [0, 0, 0]).map(n => -n));
      burst('splinter', fewer(S.splinter), at, away, S.speed, S.lift, seed, 1);
      burst('knob', fewer(S.knob), at, away, S.speed, S.lift, seed + 1, 1);
    } else if (event.kind === 'death' && event.creature === 'skeleton' && event.style === 'headshot') {
      const S = SHARDS.headshot, at = event.point || [event.position[0], event.position[1] + 1.5, event.position[2]];
      burst('chip', fewer(S.chip), at, event.direction || flat((event.normal || [0, 0, 1]).map(n => -n)), S.speed, S.lift, seed, 1);
    } else if (event.kind === 'detach' && event.creature === 'skeleton' && !event.dying) {
      const S = SHARDS.snap, at = event.point || event.position;
      burst('splinter', fewer(S.splinter), at, flat((event.normal || [0, 0, 0]).map(n => -n)), S.speed, S.lift, seed, .75);
    } else return false;
    stats.bursts++; return true;
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _w = new THREE.Quaternion();
  function update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 1 / 20);
    for (const P of Object.values(pools)) {
      if (!P.used) { P.mesh.count = 0; continue; }
      let drawn = 0;
      for (let k = 0; k < P.n; k++) {
        if (!P.alive[k]) continue;
        const a = (P.age[k] += dt);
        if (a >= P.life[k]) { P.alive[k] = 0; P.used--; continue; }
        const i = k * 3;
        if (!P.rest[k]) {
          P.v[i + 1] -= G * dt;
          P.p[i] += P.v[i] * dt; P.p[i + 1] += P.v[i + 1] * dt; P.p[i + 2] += P.v[i + 2] * dt;
          _q.fromArray(P.q, k * 4); const wl = Math.hypot(P.w[i], P.w[i + 1], P.w[i + 2]);
          if (wl > 1e-3) { _w.setFromAxisAngle(_s.set(P.w[i] / wl, P.w[i + 1] / wl, P.w[i + 2] / wl), wl * dt); _q.premultiply(_w).normalize(); _q.toArray(P.q, k * 4); }
          const ground = height(P.p[i], P.p[i + 2]) + .012 * P.size[k];
          if (Number.isFinite(ground) && P.p[i + 1] < ground) {
            P.p[i + 1] = ground;
            if (P.v[i + 1] < 0) P.v[i + 1] = -P.v[i + 1] * BOUNCE;
            P.v[i] *= SKID; P.v[i + 2] *= SKID; P.w[i] *= .5; P.w[i + 1] *= .5; P.w[i + 2] *= .5;
            if (Math.hypot(P.v[i], P.v[i + 1], P.v[i + 2]) < .35) { P.rest[k] = 1; P.v.fill(0, i, i + 3); }
          }
        }
        // Shrink away over the last half second, so nothing pops.
        const fade = Math.min(1, (P.life[k] - a) / .5), grow = Math.min(1, a / .04);
        _s.setScalar(P.size[k] * fade * grow); _p.fromArray(P.p, i); _q.fromArray(P.q, k * 4);
        P.mesh.setMatrixAt(drawn++, _m.compose(_p, _q, _s));
      }
      P.mesh.count = drawn; P.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  function active() { let n = 0; for (const P of Object.values(pools)) n += P.used; return n; }
  function dispose() {
    group.removeFromParent();
    for (const mesh of Object.values(kinds)) mesh.geometry.dispose();
    bone.dispose(); skull.dispose();
  }
  return {handle, update, active, stats: () => ({...stats, active: active(), cap}), dispose, object: group};
}
