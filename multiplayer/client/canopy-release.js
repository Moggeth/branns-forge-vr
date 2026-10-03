// Canopy release: a bounded, pooled foliage burst for the moment a felled tree touches down.
// Two InstancedMeshes (folded-diamond leaves, tiny faceted motes) -> two draw calls total, no
// textures, no transparency, no timers. Time is the sum of tick() deltas; burst() stamps that time.
import * as T from 'three';

export const MAX_LEAVES = 128;
export const MAX_MOTES = 64;
export const DURATION = 0.8; // seconds; every particle is gone (scale 0, culled) by then
const LEAVES_PER_BURST = 40;
const MOTES_PER_BURST = 16;
const MAX_INPUT_POINTS = 512; // inputs beyond this are evenly strided (deterministic)

const LEAF_PALETTE = [0x2f7d32, 0x3f9a3a, 0x58ad3f, 0x76b83c, 0x9bc83f, 0xc2b838]; // lush -> sun-ripe
const MOTE_PALETTE = [0xd9e36b, 0xf0d45a, 0xb8d84c, 0xf4c24a];

// ---- shared leaf geometry: folded diamond, base at origin, tip at +Y, length 1 -----------------
// Spine dips below the wing edges (V fold) and wings are pushed forward so it reads as a real,
// slightly cupped leaf rather than a flat card. Vertex colour gives rib-dark / edge-light shading.
function buildLeafGeometry() {
  const P = [], C = [];
  const v = (x, y, z, shade) => { P.push(x, y, z); C.push(shade * 0.9, shade, shade * 0.8); };
  // spine 0..4
  v(0, 0, 0, 0.55); v(0, 0.15, -0.02, 0.7); v(0, 0.4, -0.05, 0.72); v(0, 0.7, -0.02, 0.78); v(0, 1, 0.05, 0.95);
  // left wing 5..7, right wing 8..10
  v(-0.12, 0.15, 0.04, 0.9); v(-0.26, 0.4, 0.11, 1.05); v(-0.14, 0.7, 0.08, 1.0);
  v(0.12, 0.15, 0.04, 0.9); v(0.26, 0.4, 0.11, 1.05); v(0.14, 0.7, 0.08, 1.0);
  const idx = [
    0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4,
    0, 1, 8, 1, 9, 8, 1, 2, 9, 2, 10, 9, 2, 3, 10, 3, 4, 10,
  ];
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- tiny seeded PRNG (mulberry32); module state, reseeded per burst, zero allocation ----------
let rs = 1;
function seedRng(seed) {
  let s = typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 1;
  rs = (s ^ 0x9e3779b9) >>> 0 || 1;
}
function rnd() {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeOutBack = (t) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

export function createCanopyRelease({ group, scale = 1 } = {}) {
  if (!group || typeof group.add !== 'function' || typeof group.remove !== 'function') {
    throw new TypeError('createCanopyRelease: {group} must be a THREE.Object3D');
  }
  const S = Number.isFinite(scale) && scale > 0 ? scale : 1;

  // shared geometry/material: one each per pool
  const leafGeo = buildLeafGeometry();
  const moteGeo = new T.OctahedronGeometry(1, 0);
  const leafMat = new T.MeshStandardMaterial({
    vertexColors: true, flatShading: true, side: T.DoubleSide, roughness: 0.62, metalness: 0,
  });
  const moteMat = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3d3606, flatShading: true });

  function makePool(geo, mat, cap, name) {
    const mesh = new T.InstancedMesh(geo, mat, cap);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // instances live in world space; the stale bounding sphere would cull them
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return {
      mesh, cap, hi: 0, next: 0, active: 0,
      alive: new Uint8Array(cap), birth: new Float64Array(cap), life: new Float32Array(cap),
      p0: new Float32Array(cap * 3), dir: new Float32Array(cap * 2), // start point; outward unit xz
      out: new Float32Array(cap), rise: new Float32Array(cap), fall: new Float32Array(cap),
      curl: new Float32Array(cap), size: new Float32Array(cap), aspect: new Float32Array(cap),
      axis: new Float32Array(cap * 3), spin: new Float32Array(cap), qb: new Float32Array(cap * 4),
      phase: new Float32Array(cap),
    };
  }
  const leaves = makePool(leafGeo, leafMat, MAX_LEAVES, 'canopy-release-leaves');
  const motes = makePool(moteGeo, moteMat, MAX_MOTES, 'canopy-release-motes');

  // scratch (allocated once)
  const _m = new T.Matrix4(), _pos = new T.Vector3(), _scl = new T.Vector3();
  const _q = new T.Quaternion(), _qb = new T.Quaternion(), _ax = new T.Vector3(), _col = new T.Color();
  const _id = new T.Quaternion(), _zero = new T.Matrix4().makeScale(0, 0, 0);
  const pts = new Float32Array(MAX_INPUT_POINTS * 3);

  let clock = 0, bursts = 0, recycled = 0, disposed = false, nPts = 0, cx = 0, cy = 0, cz = 0;

  // ---- per-particle pose at current clock ------------------------------------------------------
  function writeLeaf(i) {
    const P = leaves, u = Math.min(1, (clock - P.birth[i]) / P.life[i]);
    const o = P.out[i] * easeOutCubic(u);
    const a = P.curl[i] * u * u;                   // curl: displacement swings round its start point
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = P.dir[i * 2] * o, dz = P.dir[i * 2 + 1] * o;
    const flutter = Math.sin(P.phase[i] + u * 7) * 0.05 * S * u;
    _pos.set(
      P.p0[i * 3] + dx * ca - dz * sa,
      P.p0[i * 3 + 1] + P.rise[i] * easeOutCubic(u) - P.fall[i] * u * u + flutter,
      P.p0[i * 3 + 2] + dx * sa + dz * ca,
    );
    _ax.set(P.axis[i * 3], P.axis[i * 3 + 1], P.axis[i * 3 + 2]);
    _q.setFromAxisAngle(_ax, P.spin[i] * u * DURATION); // tumble
    _qb.set(P.qb[i * 4], P.qb[i * 4 + 1], P.qb[i * 4 + 2], P.qb[i * 4 + 3]);
    _q.multiply(_qb);
    const bloom = 0.3 + 0.7 * easeOutBack(Math.min(1, u / 0.24));  // pops open with slight overshoot
    const shrink = 1 - smooth(0.45, 1, u);                         // then curls away to nothing
    const s = P.size[i] * bloom * shrink;
    const fold = 1 - 0.5 * smooth(0.3, 0.9, u);                    // leaf narrows as it curls in on itself
    _scl.set(s * P.aspect[i] * fold, s, s * (1 + 0.6 * (1 - fold)));
    _m.compose(_pos, _q, _scl);
    P.mesh.setMatrixAt(i, _m);
  }

  function writeMote(i) {
    const P = motes, u = Math.min(1, (clock - P.birth[i]) / P.life[i]);
    const o = P.out[i] * easeOutCubic(u);
    const a = P.curl[i] * u;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = P.dir[i * 2] * o, dz = P.dir[i * 2 + 1] * o;
    _pos.set(
      P.p0[i * 3] + dx * ca - dz * sa,
      P.p0[i * 3 + 1] + P.rise[i] * easeOutCubic(u) - P.fall[i] * u * u,
      P.p0[i * 3 + 2] + dx * sa + dz * ca,
    );
    const twinkle = 0.8 + 0.2 * Math.sin(P.phase[i] + u * DURATION * 22);
    const s = P.size[i] * (0.4 + 0.6 * easeOutBack(Math.min(1, u / 0.2))) * (1 - smooth(0.4, 1, u)) * twinkle;
    _scl.set(s, s, s);
    _m.compose(_pos, _id, _scl);
    P.mesh.setMatrixAt(i, _m);
  }

  function claim(P) { // ring allocation: slots are taken in birth order, so a full pool overwrites the oldest
    const i = P.next;
    P.next = (i + 1) % P.cap;
    if (i >= P.hi) { P.hi = i + 1; P.mesh.count = P.hi; }
    if (P.alive[i]) recycled++; else { P.alive[i] = 1; P.active++; }
    P.birth[i] = clock;
    P.mesh.visible = true;
    return i;
  }

  function readPoints(points) {
    nPts = 0; cx = cy = cz = 0;
    if (!points || typeof points.length !== 'number') return;
    const flat = typeof points[0] === 'number';
    const total = flat ? Math.floor(points.length / 3) : points.length;
    const step = total > MAX_INPUT_POINTS ? total / MAX_INPUT_POINTS : 1;
    for (let j = 0; j < total && nPts < MAX_INPUT_POINTS; j++) {
      const k = Math.floor(j * step), q = flat ? null : points[k];
      let x, y, z;
      if (flat) { x = points[k * 3]; y = points[k * 3 + 1]; z = points[k * 3 + 2]; }
      else if (q && typeof q.x === 'number') { x = q.x; y = q.y; z = q.z; }
      else if (q && typeof q[0] === 'number') { x = q[0]; y = q[1]; z = q[2]; }
      else continue;
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
      pts[nPts * 3] = x; pts[nPts * 3 + 1] = y; pts[nPts * 3 + 2] = z; nPts++;
      cx += x; cy += y; cz += z;
    }
    if (nPts) { cx /= nPts; cy /= nPts; cz /= nPts; }
  }

  function setCommon(P, i, pi) {
    P.p0[i * 3] = pts[pi * 3]; P.p0[i * 3 + 1] = pts[pi * 3 + 1]; P.p0[i * 3 + 2] = pts[pi * 3 + 2];
    let dx = pts[pi * 3] - cx, dz = pts[pi * 3 + 2] - cz;
    const l = Math.hypot(dx, dz);
    if (l > 1e-4) { dx /= l; dz /= l; } else { const t = rnd() * 6.2831853; dx = Math.cos(t); dz = Math.sin(t); }
    const jt = (rnd() - 0.5) * 0.9; // angular scatter so the bloom isn't a perfect radial star
    const c = Math.cos(jt), s = Math.sin(jt);
    P.dir[i * 2] = dx * c - dz * s; P.dir[i * 2 + 1] = dx * s + dz * c;
    P.phase[i] = rnd() * 6.2831853;
  }

  function spawnLeaf(pi) {
    const i = claim(leaves), P = leaves;
    setCommon(P, i, pi);
    P.life[i] = DURATION * lerp(0.86, 1, rnd());
    P.out[i] = S * lerp(0.6, 1.5, rnd());
    P.rise[i] = S * lerp(0.35, 1.0, rnd());
    P.fall[i] = S * lerp(0.1, 0.55, rnd());
    P.curl[i] = (rnd() < 0.5 ? -1 : 1) * lerp(0.5, 1.6, rnd());
    P.size[i] = S * lerp(0.3, 0.52, rnd());
    P.aspect[i] = lerp(0.8, 1.15, rnd());
    _ax.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    if (_ax.lengthSq() < 1e-6) _ax.set(0, 1, 0);
    _ax.normalize();
    P.axis[i * 3] = _ax.x; P.axis[i * 3 + 1] = _ax.y; P.axis[i * 3 + 2] = _ax.z;
    P.spin[i] = (rnd() < 0.5 ? -1 : 1) * lerp(5, 11, rnd()); // rad/s; ~1-1.4 turns over the life
    _qb.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    if (_qb.lengthSq() < 1e-6) _qb.identity();
    _qb.normalize();
    P.qb[i * 4] = _qb.x; P.qb[i * 4 + 1] = _qb.y; P.qb[i * 4 + 2] = _qb.z; P.qb[i * 4 + 3] = _qb.w;
    _col.setHex(LEAF_PALETTE[Math.floor(rnd() * LEAF_PALETTE.length)]);
    _col.offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.1);
    P.mesh.instanceColor.setXYZ(i, _col.r, _col.g, _col.b);
    writeLeaf(i);
  }

  function spawnMote(pi) {
    const i = claim(motes), P = motes;
    setCommon(P, i, pi);
    P.life[i] = DURATION * lerp(0.7, 1, rnd());
    P.out[i] = S * lerp(0.3, 1.1, rnd());
    P.rise[i] = S * lerp(0.7, 1.5, rnd()); // motes float higher than leaves
    P.fall[i] = S * lerp(0, 0.15, rnd());
    P.curl[i] = (rnd() < 0.5 ? -1 : 1) * lerp(0.6, 2.2, rnd());
    P.size[i] = S * lerp(0.022, 0.05, rnd());
    _col.setHex(MOTE_PALETTE[Math.floor(rnd() * MOTE_PALETTE.length)]);
    P.mesh.instanceColor.setXYZ(i, _col.r, _col.g, _col.b);
    writeMote(i);
  }

  function flush(P) { P.mesh.instanceMatrix.needsUpdate = true; P.mesh.instanceColor.needsUpdate = true; }

  function burst({ points, seed } = {}) {
    if (disposed) return 0;
    readPoints(points);
    if (!nPts) return 0;
    seedRng(seed);
    bursts++;
    const nl = Math.min(LEAVES_PER_BURST, Math.max(nPts, 12));
    const nm = Math.min(MOTES_PER_BURST, Math.max(nPts, 8));
    // pick source points: even stride with seeded jitter when plentiful, else cycle through all of them
    const off = Math.floor(rnd() * nPts);
    for (let k = 0; k < nl; k++) {
      const pi = nPts >= nl ? Math.min(nPts - 1, Math.floor((k + rnd()) * nPts / nl)) : (k + off) % nPts;
      spawnLeaf(pi);
    }
    for (let k = 0; k < nm; k++) {
      const pi = nPts >= nm ? Math.min(nPts - 1, Math.floor((k + rnd()) * nPts / nm)) : (k * 3 + off + 1) % nPts;
      spawnMote(pi);
    }
    flush(leaves); flush(motes);
    return nl + nm;
  }

  function step(P, write) {
    if (!P.active) return;
    let changed = false;
    for (let i = 0; i < P.hi; i++) {
      if (!P.alive[i]) continue;
      if (clock - P.birth[i] >= P.life[i]) {
        P.alive[i] = 0; P.active--;
        P.mesh.setMatrixAt(i, _zero);
      } else write(i);
      changed = true;
    }
    if (changed) P.mesh.instanceMatrix.needsUpdate = true;
    if (!P.active) P.mesh.visible = false; // zero draw calls while idle
  }

  function tick(deltaSeconds) {
    if (disposed || !(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) return;
    clock += deltaSeconds;
    step(leaves, writeLeaf);
    step(motes, writeMote);
  }

  function stats() {
    return {
      leaves: leaves.active, motes: motes.active,
      leafCapacity: MAX_LEAVES, moteCapacity: MAX_MOTES,
      drawCalls: (leaves.mesh.visible ? 1 : 0) + (motes.mesh.visible ? 1 : 0),
      bursts, recycled, time: clock, disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const P of [leaves, motes]) {
      group.remove(P.mesh);
      P.mesh.dispose();
      P.active = 0; P.hi = 0; P.mesh.count = 0;
    }
    leafGeo.dispose(); moteGeo.dispose(); leafMat.dispose(); moteMat.dispose();
  }

  return { burst, tick, dispose, stats };
}
