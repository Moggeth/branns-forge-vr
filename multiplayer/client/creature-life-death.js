import * as THREE from 'three';

// Authored creature life and death presentation for the browser client.
//
//   skeleton: procedural crawl out of the ground (hands first, torso pull,
//             legs under, stand) on the ACTUAL skinned rig joints.
//   golem:    multi-phase assembly of the ACTUAL modular pieces (legs, core,
//             arms, plates, head last) with orbit/tumble/snap and binding.
//   death:    short articulated collapse layered onto the server's detached
//             parts, blending into their authoritative physics poses.
//   damage:   persistent per-bone scorch + per-part cracks/chips through a
//             single shared shader variant on bounded per-actor clones.
//
// Ownership rules (see ART_HANDOFF.md):
//  * entry.root (simulation-owned) is never moved, rotated or scaled.
//  * Only internal rig joints / authored model pieces are posed, so embedded
//    arrows (bone/piece children) and actual-triangle contacts follow the
//    visible pose. No proxies, no reparenting, no visibility changes on the
//    combat model (golem armour visibility stays with updateGolemArmor).
//  * Every presentation write is undone by beginFrame() before mixers and
//    enemy-motion run, so neither layer can accumulate the other's offsets.
//
// Frame order (integrator):
//   lifeDeath.beginFrame();
//   mixers.update(dt); updateEnemyMotion(actors, ctx);
//   for (entry of enemies) lifeDeath.sync(entry, tick);   // before contacts
//   combat.sync(...) / combat.tick(...)                     // poses detached
//   lifeDeath.syncDetached(detachedNodes, tick);           // after detached pose
//   lifeDeath.tick(dt);

export const TICK_RATE = 60;
export const LIMITS = Object.freeze({actors: 192, corpses: 24, dirt: 640, magic: 384, decals: 40, binds: 48});

// ---------------------------------------------------------------------------
// Pure deterministic helpers (no THREE, no Math.random, no wall clock).
// ---------------------------------------------------------------------------

export function hashId(id) {
  let h = 0x811c9dc5;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
export function rand(seed, n) {
  let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const easeIn = t => { t = clamp(t, 0, 1); return t * t * t; };
const easeOut = t => { t = clamp(t, 0, 1); return 1 - (1 - t) ** 3; };
function noise1(seed, ch, t) {
  const i = Math.floor(t), f = t - i, s = seed + Math.imul(ch, 0x27d4eb2d);
  return mix(rand(s, i), rand(s, i + 1), smooth(f)) * 2 - 1;
}

// Canonical part naming mirrors client/combat-view.js canonicalPart(); kept
// local so this module stays importable without combat-view's dependencies.
export function canonicalPart(name = '') {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (/head|skull/.test(n)) return 'head';
  if (/leftleg|leftknee|leftfoot|legl/.test(n)) return 'leftLeg';
  if (/rightleg|rightknee|rightfoot|legr/.test(n)) return 'rightLeg';
  if (/leftarm|lefthand|arml|shoulderl|forearml|elbowl/.test(n)) return 'leftArm';
  if (/rightarm|righthand|armr|shoulderr|forearmr|elbowr/.test(n)) return 'rightArm';
  return 'torso';
}
export const PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const PART_MAX = {skeleton: {head: 55, torso: 100, leftArm: 55, rightArm: 55, leftLeg: 55, rightLeg: 55}, golem: {head: 120, torso: 120, leftArm: 120, rightArm: 120, leftLeg: 120, rightLeg: 120}};
const HP_MAX = {skeleton: 100, golem: 320};

/** Seeded per-actor emergence timing. Durations in seconds. */
export function emergencePlan(id, kind = 'skeleton') {
  const seed = hashId(id), r = n => rand(seed, 50 + n);
  if (kind === 'golem') return {seed, duration: 2.7 + r(0) * .7, leadLeft: r(1) < .5, spin: r(2) < .5 ? 1 : -1, headTurn: (r(3) - .5) * 1.2};
  return {seed, duration: 1.6 + r(0) * .7, leadLeft: r(1) < .5, lean: (r(2) - .5) * .5, headTilt: (r(3) - .5) * .5, twitch: .6 + r(4) * .8, legDelay: .03 + r(5) * .07};
}

/** Emergence start tick from simulation data, or null when the actor did not spawn in view. */
export function emergeStartTick(data) {
  for (const key of ['emergeTick', 'spawnTick', 'unfurlTick']) if (Number.isFinite(data?.[key])) return data[key];
  return null;
}

/** 0..1 normalized crack/damage amount of a canonical part from simulation health. */
export function partDamage(data, part) {
  const kind = data?.kind === 'golem' ? 'golem' : 'skeleton';
  if (data?.missingParts?.includes(part)) return 1;
  const max = PART_MAX[kind][part] || 100, hp = data?.parts?.[part];
  if (!Number.isFinite(hp)) return 0;
  return clamp((1 - hp / max - .12) / .88, 0, 1);
}
export function bodyDamage(data) {
  const kind = data?.kind === 'golem' ? 'golem' : 'skeleton';
  return Number.isFinite(data?.hp) ? clamp(1 - data.hp / HP_MAX[kind], 0, 1) : 0;
}

// Skeleton crawl keyframes. u = normalized time. Directions are ACTOR-space
// [right, up, forward] for each segment (joint -> tip); 'lead'/'off' arms are
// mirrored onto the actual left/right sides at runtime. depth is a named rig
// measurement resolved per actor (see skeletonDepths).
export const CRAWL_KEYS = [
  {u: 0, depth: 'buried', fwd: -.28, torso: [0, 1, .2], head: [0, 1, .35], lead: [.1, 1, .1], off: [.25, .3, .9], thigh: [0, -1, -.15], shin: [0, -1, -.25], curl: .9},
  {u: .15, depth: 'reach', fwd: -.28, torso: [0, 1, .3], head: [0, .9, .45], lead: [.18, 1, .38], off: [.3, .8, .55], thigh: [0, -1, -.15], shin: [0, -1, -.25], curl: -.6},
  {u: .3, depth: 'reach2', fwd: -.24, torso: [0, .85, .55], head: [0, .6, .8], lead: [.38, -.15, 1], off: [.15, 1, .35], thigh: [0, -1, -.2], shin: [0, -1, -.3], curl: .5},
  {u: .47, depth: 'pull', fwd: -.12, torso: [0, .5, .87], head: [0, .25, 1], lead: [.42, -.6, .68], off: [.4, -.55, .72], thigh: [0, -.9, -.45], shin: [0, -.6, -.8], curl: .2},
  {u: .63, depth: 'hip', fwd: -.04, torso: [0, .58, .82], head: [0, .3, 1], lead: [.38, -.85, .38], off: [.38, -.85, .4], thigh: [.12, -.2, .98], shin: [0, -.65, -.76], curl: .35},
  {u: .77, depth: 'kneel', fwd: .02, torso: [0, .82, .57], head: [0, .45, .9], lead: [.3, -.97, .12], off: [.3, -.97, .1], thigh: [.1, -.45, .9], shin: [0, -.85, -.52], curl: .1},
  {u: .9, depth: 'stand', fwd: 0, torso: [0, 1, -.14], head: [0, 1, -.3], lead: [.16, -1, -.05], off: [.16, -1, -.05], thigh: [.04, -1, .02], shin: [0, -1, -.02], curl: 0},
  {u: 1, depth: 'rest', fwd: 0, torso: [0, 1, 0], head: [0, 1, .05], lead: [.12, -1, 0], off: [.12, -1, 0], thigh: [0, -1, 0], shin: [0, -1, 0], curl: 0},
];

/** Pure: sample the crawl channels at normalized time u. `out` is reused. */
export function sampleCrawl(u, depths, out = {}) {
  u = clamp(u, 0, 1);
  let i = 0; while (i < CRAWL_KEYS.length - 2 && u > CRAWL_KEYS[i + 1].u) i++;
  const a = CRAWL_KEYS[i], b = CRAWL_KEYS[i + 1], t = smooth((u - a.u) / (b.u - a.u));
  out.depth = mix(depths[a.depth] ?? 0, depths[b.depth] ?? 0, t);
  out.fwd = mix(a.fwd, b.fwd, t); out.curl = mix(a.curl, b.curl, t);
  for (const k of ['torso', 'head', 'lead', 'off', 'thigh', 'shin']) {
    const v = out[k] ||= [0, 0, 0];
    for (let j = 0; j < 3; j++) v[j] = mix(a[k][j], b[k][j], t);
  }
  return out;
}

/** Override weight: full during the crawl, releasing to motion over the last 14%. */
export const crawlWeight = u => u >= 1 ? 0 : 1 - smooth((u - .86) / .14);

// ---------------------------------------------------------------------------
// THREE helpers.
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), IDQ = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _ws = new THREE.Vector3(), _m = new THREE.Matrix4();
const aR = new THREE.Vector3(), aU = new THREE.Vector3(), aF = new THREE.Vector3(), rootQ = new THREE.Quaternion(), rootP = new THREE.Vector3();

// Bones win over same-named mesh/group nodes (GLTFLoader may suffix _1).
function find(root, name) {
  let bone = null, other = null;
  if (name) root.traverse(n => {
    if (n.name !== name && !(n.name.startsWith(name + '_') && /^\d+$/.test(n.name.slice(name.length + 1)))) return;
    if (n.isBone) { if (!bone || n.name === name) bone = bone && bone.name === name ? bone : n; }
    else if (!n.isMesh && !(other && other.name === name)) other = n;
  });
  return bone || other;
}
function findAny(root, name) { return find(root, name) || root.getObjectByName(name) || null; }

function actorFrame(root) {
  root.updateWorldMatrix(true, false);
  root.getWorldQuaternion(rootQ); root.getWorldPosition(rootP);
  aR.set(1, 0, 0).applyQuaternion(rootQ); aU.set(0, 1, 0); aF.set(0, 0, -1).applyQuaternion(rootQ);
  aR.y = 0; aF.y = 0; if (aR.lengthSq() < 1e-8 || aF.lengthSq() < 1e-8) { aR.set(1, 0, 0); aF.set(0, 0, -1); }
  aR.normalize(); aF.normalize();
}
const actorDir = (v, sideSign, out) => out.set(0, 0, 0).addScaledVector(aR, v[0] * sideSign).addScaledVector(aU, v[1]).addScaledVector(aF, v[2]).normalize();

function rotateWorld(node, axis, angle) {
  if (!angle || !node?.parent) return;
  node.parent.getWorldQuaternion(_pq);
  _q.setFromAxisAngle(axis, angle);
  _q2.copy(_pq).invert().multiply(_q).multiply(_pq);
  node.quaternion.premultiply(_q2);
}
function offsetWorld(node, delta) {
  if (!node?.parent || !(delta.lengthSq() > 0)) return;
  node.parent.getWorldQuaternion(_pq); node.parent.getWorldScale(_ws);
  _v3.copy(delta).applyQuaternion(_q.copy(_pq).invert()).divide(_ws);
  node.position.add(_v3);
}
// Rotate a joint (about its own pivot) so its local segment `tip` points at a
// world direction, by weight w. Twist is left to the underlying pose.
function aim(node, tip, dir, w) {
  if (!node?.parent || !tip || !(w > 0)) return;
  node.updateWorldMatrix(true, false);
  _v.copy(tip).transformDirection(node.matrixWorld);
  _q.setFromUnitVectors(_v, dir);
  if (w < 1) _q.copy(_q2.copy(IDQ).slerp(_q, w));
  node.getWorldQuaternion(_wq).premultiply(_q);
  node.parent.getWorldQuaternion(_pq);
  node.quaternion.copy(_pq.invert().multiply(_wq));
}

// Local segment direction of a joint: a known child joint, else the centroid
// of the bind-pose vertices it dominates, else the first child, else null.
const tipCache = new WeakMap();
function segmentTip(visual, node, childName) {
  if (!node) return null;
  const child = childName && find(node, childName);
  if (child && child !== node && child.position.lengthSq() > 1e-10) return child.position.clone().normalize();
  if (node.isBone) {
    let tip = null;
    visual.traverse(mesh => {
      if (tip || !mesh.isSkinnedMesh || !mesh.skeleton) return;
      const b = mesh.skeleton.bones.indexOf(node); if (b < 0) return;
      let cache = tipCache.get(mesh.geometry); if (!cache) tipCache.set(mesh.geometry, cache = new Map());
      if (cache.has(node.name)) { tip = cache.get(node.name); return; }
      const pos = mesh.geometry.attributes.position, idx = mesh.geometry.attributes.skinIndex, wt = mesh.geometry.attributes.skinWeight;
      if (!pos || !idx || !wt) return;
      _m.copy(mesh.skeleton.boneInverses[b]).multiply(mesh.bindMatrix);
      const sum = new THREE.Vector3(); let count = 0;
      for (let i = 0; i < pos.count; i++) {
        let best = -1, bw = 0;
        for (let k = 0; k < 4; k++) { const w = wt.getComponent(i, k); if (w > bw) { bw = w; best = idx.getComponent(i, k); } }
        if (best !== b) continue;
        sum.add(_v.fromBufferAttribute(pos, i).applyMatrix4(_m)); count++;
      }
      const result = count && sum.lengthSq() > 1e-12 ? sum.divideScalar(count).normalize() : null;
      cache.set(node.name, result); tip = result;
    });
    if (tip) return tip;
  }
  const first = node.children.find(c => c.position.lengthSq() > 1e-10);
  return first ? first.position.clone().normalize() : null;
}

// Presentation write records: beginFrame() restores what enemy-motion/mixer
// produced, but only where our write is still in place.
function track(st, node) {
  if (!node) return null;
  let rec = st.recs.find(r => r.node === node);
  if (!rec) { rec = {node, preQ: new THREE.Quaternion(), preP: new THREE.Vector3(), wroteQ: new THREE.Quaternion(), wroteP: new THREE.Vector3(), dirty: false, open: false}; st.recs.push(rec); }
  return rec;
}
function open(rec) { if (!rec || rec.open) return; rec.preQ.copy(rec.node.quaternion); rec.preP.copy(rec.node.position); rec.open = true; }
function close(st) {
  for (const r of st.recs) if (r.open) { r.wroteQ.copy(r.node.quaternion); r.wroteP.copy(r.node.position); r.dirty = true; r.open = false; }
}
function undo(st) {
  for (const r of st.recs) {
    if (!r.dirty) continue;
    if (r.node.quaternion.equals(r.wroteQ)) r.node.quaternion.copy(r.preQ);
    if (r.node.position.equals(r.wroteP)) r.node.position.copy(r.preP);
    r.dirty = false;
  }
}

// ---------------------------------------------------------------------------
// Pooled effects: dirt points, additive magic points, decals, binding lines.
// One draw call each regardless of actor count; all ignoreContact.
// ---------------------------------------------------------------------------

function createParticles(capacity, {additive = false, size = .06} = {}) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position); geometry.setAttribute('color', color); geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({size, vertexColors: true, sizeAttenuation: true, transparent: additive, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending});
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.userData.ignoreContact = true; points.renderOrder = additive ? 3 : 0;
  return {points, capacity, n: 0, pos: position.array, col: color.array, vel: new Float32Array(capacity * 3), base: new Float32Array(capacity * 3), life: new Float32Array(capacity), max: new Float32Array(capacity), drag: new Float32Array(capacity), grav: new Float32Array(capacity), additive};
}
function emit(sys, x, y, z, vx, vy, vz, r, g, b, life, gravity = -9.8, drag = .6) {
  let i = sys.n;
  if (i >= sys.capacity) { // replace the oldest-by-remaining-life slot (bounded, no growth)
    let best = 0; for (let k = 1; k < sys.capacity; k++) if (sys.life[k] < sys.life[best]) best = k; i = best;
  } else sys.n++;
  sys.pos.set([x, y, z], i * 3); sys.vel.set([vx, vy, vz], i * 3); sys.base.set([r, g, b], i * 3); sys.col.set([r, g, b], i * 3);
  sys.life[i] = sys.max[i] = life; sys.grav[i] = gravity; sys.drag[i] = drag;
}
function stepParticles(sys, dt, height) {
  let n = sys.n;
  for (let i = 0; i < n;) {
    sys.life[i] -= dt;
    if (sys.life[i] <= 0) { // swap-remove
      n--; if (i !== n) {
        for (const a of [sys.pos, sys.vel, sys.base, sys.col]) a.copyWithin(i * 3, n * 3, n * 3 + 3);
        sys.life[i] = sys.life[n]; sys.max[i] = sys.max[n]; sys.drag[i] = sys.drag[n]; sys.grav[i] = sys.grav[n];
      }
      continue;
    }
    const o = i * 3, k = Math.exp(-sys.drag[i] * dt);
    const travel = sys.drag[i] > 1e-6 ? (1-k)/sys.drag[i] : dt;
    sys.pos[o] += sys.vel[o] * travel; sys.pos[o+2] += sys.vel[o+2] * travel;
    sys.pos[o+1] += sys.grav[i] ? sys.vel[o+1]*dt + .5*sys.grav[i]*dt*dt : sys.vel[o+1]*travel;
    sys.vel[o] *= k; sys.vel[o+2] *= k;
    sys.vel[o+1] = sys.grav[i] ? sys.vel[o+1]+sys.grav[i]*dt : sys.vel[o+1]*k;
    if (sys.grav[i] < 0 && sys.vel[o + 1] < 0) {
      const g = height(sys.pos[o], sys.pos[o + 2]);
      if (Number.isFinite(g) && sys.pos[o + 1] < g + .015) { sys.pos[o + 1] = g + .015; sys.vel[o] *= .3; sys.vel[o + 1] = -sys.vel[o + 1] * .18; sys.vel[o + 2] *= .3; }
    }
    const f = sys.life[i] / sys.max[i], fade = sys.additive ? f * f : Math.min(1, f * 4);
    for (let c = 0; c < 3; c++) sys.col[o + c] = sys.base[o + c] * (sys.additive ? fade : 1);
    if (!sys.additive && fade < 1) sys.pos[o + 1] -= (1 - fade) * .24 * dt; // settled clods sink into the soil
    i++;
  }
  sys.n = n;
  const g = sys.points.geometry; g.setDrawRange(0, n);
  g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
}

// Flat ground decal geometries (XZ plane, y=0), built once and shared.
function sigilGeometry() {
  const P = [], C = [];
  const quad = (a, b, w, c) => { // strip from a to b with width w
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    const v = [[a[0] + nx, a[1] + nz], [a[0] - nx, a[1] - nz], [b[0] - nx, b[1] - nz], [b[0] + nx, b[1] + nz]];
    for (const i of [0, 1, 2, 0, 2, 3]) { P.push(v[i][0], 0, v[i][1]); C.push(...c); }
  };
  const ring = (r, w, seg, c) => { for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2, b = (i + 1) / seg * Math.PI * 2; quad([Math.cos(a) * r, Math.sin(a) * r], [Math.cos(b) * r, Math.sin(b) * r], w, c); } };
  ring(1, .035, 40, [.55, 1, .7]); ring(.78, .018, 32, [.4, .9, .65]);
  for (let i = 0; i < 5; i++) { // pentagram-like binding star between the rings
    const a = i / 5 * Math.PI * 2 + Math.PI / 2, b = (i + 2) / 5 * Math.PI * 2 + Math.PI / 2;
    quad([Math.cos(a) * .78, Math.sin(a) * .78], [Math.cos(b) * .78, Math.sin(b) * .78], .016, [.35, .85, .6]);
  }
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; quad([Math.cos(a) * .82, Math.sin(a) * .82], [Math.cos(a) * .96, Math.sin(a) * .96], .012, [.5, 1, .75]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
function crackGeometry() { // radial branching ground fracture, deterministic
  const P = [], C = [], seed = 1337;
  const strip = (x0, z0, x1, z1, w) => {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    const v = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx * .4, z1 - nz * .4], [x1 + nx * .4, z1 + nz * .4]];
    for (const i of [0, 1, 2, 0, 2, 3]) { P.push(v[i][0], 0, v[i][1]); C.push(1, 1, 1); }
  };
  for (let i = 0; i < 9; i++) {
    let a = i / 9 * Math.PI * 2 + rand(seed, i) * .5, r = .12, x = Math.cos(a) * r, z = Math.sin(a) * r, w = .05;
    for (let s = 0; s < 5; s++) {
      a += (rand(seed, i * 10 + s) - .5) * .7; const step = .14 + rand(seed, i * 20 + s) * .1;
      const nx = x + Math.cos(a) * step, nz = z + Math.sin(a) * step; strip(x, z, nx, nz, w);
      if (s === 2) { const b = a + (rand(seed, i * 30) < .5 ? .7 : -.7); strip(nx, nz, nx + Math.cos(b) * .18, nz + Math.sin(b) * .18, w * .6); }
      x = nx; z = nz; w *= .8;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
function moundGeometry() { // lumpy broken soil collar around the hole
  const g = new THREE.CylinderGeometry(.55, 1, .22, 18, 2, true);
  const pos = g.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x), j = .75 + .45 * rand(77, Math.round((a + 4) * 9));
    pos.setX(i, x * (.85 + .3 * rand(78, i % 19))); pos.setZ(i, z * (.85 + .3 * rand(79, i % 19))); pos.setY(i, (pos.getY(i) + .11) * j);
    const d = .55 + .45 * rand(80, i); col.push(.2 * d, .14 * d, .09 * d);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}

function createDecals(capacity) {
  const owned = [];
  const make = (geometry, material, order) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity); owned.push(geometry, material);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = order;
    mesh.userData.ignoreContact = true; mesh.setColorAt(0, new THREE.Color()); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  };
  const sigil = make(sigilGeometry(), new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2}), 2);
  const crack = make(crackGeometry(), new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2}), 2);
  const crackDark = make(crack.geometry, new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1}), 1);
  owned.splice(owned.indexOf(crack.geometry, 4), 1); // shared geometry owned once
  const mound = make(moundGeometry(), new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, flatShading: true}), 0);
  return {items: [], meshes: {sigil, crack, crackDark, mound}, owned};
}
// kind: sigil|crack|mound. Decals are keyed to an actor/time and fully evaluated each tick.
function addDecal(d, kind, x, y, z, radius, life, color, yaw = 0) {
  if (d.items.length >= LIMITS.decals) d.items.shift();
  d.items.push({kind, x, y, z, radius, life, age: 0, color: new THREE.Color(color), yaw});
}
const _dm = new THREE.Matrix4(), _dc = new THREE.Color(), _ds = new THREE.Vector3(), _dp = new THREE.Vector3(), _dq = new THREE.Quaternion(), YAXIS = new THREE.Vector3(0, 1, 0);
function stepDecals(d, dt) {
  const counts = {sigil: 0, crack: 0, crackDark: 0, mound: 0};
  d.items = d.items.filter(it => (it.age += dt) < it.life);
  for (const it of d.items) {
    const u = it.age / it.life;
    if (it.kind === 'sigil') {
      const grow = easeOut(u / .18), fade = 1 - smooth((u - .6) / .4), pulse = .75 + .25 * Math.sin(it.age * 9);
      put(d.meshes.sigil, counts.sigil++, it, it.radius * (.4 + .6 * grow), 1, it.yaw + it.age * .6, _dc.copy(it.color).multiplyScalar(fade * pulse));
    } else if (it.kind === 'crack') {
      const grow = easeOut(u / .25), fade = 1 - smooth((u - .55) / .45), glow = fade * (.5 + .5 * Math.sin(it.age * 13) ** 2);
      put(d.meshes.crack, counts.crack++, it, it.radius * grow, 1, it.yaw, _dc.copy(it.color).multiplyScalar(glow));
      put(d.meshes.crackDark, counts.crackDark++, it, it.radius * grow * 1.06, 1, it.yaw, _dc.setRGB(1, 1, 1));
    } else {
      const rise = easeOut(u / .12), sink = smooth((u - .7) / .3);
      put(d.meshes.mound, counts.mound++, it, it.radius * (.5 + .5 * rise), Math.max(.01, rise * (1 - sink)), it.yaw, _dc.setRGB(1, 1, 1), -.04 * sink);
    }
  }
  for (const [k, n] of Object.entries(counts)) {
    const m = d.meshes[k]; m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
function put(mesh, i, it, s, sy, yaw, color, dy = 0) {
  if (i >= mesh.instanceMatrix.count) return;
  _dq.setFromAxisAngle(YAXIS, yaw); _ds.set(s, s * sy, s); _dp.set(it.x, it.y + .02 + dy, it.z);
  mesh.setMatrixAt(i, _dm.compose(_dp, _dq, _ds)); mesh.setColorAt(i, color);
}

// ---------------------------------------------------------------------------
// Main module.
// ---------------------------------------------------------------------------

export function createCreatureLifeDeath({scene, height = () => 0} = {}) {
  const states = new Map(); // actor id -> state
  const dirt = createParticles(LIMITS.dirt, {size: .055});
  const magic = createParticles(LIMITS.magic, {additive: true, size: .11});
  const decals = createDecals(LIMITS.decals);
  const group = new THREE.Group(); group.name = 'creature-life-death'; group.userData.ignoreContact = true;
  group.add(dirt.points, magic.points, ...Object.values(decals.meshes));
  scene?.add(group);
  const H = (x, z) => { const g = height(x, z); return Number.isFinite(g) ? g : 0; };
  let frame = 0, lastTick = 0, elapsedSeconds = 0;

  function stateFor(entry) {
    const data = entry.data, id = data.id;
    let st = states.get(id);
    if (st && st.visual !== entry.visual) { release(st); st = null; }
    if (!st) {
      if (states.size >= LIMITS.actors) { // evict least recently synced
        let old = null; for (const s of states.values()) if (!old || s.seen < old.seen) old = s; if (old) release(old);
      }
      const kind = data.kind === 'golem' ? 'golem' : 'skeleton';
      st = {id, kind, entry, visual: entry.visual, recs: [], plan: emergencePlan(id, kind), seen: frame, rig: null, fired: new Set(), lastU: -1, emergeStart: emergeStartTick(data), placeholder: !!entry.visual?.userData?.placeholder};
      states.set(id, st);
    }
    st.entry = entry; st.seen = frame; st.seenAt=elapsedSeconds;
    return st;
  }
  function release(st) {
    undo(st);
    releaseDamage(st);
    states.delete(st.id);
  }

  // ---- skeleton rig ------------------------------------------------------
  function skeletonRig(st) {
    const v = st.visual, n = name => find(v, name);
    const rig = {root: n('Root'), torso: n('Torso'), head: n('Head'), armL: n('LeftArm'), armR: n('RightArm'), handR: n('RightHand'), handL: n('LeftHand'),
      thighL: n('LeftLeg'), kneeL: n('LeftKnee'), thighR: n('RightLeg'), kneeR: n('RightKnee')};
    rig.tips = {
      torso: segmentTip(v, rig.torso, 'Head'), head: segmentTip(v, rig.head), armL: segmentTip(v, rig.armL, 'LeftHand'), armR: segmentTip(v, rig.armR, 'RightHand'),
      thighL: segmentTip(v, rig.thighL, 'LeftKnee'), kneeL: segmentTip(v, rig.kneeL, 'LeftFoot'), thighR: segmentTip(v, rig.thighR, 'RightKnee'), kneeR: segmentTip(v, rig.kneeR, 'RightFoot'),
    };
    // Rig measurements at first sight (motion-layered pose ~ standing).
    actorFrame(st.entry.root);
    const g = rootP.y, wy = node => node ? node.getWorldPosition(_v).y - g : NaN;
    v.updateWorldMatrix(true, true);
    const scale = st.entry.root.getWorldScale(_ws).y || 1;
    const hip = Math.max(.2 * scale, ((wy(rig.thighL) || 0) + (wy(rig.thighR) || 0)) / ((rig.thighL ? 1 : 0) + (rig.thighR ? 1 : 0) || 1) || .85 * scale);
    const shoulder = Math.max(hip + .15 * scale, wy(rig.armR) || wy(rig.armL) || 1.35 * scale);
    let arm = .62 * scale;
    if (rig.armR && rig.handR) arm = Math.max(.25 * scale, rig.armR.getWorldPosition(_v).distanceTo(rig.handR.getWorldPosition(_v2)) * 1.25);
    rig.depths = {buried: shoulder + arm + .06 * scale, reach: shoulder + arm * .45, reach2: shoulder + arm * .3, pull: hip + (shoulder - hip) * .18, hip: hip * .9, kneel: hip * .5, stand: -.035 * hip, rest: 0};
    rig.size = {hip, shoulder, arm, scale};
    // Which authored arm/leg is actor-left is measured, not assumed.
    const side = node => node ? Math.sign(node.getWorldPosition(_v).sub(rootP).dot(aR)) || 1 : 1;
    rig.side = {armL: side(rig.armL), armR: side(rig.armR), thighL: side(rig.thighL), thighR: side(rig.thighR)};
    for (const key of ['root', 'torso', 'head', 'armL', 'armR', 'handR', 'handL', 'thighL', 'kneeL', 'thighR', 'kneeR']) if (rig[key]) track(st, rig[key]);
    return rig;
  }

  const crawl = {}, D = new THREE.Vector3(), handPos = new THREE.Vector3();
  function poseSkeleton(st, tick) {
    const rig = st.rig ||= skeletonRig(st), plan = st.plan, data = st.entry.data;
    const age = (tick - st.emergeStart) / TICK_RATE, u = clamp(age / plan.duration, 0, 1), w = crawlWeight(u);
    if (!(w > 0)) return false;
    actorFrame(st.entry.root);
    sampleCrawl(u, rig.depths, crawl);
    const s = plan.seed, sc = rig.size.scale, t = age;
    for (const r of st.recs) open(r);
    // Pelvis: internal rig Root joint only (never entry.root).
    if (rig.root) {
      D.copy(aU).multiplyScalar(-crawl.depth * w).addScaledVector(aF, crawl.fwd * rig.size.hip * w).addScaledVector(aR, plan.lean * .12 * sc * w * (1 - u));
      offsetWorld(rig.root, D);
      rotateWorld(rig.root, aF, plan.lean * .35 * w * (1 - u)); // whole-body list as it hauls itself out
    }
    const shake = (ch, amp) => noise1(s, ch, t * 7 * plan.twitch) * amp * (1 - u * .7);
    const missing = data.missingParts || [];
    // Spine/head: sequential, parent first.
    actorDir(crawl.torso, 1, _v2); _v2.addScaledVector(aR, shake(1, .12) + plan.lean * .2 * (1 - u)).normalize(); aim(rig.torso, rig.tips.torso, _v2, w);
    if (rig.head && !missing.includes('head')) {
      actorDir(crawl.head, 1, _v2); _v2.addScaledVector(aR, plan.headTilt * .4 + shake(2, .25)).addScaledVector(aU, shake(3, .15)).normalize();
      aim(rig.head, rig.tips.head || rig.tips.torso, _v2, w);
      // Necromantic jerk at the end of the stand: head snaps sideways and back.
      const snap = Math.sin(clamp((u - .84) / .1, 0, 1) * Math.PI);
      rotateWorld(rig.head, aF, snap * plan.headTilt * 1.2 * w);
    }
    // Arms: lead arm breaks soil first; mirrored onto the measured sides.
    const leadIsL = plan.leadLeft, lag = .07;
    for (const [key, isL] of [['armL', true], ['armR', false]]) {
      const node = rig[key]; if (!node || missing.includes(isL ? 'leftArm' : 'rightArm')) continue;
      const lead = isL === leadIsL;
      if (!lead) { // trail arm samples the crawl slightly later for asymmetry
        const ul = clamp(u - lag * (1 - u), 0, 1); sampleCrawl(ul, rig.depths, crawlLag);
      }
      const src = lead ? crawl.lead : crawlLag.off;
      actorDir(src, rig.side[key], _v2); _v2.addScaledVector(aU, shake(lead ? 4 : 5, .18)).addScaledVector(aF, shake(lead ? 6 : 7, .14)).normalize();
      aim(node, rig.tips[key], _v2, w);
    }
    // Clawing hand (the rig has hand joints but no finger joints).
    if (rig.handR && !missing.includes('rightArm')) rotateWorld(rig.handR, aR, (crawl.curl + shake(8, .5)) * .7 * w);
    if (rig.handL && !missing.includes('leftArm')) rotateWorld(rig.handL, aR, (crawl.curl + shake(9, .5)) * .7 * w);
    // Legs: one leg gathers under the body slightly before the other.
    for (const [thigh, knee, isL] of [['thighL', 'kneeL', true], ['thighR', 'kneeR', false]]) {
      if (!rig[thigh] || missing.includes(isL ? 'leftLeg' : 'rightLeg')) continue;
      const delay = isL === leadIsL ? 0 : plan.legDelay;
      sampleCrawl(clamp(u - delay, 0, 1), rig.depths, crawlLeg);
      const splay = isL === leadIsL ? .12 : .08;
      actorDir(crawlLeg.thigh, rig.side[thigh], _v2); _v2.addScaledVector(aR, splay * rig.side[thigh]).normalize(); aim(rig[thigh], rig.tips[thigh], _v2, w);
      if (rig[knee]) { actorDir(crawlLeg.shin, rig.side[thigh], _v2); aim(rig[knee], rig.tips[knee], _v2, w); }
    }
    close(st);
    // Soil and necromantic accents, fired once per threshold.
    skeletonEffects(st, u, rig);
    return true;
  }
  const crawlLag = {}, crawlLeg = {};

  function once(st, key) { if (st.fired.has(key)) return false; st.fired.add(key); return true; }
  function burstDirt(x, y, z, count, speed, seed, ch, spread = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(seed, ch * 97 + i) * Math.PI * 2, r = rand(seed, ch * 131 + i), up = .45 + rand(seed, ch * 173 + i) * .9;
      const shade = .55 + .45 * rand(seed, ch * 211 + i);
      emit(dirt, x + Math.cos(a) * r * .12 * spread, y + .02, z + Math.sin(a) * r * .12 * spread,
        Math.cos(a) * speed * (.3 + r) * spread, speed * up * 1.4, Math.sin(a) * speed * (.3 + r) * spread,
        .26 * shade, .18 * shade, .11 * shade, .9 + rand(seed, ch * 251 + i) * .9, -9.8, .4);
    }
  }
  function wisps(x, y, z, count, seed, ch, color = [.35, 1, .55], rise = 1.1, life = 1.1) {
    for (let i = 0; i < count; i++) {
      const a = rand(seed, ch * 59 + i) * Math.PI * 2, r = rand(seed, ch * 61 + i) * .35;
      emit(magic, x + Math.cos(a) * r, y + rand(seed, ch * 67 + i) * .2, z + Math.sin(a) * r,
        Math.cos(a) * .25, rise * (.5 + rand(seed, ch * 71 + i)), Math.sin(a) * .25, color[0], color[1], color[2], life * (.6 + .6 * rand(seed, ch * 73 + i)), 0, 1.2);
    }
  }
  function skeletonEffects(st, u, rig) {
    const s = st.plan.seed, x = rootP.x, z = rootP.z, g = H(x, z);
    if (once(st, 'sigil')) { addDecal(decals, 'sigil', x, g, z, 1.05 * rig.size.scale, st.plan.duration + .8, 0x66ff99, rand(s, 3) * 6.28); addDecal(decals, 'mound', x, g, z, .7 * rig.size.scale, st.plan.duration + 4, 0xffffff, rand(s, 4) * 6.28); }
    st.firstU ??= u;
    const fresh = at => u > at && st.firstU <= at; // late joiners skip bursts already past
    const hand = (lead) => {
      const left = lead === st.plan.leadLeft, arm = left ? rig.armL : rig.armR, tip = left ? rig.tips.armL : rig.tips.armR;
      if (!arm) return handPos.set(x, g, z);
      arm.getWorldPosition(handPos);
      if (tip) handPos.addScaledVector(_v.copy(tip).transformDirection(arm.matrixWorld), rig.size.arm * .85);
      handPos.y = H(handPos.x, handPos.z); return handPos;
    };
    if (fresh(.1) && once(st, 'hand1')) { const p = hand(true); burstDirt(p.x, p.y, p.z, 26, 1.6, s, 1); wisps(p.x, p.y, p.z, 6, s, 1); }
    if (fresh(.27) && once(st, 'hand2')) { const p = hand(false); burstDirt(p.x, p.y, p.z, 22, 1.5, s, 2); wisps(p.x, p.y, p.z, 5, s, 2); }
    if (fresh(.4) && once(st, 'torso')) { burstDirt(x, g, z, 70, 2.1, s, 3, 2.2); wisps(x, g, z, 14, s, 3, [.45, 1, .6], 1.4, 1.6); }
    if (fresh(.62) && once(st, 'legs')) burstDirt(x, g, z, 30, 1.2, s, 4, 2.6);
    // Soil dribbling off the ribs while it rises (bounded, frame-rate independent via threshold buckets).
    const bucket = Math.floor(u * 40);
    if (u > .35 && u < .85 && bucket !== st.lastBucket && rig.torso) {
      st.lastBucket = bucket; rig.torso.getWorldPosition(_v);
      for (let i = 0; i < 3; i++) emit(dirt, _v.x + (rand(s, bucket * 7 + i) - .5) * .3, _v.y + rand(s, bucket * 9 + i) * .25, _v.z + (rand(s, bucket * 11 + i) - .5) * .3, 0, -.2, 0, .22, .16, .1, 1.1, -9.8, .3);
    }
  }

  // ---- golem assembly ----------------------------------------------------
  // Actual authored pieces, assembled in this order. Each window is a
  // fraction of the seeded duration; plates are staggered per actor.
  const GOLEM_PIECES = [
    ['LegL', .06, .34], ['LegR', .1, .38], ['BodyCore', .22, .54], ['ChestPlate', .5, .74],
    ['ArmL', .36, .68], ['ArmR', .42, .74], ['ShoulderL', .58, .82], ['ShoulderR', .62, .85],
    ['ForearmL', .64, .87], ['ForearmR', .67, .89], ['Head', .76, .96],
  ];
  function golemRig(st) {
    const v = st.visual, plan = st.plan, s = plan.seed;
    actorFrame(st.entry.root); v.updateWorldMatrix(true, true);
    const g = rootP.y, scale = st.entry.root.getWorldScale(_ws).y || 1;
    const head = findAny(v, 'Head'), body = findAny(v, 'BodyCore'), core = v.getObjectByName('CoreGlow');
    const tall = Math.max(1, head ? head.getWorldPosition(_v).y - g : 2.2 * scale);
    const pieces = [];
    for (const [name, a0, a1] of GOLEM_PIECES) {
      const node = findAny(v, name); if (!node || node === v) continue;
      let start = a0, end = a1;
      if (/L$/.test(name) !== plan.leadLeft && /[LR]$/.test(name)) { start += .03; end += .03; } // lead side first
      if (/Plate|Shoulder|Forearm/.test(name)) { const j = (rand(s, pieces.length) - .5) * .06; start += j; end = Math.min(.93, end + j); }
      node.getWorldPosition(_v); _v.sub(rootP); _v.y = 0;
      let ang = _v.lengthSq() > .01 ? Math.atan2(_v.dot(aF), _v.dot(aR)) : rand(s, 20 + pieces.length) * Math.PI * 2;
      ang += (rand(s, 40 + pieces.length) - .5) * .9;
      const legs = /^Leg/.test(name), isHead = name === 'Head';
      pieces.push({name, node, rec: track(st, node), start: clamp(start, 0, .95), end: clamp(end, start + .08, .97), ang,
        radius: (legs ? .35 : isHead ? .25 : .9 + rand(s, 60 + pieces.length) * .6) * tall * .5,
        depth: (legs || name === 'BodyCore' ? .9 : 1.25) * tall, lift: (isHead ? .55 : legs ? .05 : .2 + rand(s, 80 + pieces.length) * .25) * tall,
        orbit: (legs ? .25 : isHead ? .8 : 1.1 + rand(s, 100 + pieces.length) * .7) * Math.PI * plan.spin,
        axis: new THREE.Vector3(rand(s, 120 + pieces.length) - .5, rand(s, 140 + pieces.length) - .5, rand(s, 160 + pieces.length) - .5).normalize(),
        tumble: (legs ? 1.2 : 2.6 + rand(s, 180 + pieces.length) * 2.2) * (rand(s, 200 + pieces.length) < .5 ? -1 : 1)});
    }
    const color = coreColor(v), frame = findAny(v, 'Golem');
    return {pieces, head, body, core, tall, scale, color, colorArr: [color.r, color.g, color.b], frame: frame !== v ? frame : null};
  }
  // Binding colour comes from the authored CoreGlow material, not a guess.
  function coreColor(v) {
    let core = null; v.traverse(n => { if (!core && n.isMesh && /coreglow/i.test(n.name + (n.parent?.name || ''))) core = n; });
    const m = core?.material && (Array.isArray(core.material) ? core.material[0] : core.material);
    if (m?.emissive && m.emissive.getHex()) return (sourceOf.get(m) || m).emissive.clone();
    return m?.color ? m.color.clone() : new THREE.Color(0x66ccff);
  }
  const off = new THREE.Vector3(), radial = new THREE.Vector3(), corePos = new THREE.Vector3();
  function poseGolem(st, tick) {
    const data = st.entry.data;
    if (data.meteorBorn) return false; // meteor-creature.js owns meteor-born unfurl
    const rig = st.rig ||= golemRig(st), plan = st.plan;
    const age = (tick - st.emergeStart) / TICK_RATE, u = clamp(age / plan.duration, 0, 1);
    if (u >= 1) return false;
    actorFrame(st.entry.root);
    st.firstU ??= u;
    if (rig.frame && !rig.frameRec) rig.frameRec = track(st, rig.frame);
    for (const r of st.recs) open(r);
    const s = plan.seed, missing = data.missingParts || [];
    // Rumble on the authored body node (below entry.root) while pieces gather.
    const body = rig.frame;
    if (body) {
      const amp = (u < .55 ? smooth(u / .1) : 1 - smooth((u - .55) / .4)) * .02 * rig.tall;
      off.copy(aR).multiplyScalar(noise1(s, 30, age * 22) * amp).addScaledVector(aF, noise1(s, 31, age * 19) * amp); offsetWorld(body, off);
    }
    if (rig.body) rig.body.getWorldPosition(corePos); else corePos.copy(rootP).addScaledVector(aU, rig.tall * .55);
    for (const p of rig.pieces) {
      if (missing.includes(canonicalPart(p.name)) && p.name !== 'BodyCore') continue;
      const lu = clamp((u - p.start) / (p.end - p.start), 0, 1);
      if (lu >= 1) { // brief settle bounce after the snap
        const since = (u - p.end) * plan.duration;
        if (since < .22) { off.copy(aU).multiplyScalar(-Math.sin(since / .22 * Math.PI) * .025 * rig.tall * (1 - since / .22)); offsetWorld(p.node, off); }
        if (once(st, 'snap:' + p.name) && p.end > st.firstU) snapFx(st, p, rig); // late joiners do not replay old snaps
        continue;
      }
      // Path: underground -> rising hover on an orbit -> accelerating slam home.
      const rise = easeOut(lu / .55), slam = easeIn((lu - .55) / .45);
      const ang = p.ang + p.orbit * (1 - lu) * (1 - lu);
      radial.copy(aR).multiplyScalar(Math.cos(ang)).addScaledVector(aF, Math.sin(ang));
      const r = lu < .55 ? mix(p.radius * .6, p.radius, rise) : p.radius * (1 - slam);
      const y = lu < .55 ? mix(-p.depth, p.lift, rise) : p.lift * (1 - slam);
      off.copy(radial).multiplyScalar(r).addScaledVector(aU, y); // additive to the authored placement
      offsetWorld(p.node, off);
      const spin = p.tumble * (1 - easeOut(lu)) ** 1.5;
      if (spin) { _v3.copy(p.axis); rotateWorld(p.node, _v3.applyQuaternion(rootQ), spin); }
      if (lu > .05 && binds.n < LIMITS.binds && rig.body && p.node !== rig.body) {
        p.node.getWorldPosition(_v2); bindLine(_v2, corePos, rig.colorArr, (1 - lu) * .8 + .2 * Math.sin(age * 25 + p.ang) ** 2);
      }
      const trail = Math.floor(age * 8);
      if (lu > 0 && lu < .5 && trail !== p.trail) { // soil shedding off rising pieces
        p.trail = trail; p.node.getWorldPosition(_v2); emit(dirt, _v2.x, _v2.y, _v2.z, 0, -.5, 0, .3, .27, .24, .8, -9.8, .2);
      }
    }
    close(st);
    golemEffects(st, u, rig, age);
    return true;
  }
  function snapFx(st, p, rig) {
    p.node.getWorldPosition(_v2); const s = st.plan.seed, ch = 10 + p.name.length * 3 + (p.name.endsWith('R') ? 1 : 0);
    const heavy = /^(Leg|BodyCore|Head)/.test(p.name);
    for (let i = 0; i < (heavy ? 18 : 10); i++) {
      const a = rand(s, ch * 31 + i) * Math.PI * 2, sp = .8 + rand(s, ch * 37 + i) * 1.6, c = .3 + .2 * rand(s, ch * 41 + i);
      emit(dirt, _v2.x, _v2.y, _v2.z, Math.cos(a) * sp, .8 + rand(s, ch * 43 + i) * 1.8, Math.sin(a) * sp, c, c * .92, c * .85, .7 + rand(s, ch * 47 + i) * .6, -9.8, .5);
    }
    wisps(_v2.x, _v2.y, _v2.z, heavy ? 10 : 6, s, ch, rig.colorArr, .6, .5);
    if (/^Leg/.test(p.name)) burstDirt(_v2.x, H(_v2.x, _v2.z), _v2.z, 22, 1.4, s, ch + 50, 1.6);
    if (p.name === 'Head') { wisps(_v2.x, _v2.y, _v2.z, 24, s, 99, rig.colorArr, 1.6, .9); if (rig.body) { rig.body.getWorldPosition(_v); wisps(_v.x, _v.y, _v.z, 18, s, 98, rig.colorArr, .4, .8); } }
  }
  function golemEffects(st, u, rig, age) {
    const s = st.plan.seed, x = rootP.x, z = rootP.z, g = H(x, z);
    if (once(st, 'crack')) { addDecal(decals, 'crack', x, g, z, 1.5 * rig.tall * .5, st.plan.duration + 1.6, rig.color, rand(s, 5) * 6.28); addDecal(decals, 'mound', x, g, z, .95 * rig.tall * .5, st.plan.duration + 5, 0xffffff, rand(s, 6) * 6.28); }
    const bucket = Math.floor(age * 12); // rumbling debris, bounded per bucket
    if (u < .7 && bucket !== st.lastBucket) {
      st.lastBucket = bucket;
      for (let i = 0; i < 4; i++) {
        const a = rand(s, bucket * 13 + i) * Math.PI * 2, r = (.3 + rand(s, bucket * 17 + i)) * rig.tall * .45, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        emit(dirt, px, H(px, pz) + .02, pz, Math.cos(a) * .3, 1 + rand(s, bucket * 19 + i) * 1.5, Math.sin(a) * .3, .28, .24, .2, .9, -9.8, .4);
      }
      if (u < .45) wisps(x, g, z, 2, s, 300 + bucket, rig.colorArr, .9, .9);
    }
  }

  // Binding lines (piece -> core) rebuilt each frame; one draw call.
  const binds = (() => {
    const cap = LIMITS.binds, geometry = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage), col = new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', pos); geometry.setAttribute('color', col); geometry.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false}));
    lines.frustumCulled = false; lines.userData.ignoreContact = true; lines.renderOrder = 3;
    return {lines, pos: pos.array, col: col.array, n: 0};
  })();
  group.add(binds.lines);
  function bindLine(a, b, c, k) {
    const i = binds.n++ * 6;
    binds.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i); binds.col.set([c[0] * k, c[1] * k, c[2] * k, c[0] * k * .3, c[1] * k * .3, c[2] * k * .3], i);
  }

  // ---- damage: scorch + cracks/chips -------------------------------------
  // One shared shader variant per SOURCE material (bounded by the asset set),
  // fed per draw by material.onBeforeRender from object.userData.cldDamage.
  // Values persist on actor records; no per-actor material/texture clones.
  const variants = new Map(), variantOf = new WeakSet(), sourceOf = new WeakMap();
  const SUPPORTED = m => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
  const ZERO = new Float32Array(32), BLACK = new THREE.Color(0);
  function variant(source) {
    if (!SUPPORTED(source) || variantOf.has(source)) return source;
    let m = variants.get(source);
    if (m) return m;
    m = source.clone(); m.name = `${source.name || 'mat'}:cld`;
    const u = m.userData.cld = {cldScorch: {value: ZERO}, cldCrack: {value: ZERO}, cldGlow: {value: 0}, cldCore: {value: 0}, cldScale: {value: 4}, cldGlowColor: {value: new THREE.Color()}};
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float cldScorch[32];\nuniform float cldCrack[32];\nvarying float vCldScorch;\nvarying float vCldCrack;\nvarying vec3 vCldPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vCldPos = position;
#ifdef USE_SKINNING
  ivec4 cldI = min(ivec4(skinIndex), ivec4(31));
  vCldScorch = cldScorch[cldI.x] * skinWeight.x + cldScorch[cldI.y] * skinWeight.y + cldScorch[cldI.z] * skinWeight.z + cldScorch[cldI.w] * skinWeight.w;
  vCldCrack = cldCrack[cldI.x] * skinWeight.x + cldCrack[cldI.y] * skinWeight.y + cldCrack[cldI.z] * skinWeight.z + cldCrack[cldI.w] * skinWeight.w;
#else
  vCldScorch = cldScorch[0]; vCldCrack = cldCrack[0];
#endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float cldGlow; uniform float cldCore; uniform float cldScale; uniform vec3 cldGlowColor;
varying float vCldScorch; varying float vCldCrack; varying vec3 vCldPos;
float cldHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cldNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(cldHash(i), cldHash(i + vec3(1,0,0)), f.x), mix(cldHash(i + vec3(0,1,0)), cldHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cldHash(i + vec3(0,0,1)), cldHash(i + vec3(1,0,1)), f.x), mix(cldHash(i + vec3(0,1,1)), cldHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 cldP = vCldPos * cldScale;
float cldN = cldNoise(cldP * 1.7) * .6 + cldNoise(cldP * 4.3) * .4;
float cldS = clamp(vCldScorch * 1.35 - (1. - cldN) * .5, 0., 1.);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.11, .09, .075) + vec3(.018, .014, .01), smoothstep(0., 1., cldS));
float cldV = abs(cldNoise(cldP * 2.9 + 7.1) - .5) * 2.;
float cldW = vCldCrack * (.05 + .09 * cldNoise(cldP * 9.));
float cldMask = (1. - smoothstep(cldW * .45, cldW, cldV)) * step(.02, vCldCrack);
float cldChip = smoothstep(.8 - vCldCrack * .22, .86 - vCldCrack * .22, cldNoise(cldP * 2.2 + 3.)) * vCldCrack;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.18 + vec3(.05, .045, .04), cldChip * .65);
diffuseColor.rgb *= 1. - cldMask * .82;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float cldEmber = smoothstep(.2, .5, cldS) * (1. - smoothstep(.6, .95, cldS)) * smoothstep(.62, .9, cldNoise(cldP * 6.5)) * vCldScorch;
totalEmissiveRadiance += vec3(1., .33, .05) * cldEmber * .8 + cldGlowColor * cldMask * cldGlow;
totalEmissiveRadiance *= 1. + cldCore;`);
    };
    m.customProgramCacheKey = () => `cld1:${source.customProgramCacheKey?.() ?? ''}`;
    m.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      const d = object.userData.cldDamage, r = d?.rec;
      u.cldScorch.value = r ? r.scorch : ZERO; u.cldCrack.value = r ? r.crack : ZERO;
      u.cldGlow.value = r ? r.glow : 0; u.cldCore.value = r && object.userData.cldCoreMesh ? r.core : 0;
      u.cldScale.value = d ? d.scale : 4; u.cldGlowColor.value.copy(r ? r.color : BLACK);
      m.uniformsNeedUpdate = true;
    };
    variants.set(source, m); variantOf.add(m); sourceOf.set(m, source);
    return m;
  }
  function damageSetup(st) {
    const v = st.visual, root = st.entry.root, rs = root.getWorldScale(_ws).x || 1;
    const meshes = [], recs = new Map(), golem = st.kind === 'golem';
    const color = golem ? (st.rig?.color || coreColor(v)) : new THREE.Color(.25, 1, .5);
    v.updateWorldMatrix(true, true);
    v.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData.ignoreContact || mesh.userData.meteorDecor) return;
      let key, map;
      if (mesh.isSkinnedMesh && mesh.skeleton) { key = mesh.skeleton; map = mesh.skeleton.bones.slice(0, 32).map(b => canonicalPart(b.name)); }
      else { let part = 'torso'; for (let n = mesh; n && n !== v; n = n.parent) { const c = canonicalPart(n.name); if (c !== 'torso' || /torso|bodycore/i.test(n.name)) { part = c; break; } } key = part; map = [part]; }
      let rec = recs.get(key);
      if (!rec) recs.set(key, rec = {map, scorch: new Float32Array(32), crack: new Float32Array(32), glow: 0, core: 0, color});
      mesh.getWorldScale(_v);
      mesh.userData.cldDamage = {rec, scale: 4.2 * (_v.x / rs)};
      if (golem && /coreglow/i.test(mesh.name + (mesh.parent?.name || ''))) mesh.userData.cldCoreMesh = true;
      meshes.push(mesh);
    });
    return {meshes, recs: [...recs.values()], shown: Object.fromEntries(PARTS.map(p => [p, 0])), local: Object.fromEntries(PARTS.map(p => [p, 0])), cracks: Object.fromEntries(PARTS.map(p => [p, 0]))};
  }
  function updateDamage(st, dt) {
    const data = st.entry.data;
    const any = PARTS.some(p => (data.scorch?.[p] || 0) > .001 || partDamage(data, p) > .001 || st.dmg?.local[p] > .001) || bodyDamage(data) > .1 || (st.kind === 'golem' && data.armor === 0);
    if (!st.dmg && !any) return;
    st.dmg ||= damageSetup(st);
    const dm = st.dmg, k = 1 - Math.exp(-dt * 2.2), golem = st.kind === 'golem', low = bodyDamage(data);
    for (const p of PARTS) {
      const target = Math.max(clamp(Number(data.scorch?.[p]) || 0, 0, 1), dm.local[p]);
      dm.shown[p] += (target - dm.shown[p]) * k; // char creeps in; never an instant black swap
      dm.cracks[p] += (partDamage(data, p) - dm.cracks[p]) * Math.min(1, k * 3);
    }
    const pulse = .75 + .25 * Math.sin(frame * .09 * (1 + 2 * low));
    for (const r of dm.recs) {
      r.map.forEach((p, i) => { r.scorch[i] = dm.shown[p]; r.crack[i] = dm.cracks[p]; });
      r.glow = golem ? smooth((low - .4) / .45) * 1.6 * pulse : smooth((low - .6) / .4) * .35 * pulse;
      r.core = golem && (data.armor ?? 3) === 0 ? (.6 + 1.4 * low) * pulse : 0;
    }
    for (const mesh of dm.meshes) {
      if (Array.isArray(mesh.material)) { if (mesh.material.some(m => !variantOf.has(m))) mesh.material = mesh.material.map(variant); }
      else if (!variantOf.has(mesh.material)) mesh.material = variant(mesh.material);
    }
  }
  function releaseDamage(st) {
    for (const mesh of st.dmg?.meshes || []) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => sourceOf.get(m) || m) : sourceOf.get(mesh.material) || mesh.material;
      delete mesh.userData.cldDamage; delete mesh.userData.cldCoreMesh;
    }
    st.dmg = null;
  }

  // ---- death: articulated collapse layered onto authoritative remains ----
  const corpses = new Map(); // source actor id -> corpse
  const COLLAPSE = {skeleton: {T: 1, fall: .5, tilt: 1.15, crumple: .5}, golem: {T: 1.3, fall: .72, tilt: .8, crumple: .3}};
  const PART_DROP = {head: .55, torso: .5, leftArm: .45, rightArm: .45, leftLeg: .22, rightLeg: .22};
  const PART_SWING = {head: .55, torso: 0, leftArm: -.75, rightArm: -.6, leftLeg: -.3, rightLeg: -.25};
  function killDirection(st, event, out) {
    const n = event?.normal || st?.lastHit?.normal;
    if (n) out.set(-n[0], 0, -n[2]); else out.set(0, 0, 0);
    if (out.lengthSq() < 1e-6 && st?.entry?.root) { st.entry.root.getWorldQuaternion(_q); out.set(0, 0, 1).applyQuaternion(_q); out.y = 0; } // fall backward
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    return out.normalize();
  }
  const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _sq = new THREE.Quaternion();
  function collapsePose(c, piece, t, outP, outQ) {
    const P = COLLAPSE[c.kind], f = clamp(t / P.fall, 0, 1);
    const fall = f * f; // gravity-like
    const bounce = t > P.fall ? Math.sin(clamp((t - P.fall) / .25, 0, 1) * Math.PI) * .07 * (1 - clamp((t - P.fall) / .25, 0, 1)) : 0;
    const theta = P.tilt * (fall - bounce) * c.variance;
    _bq.setFromAxisAngle(c.axis, theta);
    outP.copy(piece.initP).sub(c.pivot).applyQuaternion(_bq).add(c.pivot);
    const h = piece.initP.y - c.pivot.y;
    outP.y -= Math.max(0, h) * P.crumple * (PART_DROP[piece.part] ?? .4) * smooth(f * 1.15);
    const lag = smooth((t - .06 * (piece.part === 'head' ? 2 : 1)) / P.fall);
    _sq.setFromAxisAngle(c.axis, (PART_SWING[piece.part] ?? 0) * lag * (piece.part.startsWith('left') ? c.flailL : c.flailR));
    outQ.copy(_sq).multiply(_bq).multiply(piece.initQ);
    const g = H(outP.x, outP.z) + .06; if (outP.y < g) outP.y = g;
  }
  function death(entry, event = {}) {
    const id = entry?.data?.id ?? event.id; if (id == null) return null;
    const st = states.get(id), kind = (entry?.data?.kind || event.kind) === 'golem' ? 'golem' : 'skeleton', seed = hashId(id);
    if (corpses.size >= LIMITS.corpses) { const first = corpses.keys().next().value; endCorpse(corpses.get(first)); }
    const pivot = new THREE.Vector3();
    if (entry?.root) entry.root.getWorldPosition(pivot); else if (event.position) pivot.fromArray(event.position);
    const dir = killDirection(st, event, new THREE.Vector3());
    const c = {id, kind, seed, pivot, dir, axis: new THREE.Vector3(0, 1, 0).cross(dir).normalize(), age: 0, pieces: new Map(),
      variance: .85 + rand(seed, 7) * .3, flailL: .7 + rand(seed, 8) * .6, flailR: .7 + rand(seed, 9) * .6,
      damage: st?.dmg ? Object.fromEntries(PARTS.map(p => [p, {scorch: st.dmg.shown[p], crack: st.dmg.cracks[p]}])) : null, color: st?.rig?.color || null};
    if (c.axis.lengthSq() < 1e-6) c.axis.set(1, 0, 0);
    corpses.set(id, c);
    // Death accents: the binding leaves the body.
    const v = entry?.visual, head = v && (find(v, 'Head') || v.getObjectByName('Head'));
    if (head) head.getWorldPosition(_v2); else _v2.copy(pivot).addScaledVector(YAXIS, kind === 'golem' ? 2.4 : 1.5);
    if (kind === 'skeleton') { wisps(_v2.x, _v2.y, _v2.z, 16, seed, 400, [.4, 1, .6], 1.3, 1.3); burstDirt(pivot.x, H(pivot.x, pivot.z), pivot.z, 16, .9, seed, 401, 1.5); }
    else {
      const col = c.color ? [c.color.r, c.color.g, c.color.b] : [.4, .8, 1];
      const core = v && findAny(v, 'BodyCore'); if (core) core.getWorldPosition(_v2);
      wisps(_v2.x, _v2.y, _v2.z, 30, seed, 402, col, 1.8, 1.1);
      addDecal(decals, 'crack', pivot.x, H(pivot.x, pivot.z), pivot.z, 1.2, 2.2, c.color || 0x66ccff, rand(seed, 3) * 6.28);
    }
    if (st) release(st);
    return c;
  }
  function endCorpse(c) { if (!c) return; for (const p of c.pieces.values()) undoPiece(p); corpses.delete(c.id); }
  function undoPiece(p) {
    if (!p.dirty) return;
    if (p.node.position.equals(p.wroteP)) p.node.position.copy(p.preP);
    if (p.node.quaternion.equals(p.wroteQ)) p.node.quaternion.copy(p.preQ);
    p.dirty = false;
  }
  // nodes: Map(detachedId -> node) (combat-view `detached`), parts: snapshot.detachedParts.
  function syncDetached(nodes, parts = []) {
    for (const data of parts) {
      const node = nodes?.get?.(data.id); if (!node) continue;
      const c = corpses.get(data.sourceId), st = states.get(data.sourceId);
      if (!node.userData.cldDamageSet && (c?.damage || st?.dmg)) { // persistent char/cracks on the remains
        const d = c?.damage?.[data.part] || {scorch: st.dmg.shown[data.part], crack: st.dmg.cracks[data.part]};
        const rec = {map: [data.part], scorch: new Float32Array(32).fill(d.scorch, 0, 1), crack: new Float32Array(32).fill(d.crack, 0, 1), glow: 0, core: 0, color: c?.color || BLACK};
        node.traverse(m => { if (m.isMesh) { m.userData.cldDamage = {rec, scale: 4.2}; if (!Array.isArray(m.material) && variantOf.has(m.material) === false && (d.scorch > .001 || d.crack > .001)) m.material = variant(m.material); } });
        node.userData.cldDamageSet = true;
      }
      if (!c || data.heldBy || c.age >= COLLAPSE[c.kind].T) continue;
      let piece = c.pieces.get(data.id);
      if (!piece) {
        if (c.pieces.size >= 8) continue;
        piece = {node, part: data.part, initP: node.position.clone(), initQ: node.quaternion.clone(), preP: new THREE.Vector3(), preQ: new THREE.Quaternion(), wroteP: new THREE.Vector3(), wroteQ: new THREE.Quaternion(), dirty: false};
        c.pieces.set(data.id, piece);
      }
      if (piece.node !== node) continue;
      piece.preP.copy(node.position); piece.preQ.copy(node.quaternion);
      const P = COLLAPSE[c.kind], b = smooth((c.age - P.fall * .7) / (P.T - P.fall * .7));
      collapsePose(c, piece, c.age, _cp, _cq);
      node.position.lerpVectors(_cp, piece.preP, b); node.quaternion.slerpQuaternions(_cq, piece.preQ, b);
      piece.wroteP.copy(node.position); piece.wroteQ.copy(node.quaternion); piece.dirty = true;
      if (!piece.landed && c.age > P.fall * .9) { // dust where it meets the ground
        piece.landed = true; const s = c.seed, ch = 500 + data.part.length;
        burstDirt(node.position.x, H(node.position.x, node.position.z), node.position.z, c.kind === 'golem' ? 12 : 7, .8, s, ch, 1);
      }
    }
  }

  // ---- hits ---------------------------------------------------------------
  function hit(entry, event = {}) {
    const st = entry?.data ? stateFor(entry) : states.get(event.id);
    if (!st) return;
    if (event.normal) st.lastHit = {normal: [...event.normal], part: event.part, tick: lastTick};
    const p = event.position || event.point; if (!p) return;
    const s = st.plan.seed ^ hashId(lastTick + ':' + (event.part || '')), n = event.normal || [0, 1, 0], e = clamp(event.energy ?? 1, .3, 2);
    const golem = st.kind === 'golem', count = Math.round((golem ? 10 : 7) * e);
    for (let i = 0; i < count; i++) {
      const a = (rand(s, i) - .5) * 2.4, b = (rand(s, i + 50) - .5) * 2.4, sp = 1.2 + rand(s, i + 99) * 2 * e;
      const c = golem ? .35 + .15 * rand(s, i + 7) : .78 + .15 * rand(s, i + 7);
      emit(dirt, p[0], p[1], p[2], (n[0] + a * .5) * sp, (n[1] + .6 + b * .3) * sp, (n[2] + b * .5) * sp, c, c * (golem ? .93 : .95), c * (golem ? .86 : .82), .5 + rand(s, i + 13) * .5, -9.8, .8);
    }
    if (golem && (entry?.data?.armor ?? 0) > 0) for (let i = 0; i < 6; i++) emit(magic, p[0], p[1], p[2], n[0] * 2 + (rand(s, i + 200) - .5) * 3, n[1] * 2 + rand(s, i + 210) * 2, n[2] * 2 + (rand(s, i + 220) - .5) * 3, 1, .7, .3, .25, -6, 1);
    if (event.fire || event.scorch) {
      const part = PARTS.includes(event.part) ? event.part : 'torso';
      st.dmg ||= (st.visual && !st.placeholder ? damageSetup(st) : null);
      if (st.dmg) st.dmg.local[part] = clamp(st.dmg.local[part] + (Number(event.scorch) || .25), 0, 1);
      for (let i = 0; i < 8; i++) emit(magic, p[0], p[1], p[2], (rand(s, i + 300) - .5) * .8, .6 + rand(s, i + 310), (rand(s, i + 320) - .5) * .8, 1, .45, .08, .6 + rand(s, i + 330) * .5, 0, 1.5);
    }
  }

  // ---- public API ---------------------------------------------------------
  function beginFrame() {
    frame++; binds.n = 0;
    for (const st of states.values()) undo(st);
    for (const c of corpses.values()) for (const p of c.pieces.values()) undoPiece(p);
  }

  function sync(entry, tick, dt = 1 / 60) {
    if (!entry?.data || !entry.visual || !entry.root) return null;
    lastTick = Number.isFinite(tick) ? tick : lastTick;
    const st = stateFor(entry);
    if (st.placeholder || entry.visual.userData.placeholder) return st;
    if (st.emergeStart == null) st.emergeStart = emergeStartTick(entry.data);
    st.emerging = false;
    if (st.emergeStart != null && lastTick < st.emergeStart + st.plan.duration * TICK_RATE + 1) {
      const t = Math.max(lastTick, st.emergeStart);
      st.emerging = st.kind === 'skeleton' ? poseSkeleton(st, t) : poseGolem(st, t);
    }
    updateDamage(st, clamp(dt, 0, .1));
    return st;
  }

  function tick(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, .1);
    elapsedSeconds += dt;
    stepParticles(dirt, dt, H); stepParticles(magic, dt, H); stepDecals(decals, dt);
    const g = binds.lines.geometry; g.setDrawRange(0, binds.n * 2); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    for (const c of [...corpses.values()]) if ((c.age += dt) > COLLAPSE[c.kind].T + .1) endCorpse(c);
    for (const st of [...states.values()]) if (elapsedSeconds - st.seenAt > 3) release(st); // duration independent of display refresh
  }

  function remove(entryOrId) { const st = states.get(entryOrId?.data?.id ?? entryOrId); if (st) release(st); }

  function dispose() {
    for (const st of [...states.values()]) release(st);
    for (const c of [...corpses.values()]) endCorpse(c);
    group.removeFromParent();
    for (const sys of [dirt, magic]) { sys.points.geometry.dispose(); sys.points.material.dispose(); }
    binds.lines.geometry.dispose(); binds.lines.material.dispose();
    for (const o of decals.owned) o.dispose();
    for (const m of Object.values(decals.meshes)) m.dispose?.();
    for (const m of variants.values()) m.dispose();
    variants.clear();
  }

  function isEmerging(id) { return !!states.get(id)?.emerging; }
  function stats() { return {presentationTick:lastTick, actors: states.size, corpses: corpses.size, dirt: dirt.n, magic: magic.n, decals: decals.items.length, binds: binds.n, variants: variants.size}; }

  return {beginFrame, sync, hit, death, syncDetached, tick, remove, dispose, isEmerging, stats, group};
}
