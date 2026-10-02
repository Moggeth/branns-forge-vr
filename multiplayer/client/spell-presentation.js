// Spell presentation: ground-conforming reticles and fantasy RTS/VR spell effects.
// Y-up metres. Pooled geometry/materials, 512 particle slots, 160 pooled kinematic
// rock/slab instances (2 draws), 32 event groups, 5 s effect cap. No lights are created.
// Options beyond the original contract are optional: quality 'high'|'medium'|'low'
// (default 'high' = original behaviour budget) and reducedMotion (default false).
import * as THREE from 'three';

const TAU = Math.PI * 2, MAX_EVENTS = 32, MAX_LIFE = 5, LAUNCH = 0.8;
const CAPS = { dust: 224, glow: 96, shard: 112, leaf: 80 }; // 512 particles in total
const KCAPS = { slab: 64, rock: 96 }; // pooled kinematic instances, one draw each
const QUALITY = { // n: particle emission scale, k: kinematic piece scale, b: secondary strips (branches/sub-roots)
  high: { n: 1, k: 1, b: 1 }, medium: { n: 0.6, k: 0.75, b: 0.6 }, low: { n: 0.35, k: 0.5, b: 0 } };
const PAL = { gold: 0xffc857, amber: 0xff8f2e, ember: 0xff4a1f, teal: 0x37e0c8, deepTeal: 0x0f7f86, purple: 0x9b6bff, violet: 0x4d2a8f,
  bone: 0xf2e8c9, earth: 0x7b5b3a, stone: 0x8d8a84, slate: 0x55525a, leaf: 0x73d96b, moss: 0x2f7a3e, ice: 0xc4f1ff, mint: 0x9ff7c8,
  bolt: 0xcfeaff, bad: 0xd24a4a, badDark: 0x6b2a2a, dust: 0xc9b48f,
  soil: 0x4a3423, loam: 0x5e4430, gouge: 0x1c1310, char: 0x140d0b, bark: 0x3d2b1d, barkHi: 0x6a4a2c, smoke: 0x8a7f74, clay: 0x9a7350, cinder: 0x2b2420, ash: 0x6e645b };
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), QI = new THREE.Quaternion(), V = new THREE.Vector3();
const EU = new THREE.Euler(), QT = new THREE.Quaternion(), P3 = [0, 0, 0];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
const backOut = (t) => { t = clamp(t) - 1; return 1 + 2.7 * t * t * t + 1.7 * t * t; };
const lp = (a, b, t) => a + (b - a) * t;
const mulberry = (a) => () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const vec = (v) => (Array.isArray(v) && v.length >= 3 ? v.map(Number) : v && typeof v === 'object' && 'x' in v ? [v.x, v.y || 0, v.z] : null);

// ---------- shaders ----------
const RIB_VS = 'attribute vec3 a;varying vec3 vA;void main(){vA=a;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const RIB_FS = `uniform vec3 c1,c2;uniform float t,dash,flow;varying vec3 vA;
void main(){float e=1.-smoothstep(.45,1.,abs(vA.z));
float d=dash>0.?max(.1,smoothstep(.15,.45,abs(sin((vA.x*dash-t*flow*.4)*3.14159)))):1.;
float m=.5+.5*sin(vA.x*9.-t*flow*2.);vec3 c=mix(c1,c2,m)*(1.+.9*e*e);gl_FragColor=vec4(c,vA.y*e*d);}`;
const PT_VS = 'attribute vec3 col;attribute vec2 aux;uniform float scale;varying vec3 vC;varying float vA;void main(){vC=col;vA=aux.y;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(256.,aux.x*scale/max(.1,-mv.z));gl_Position=projectionMatrix*mv;}';
const PT_FS = 'uniform sampler2D map;varying vec3 vC;varying float vA;void main(){float a=texture2D(map,gl_PointCoord).a*vA;if(a<.01)discard;gl_FragColor=vec4(vC,a);}';

function softTexture() {
  if (typeof document === 'undefined') { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; }
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) { // wispy holes so dust reads as puffs, not discs
    const px = 32 + Math.cos(i * 2.4) * 18, py = 32 + Math.sin(i * 2.4) * 18, h = x.createRadialGradient(px, py, 0, px, py, 9);
    h.addColorStop(0, 'rgba(0,0,0,.35)'); h.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = h; x.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

// ---------- ribbon: camera-independent strip, ground conforming when gh is set ----------
// wm/am are per-vertex width/alpha multipliers (used by packed strips and travelling fracture fronts).
class Ribbon {
  constructor(n, mat, gh) {
    this.n = n; this.gh = gh; this.side = null; this.p = new Float32Array(n * 3); this.wm = new Float32Array(n).fill(1); this.am = new Float32Array(n).fill(1);
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.at = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const ix = []; for (let i = 0; i < n - 1; i++) { const k = i * 2; ix.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    g.setAttribute('position', this.pos); g.setAttribute('a', this.at); g.setIndex(ix);
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  set(i, x, y, z) { const p = this.p; p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; }
  commit(width, reveal = 1, fade = 1, taper = 1) {
    const { n, p, pos, at, side, gh, wm, am } = this;
    for (let i = 0; i < n; i++) {
      const a = Math.max(i - 1, 0) * 3, b = Math.min(i + 1, n - 1) * 3; let sx, sz;
      if (side) [sx, sz] = side;
      else { sx = -(p[b + 2] - p[a + 2]); sz = p[b] - p[a]; const l = Math.hypot(sx, sz); if (l < 1e-5) { sx = 1; sz = 0; } else { sx /= l; sz /= l; } }
      const u = i / (n - 1), w = width * 0.5 * wm[i] * (taper ? 0.25 + 0.75 * Math.sin(Math.PI * u) : 1), al = fade * am[i] * clamp((reveal * 1.1 - u) * 10);
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], k = i * 2;
      let yl = y, yr = y;
      if (gh) { const h0 = gh(x, z); yl = y + gh(x + sx * w, z + sz * w) - h0; yr = y + gh(x - sx * w, z - sz * w) - h0; }
      pos.setXYZ(k, x + sx * w, yl, z + sz * w); pos.setXYZ(k + 1, x - sx * w, yr, z - sz * w);
      at.setXYZ(k, u, al, -1); at.setXYZ(k + 1, u, al, 1);
    }
    pos.needsUpdate = at.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); }
}

// ---------- pooled particles ----------
class PointPool {
  constructor(cap, add, map, scale) {
    this.cap = cap; this.n = 0;
    const g = (this.geo = new THREE.BufferGeometry());
    this.P = new THREE.BufferAttribute(new Float32Array(cap * 3), 3); this.C = new THREE.BufferAttribute(new Float32Array(cap * 3), 3); this.A = new THREE.BufferAttribute(new Float32Array(cap * 2), 2);
    for (const [k, a] of [['position', this.P], ['col', this.C], ['aux', this.A]]) { a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); }
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, scale: { value: scale } }, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = 3;
    this.s = Array.from({ length: cap }, () => ({ live: false })); this.c = new THREE.Color();
  }
  emit(p) {
    const i = this.n, s = this.s[i]; this.n = (i + 1) % this.cap;
    Object.assign(s, { live: true, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.5, grow: 1, alpha: 0.5, grav: 0, drag: 1, floor: -Infinity }, p);
    this.c.set(p.color ?? 0xffffff); this.C.setXYZ(i, this.c.r, this.c.g, this.c.b); this.C.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const s = this.s[i]; if (!s.live) continue; any = true; s.age += dt; const u = s.age / s.life;
      if (u >= 1) { s.live = false; this.A.setXY(i, 0, 0); continue; }
      const k = Math.exp(-s.drag * dt); s.vy -= s.grav * dt; s.vx *= k; s.vz *= k; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < s.floor) { s.y = s.floor; s.vy = 0; } // falling glowing ejecta rest on the surface instead of sinking
      this.P.setXYZ(i, s.x, s.y, s.z); this.A.setXY(i, s.size * (1 + s.grow * u), s.alpha * sstep(0, 0.1, u) * (1 - sstep(0.4, 1, u)));
    }
    if (any) this.P.needsUpdate = this.A.needsUpdate = true;
  }
  live() { return this.s.reduce((n, s) => n + (s.live ? 1 : 0), 0); }
  clear() { for (let i = 0; i < this.cap; i++) { this.s[i].live = false; this.A.setXY(i, 0, 0); } this.A.needsUpdate = true; }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

class InstPool { // instanced shards/leaves with ground settling and optional orbit motion
  constructor(geo, mat, cap, H) {
    this.H = H; this.cap = cap; this.n = 0; this.o = new THREE.Object3D(); this.dq = new THREE.Quaternion(); this.c = new THREE.Color();
    const m = (this.mesh = new THREE.InstancedMesh(geo, mat, cap)); m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, this.c.set(0xffffff)); }
    this.s = Array.from({ length: cap }, () => ({ live: false, q: new THREE.Quaternion(), ax: new THREE.Vector3() }));
  }
  emit(p) {
    const i = this.n, s = this.s[i], R = p.R || Math.random; this.n = (i + 1) % this.cap;
    Object.assign(s, { live: true, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.2, sy: 1, grav: 9, drag: 0, spin: 4, settle: true, orb: null }, p);
    s.ax.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize(); s.q.setFromAxisAngle(s.ax, R() * TAU);
    this.mesh.setColorAt(i, this.c.set(p.color ?? 0xffffff)); this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const m = this.mesh; let any = false;
    for (let i = 0; i < this.cap; i++) {
      const s = this.s[i]; if (!s.live) continue; any = true; s.age += dt;
      if (s.age >= s.life) { s.live = false; m.setMatrixAt(i, ZERO); continue; }
      s.vy -= s.grav * dt;
      if (s.orb) { const o = s.orb; o.a += o.w * dt; o.r = Math.max(0.02, o.r + o.dr * dt); s.y += s.vy * dt; s.x = o.cx + Math.cos(o.a) * o.r; s.z = o.cz + Math.sin(o.a) * o.r; }
      else {
        const k = Math.exp(-s.drag * dt); s.vx *= k; s.vz *= k; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        const g = this.H(s.x, s.z) + s.size * 0.25;
        if (s.settle && s.y < g) { s.y = g; if (Math.abs(s.vy) > 1.5) { s.vy *= -0.3; s.vx *= 0.6; s.vz *= 0.6; } else { s.vy = 0; s.vx *= 0.2; s.vz *= 0.2; s.spin = 0; } }
      }
      const u = s.age / s.life, sc = s.size * sstep(0, 0.05, u) * (1 - sstep(0.72, 1, u));
      if (s.spin) s.q.premultiply(this.dq.setFromAxisAngle(s.ax, s.spin * dt));
      this.o.position.set(s.x, s.y, s.z); this.o.quaternion.copy(s.q); this.o.scale.set(sc, sc * s.sy, sc); this.o.updateMatrix(); m.setMatrixAt(i, this.o.matrix);
    }
    if (any) m.instanceMatrix.needsUpdate = true;
  }
  live() { return this.s.reduce((n, s) => n + (s.live ? 1 : 0), 0); }
  clear() { for (let i = 0; i < this.cap; i++) { this.s[i].live = false; this.mesh.setMatrixAt(i, ZERO); } this.mesh.instanceMatrix.needsUpdate = true; }
  dispose() { this.mesh.dispose(); }
}

class KinPool { // event-owned, script-posed instances (rock clods, fracture plates, crater rims); slots return on event end
  // Geometry variants share the cap: slot i lives in variant i % nv, so consecutive claims alternate silhouettes (one draw per variant in use).
  constructor(geos, mat, cap) {
    geos = [].concat(geos); const nv = (this.nv = geos.length), per = Math.ceil(cap / nv);
    this.cap = cap; this.free = []; for (let i = cap - 1; i >= 0; i--) this.free.push(i); this.o = new THREE.Object3D(); this.c = new THREE.Color(); this.dirty = false; this.used = new Array(nv).fill(0);
    this.meshes = geos.map((g) => { const m = new THREE.InstancedMesh(g, mat, per); m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < per; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, this.c.set(0xffffff)); } return m; });
    this.mesh = new THREE.Group(); this.mesh.add(...this.meshes);
  }
  claim(ev, col) { const i = this.free.pop(); if (i === undefined) return -1; ev.kin.push([this, i]); const m = this.meshes[i % this.nv]; this.used[i % this.nv]++; m.setColorAt((i / this.nv) | 0, this.c.set(col)); m.instanceColor.needsUpdate = true; return i; }
  put(i, x, y, z, q, sx, sy, sz) { if (i < 0) return; const o = this.o; o.position.set(x, y, z); o.quaternion.copy(q); o.scale.set(Math.max(sx, 1e-4), Math.max(sy, 1e-4), Math.max(sz, 1e-4)); o.updateMatrix(); this.meshes[i % this.nv].setMatrixAt((i / this.nv) | 0, o.matrix); this.dirty = true; }
  hide(i) { if (i < 0) return; this.meshes[i % this.nv].setMatrixAt((i / this.nv) | 0, ZERO); this.dirty = true; }
  release(i) { if (i < 0) return; this.hide(i); this.used[i % this.nv]--; this.free.push(i); }
  flush() { if (this.dirty) { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; this.dirty = false; } this.meshes.forEach((m, v) => (m.visible = this.used[v] > 0)); }
  live() { return this.cap - this.free.length; }
  dispose() { for (const m of this.meshes) m.dispose(); }
}

// Fractured-earth wedge (shared by every instanced plate/clod): an irregular, toothy star-shaped outline extruded downward through
// horizontal strata bands. Each band steps in raggedly and has one flat vertex colour, so turf/humus/soil/clay/rock read as sharp
// layers on the torn faces. The underside tapers and shifts sideways (a wedge with an asymmetric hinge). Flat-shaded, ~80 triangles.
// o: m outline points, r0/r1 alternating radii + rj jitter, ax x-stretch, taper underside scale, off underside [x,z] shift,
// yj top roughness, rag per-band setback, top/bottom colours, bands [[yTop, colour], ...] top to bottom ending at -0.5.
function fragGeo(seed, o) {
  const R = mulberry(seed), m = o.m, col = new THREE.Color(), P = [], C = [];
  const ang = Array.from({ length: m }, (_, k) => ((k + (R() - 0.5) * 0.55) / m) * TAU + o.rot), rad = ang.map((_, k) => (k % 2 ? o.r0 : o.r1) + R() * o.rj);
  const ys = [...o.bands.map((b) => b[0]), -0.5], rings = ys.map((y, b) => {
    const f = (0.5 - y), sc = lp(1, o.taper, f), rg = b ? o.rag : 0;
    return ang.map((a, k) => [Math.cos(a) * 0.5 * rad[k] * sc * o.ax + o.off[0] * f + (R() - 0.5) * rg, b ? y : y + (R() - 0.5) * o.yj, Math.sin(a) * 0.5 * rad[k] * sc + o.off[1] * f + (R() - 0.5) * rg]);
  });
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = (a, b, c, hex, want) => { // want: outward reference direction; flips winding so every face is front-facing outward
    ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); n.crossVectors(ab, ac);
    if (n.x * want[0] + n.y * want[1] + n.z * want[2] < 0) [b, c] = [c, b];
    col.set(hex); for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); C.push(col.r, col.g, col.b); }
  };
  const ctr = (ring) => ring.reduce((s, p) => [s[0] + p[0] / m, s[1] + p[1] / m, s[2] + p[2] / m], [0, 0, 0]);
  const top = rings[0], bot = rings[rings.length - 1], ct = ctr(top), cb = ctr(bot);
  for (let k = 0; k < m; k++) { const j = (k + 1) % m; tri(ct, top[k], top[j], o.top, [0, 1, 0]); tri(cb, bot[k], bot[j], o.bottom, [0, -1, 0]); }
  for (let b = 0; b < rings.length - 1; b++) for (let k = 0; k < m; k++) {
    const j = (k + 1) % m, A = rings[b][k], B = rings[b][j], Cc = rings[b + 1][j], D = rings[b + 1][k], w = [(A[0] + B[0]) * 0.5, 0, (A[2] + B[2]) * 0.5];
    tri(A, B, Cc, o.bands[b][1], w); tri(A, Cc, D, o.bands[b][1], w);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeVertexNormals();
  return g;
}
// Plates carry their own strata colours (instance colour is a light tint); clods keep a dark soil crust over a light body so the
// instance colour (stone/earth/cinder) still reads as the rock while the crust/body boundary stays sharp.
const PLATE = { m: 9, r0: 0.78, r1: 1.0, rj: 0.14, ax: 1.05, taper: 0.62, off: [0.06, 0.2], yj: 0.07, rag: 0.07, rot: 0.2, top: 0x7d8a4c, bottom: 0x4a4640,
  bands: [[0.5, 0x3a2a1c], [0.36, 0x7d5a3a], [0.04, 0xb08a60], [-0.22, 0x9c978e]] };
const CLOD = { m: 7, r0: 0.72, r1: 1.0, rj: 0.2, ax: 1.0, taper: 0.38, off: [0.12, -0.08], yj: 0.16, rag: 0.09, rot: 0.6, top: 0xa88a62, bottom: 0x9a948c,
  bands: [[0.5, 0x7a5a3c], [0.3, 0xffffff], [-0.1, 0xe2dcd4]] };
// Meteor heat shell colours (additive; black = invisible): glowing crack seams plus a heated leading face skewed to one side.
function meteorGeo(heat) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, R = mulberry(0x5f3a11);
  const planes = Array.from({ length: 4 }, () => new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize()), lead = new THREE.Vector3(0.38, -1, 0.22).normalize();
  for (let i = 0; i < p.count; i++) { // lumpy, faceted, teardrop: blunt leading face (-y in the flight frame), drawn-out trailing side
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.8 + 0.26 * Math.abs(Math.sin(x * 5.1 + y * 3.3 + z * 6.7)) - 0.08 * Math.abs(Math.sin(x * 11 - z * 9));
    p.setXYZ(i, x * k, y * k * (y > 0 ? 1.45 : 0.86), z * k * 0.92);
  }
  if (heat) {
    const C = [], f = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      f.set(0, 0, 0); for (let j = 0; j < 3; j++) f.x += p.getX(i + j) / 3, f.y += p.getY(i + j) / 3, f.z += p.getZ(i + j) / 3;
      const d = f.clone().normalize(), hot = sstep(0.25, 0.97, d.dot(lead)), crack = planes.some((q, n) => Math.abs(d.dot(q)) < 0.075 + 0.02 * n);
      if (hot > 0.02) c.setRGB(lp(0.55, 1, hot), lp(0.06, 0.78, hot * hot), lp(0.01, 0.42, hot * hot * hot)).multiplyScalar(0.25 + 0.75 * hot);
      else c.setRGB(0, 0, 0);
      if (crack) c.setRGB(Math.max(c.r, 0.95), Math.max(c.g, 0.32), Math.max(c.b, 0.06));
      for (let j = 0; j < 3; j++) C.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  }
  g.computeVertexNormals(); return g;
}

// ---------- reticle shape vocabulary (unit coordinates; line shapes use x in [-.5,.5] of length, z in metres) ----------
const circ = (r, n = 48, a0 = 0, a1 = TAU) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [Math.cos(a) * r, Math.sin(a) * r]; });
const star = (k, r1, r2, rot = 0) => Array.from({ length: k * 2 + 1 }, (_, i) => { const a = rot + (i * Math.PI) / k, r = i % 2 ? r2 : r1; return [Math.cos(a) * r, Math.sin(a) * r]; });
const wave = (r, k, amp, rot = 0, n = 96) => Array.from({ length: n + 1 }, (_, i) => { const a = rot + (TAU * i) / n, q = r + amp * Math.sin(a * k); return [Math.cos(a) * q, Math.sin(a) * q]; });
const spiral = (r0, r1, turns, n = 64) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, a = u * turns * TAU, r = lp(r0, r1, u); return [Math.cos(a) * r, Math.sin(a) * r]; });
const zig = (x0, x1, z, amp, k) => Array.from({ length: k + 1 }, (_, i) => [lp(x0, x1, i / k), z + (i % 2 ? amp : -amp) * (0.6 + 0.4 * Math.sin(i * 2.7))]);
const chev = (r, dir, rot) => [[r - 0.06 * dir, 0.14], [r + 0.14 * dir, 0], [r - 0.06 * dir, -0.14]].map(([x, y]) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
const chevs = (r, dir) => [0, 1, 2, 3].map((i) => [chev(r, dir, (i * Math.PI) / 2), 0.05, 0.5, 0]);
const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
const flake = () => { const o = []; for (let k = 0; k < 6; k++) { const a = (k * TAU) / 6; o.push(polar(a, 0), polar(a, 1), polar(a, 0.62), polar(a + 0.38, 0.88), polar(a, 0.62), polar(a - 0.38, 0.88), polar(a, 0.62), polar(a, 0)); } return o; };
// [colours, default radius, line?, paths -> [points, width, spin rad/s, dash frequency]]
const RET = {
  skeleton: { c: [PAL.bone, PAL.purple], r: 2, p: () => [[circ(1), 0.07, 0.3, 0], [circ(0.7, 40), 0.05, -0.6, 7], [star(3, 0.7, 0.3), 0.05, -0.6, 0], [star(3, 0.45, 0.2, 0.52), 0.04, 0.8, 0]] },
  squad: { c: [PAL.gold, PAL.purple], r: 3.2, p: () => [[circ(1), 0.07, 0.2, 0], ...[0, 1, 2].map((i) => [circ(0.26, 24).map(([x, z]) => [x + Math.cos(i * 2.094) * 0.55, z + Math.sin(i * 2.094) * 0.55]), 0.05, 0.2, 0]), [circ(0.8, 48), 0.04, -0.3, 8]] },
  golem: { c: [PAL.gold, PAL.amber], r: 2.6, p: () => [[circ(1, 8), 0.09, 0.2, 0], [circ(0.72, 8), 0.06, -0.4, 0], [circ(0.5, 4), 0.07, 0.2, 0], [circ(0.25, 4), 0.06, -0.2, 0]] },
  raise: { c: [PAL.gold, PAL.amber], r: 2.4, p: () => [[circ(1), 0.08, 0.1, 0], [circ(0.35, 28), 0.05, -0.5, 5], ...chevs(0.62, 1)] },
  lower: { c: [PAL.purple, PAL.teal], r: 2.4, p: () => [[circ(1), 0.08, -0.1, 0], [circ(0.35, 28), 0.05, 0.5, 5], ...chevs(0.78, -1)] },
  sunder: { line: 1, c: [PAL.ember, PAL.gold], p: () => [[zig(-0.5, 0.5, 0.4, 0.3, 24), 0.1, 0, 0], [zig(-0.5, 0.5, -0.4, 0.3, 19), 0.1, 0, 0], [[[-0.5, 0], [0.5, 0]], 0.05, 0, 8]] },
  wall: { line: 1, c: [PAL.gold, PAL.stone], p: () => [[[[-0.5, -0.6], [0.5, -0.6], [0.5, 0.6], [-0.5, 0.6], [-0.5, -0.6]], 0.09, 0, 0], [[[-0.5, 0], [0.5, 0]], 0.05, 0, 9], [zig(-0.5, 0.5, 0, 0.6, 18), 0.04, 0, 0]] },
  grove: { c: [PAL.leaf, PAL.gold], r: 4, p: () => [[circ(1), 0.08, 0.15, 0], [spiral(0.12, 0.9, 2.2), 0.07, 0.5, 0], [spiral(0.12, 0.9, 2.2).map(([x, z]) => [-x, -z]), 0.07, 0.5, 0], [circ(0.9, 60), 0.04, -0.3, 6]] },
  ring: { c: [PAL.teal, PAL.leaf], r: 4.5, p: () => [[circ(1), 0.09, 0.1, 0], [wave(0.88, 12, 0.07), 0.06, -0.25, 0], [star(12, 0.7, 0.55), 0.05, 0.25, 0], [circ(0.45, 40), 0.04, 0, 6]] },
  starfall: { c: [PAL.amber, PAL.gold], r: 5, p: () => [[circ(1), 0.1, 0.2, 0], [circ(1.12, 64), 0.05, -0.2, 10], [star(5, 0.85, 0.34), 0.07, 0.5, 0], [circ(0.2, 20), 0.06, 0, 0]] },
  crystal: { c: [PAL.teal, PAL.purple], r: 2.6, p: () => [[circ(1, 6), 0.08, 0.2, 0], [star(6, 1, 0.5), 0.06, -0.3, 0], [circ(0.45, 6), 0.06, 0.5, 0]] },
  heal: { c: [PAL.mint, PAL.gold], r: 3.2, p: () => [[circ(1), 0.07, 0, 0], [wave(0.72, 6, 0.09), 0.07, 0.5, 0], [wave(0.45, 8, 0.06), 0.06, -0.7, 0]] },
  lightning: { c: [PAL.bolt, PAL.purple], r: 2.2, p: () => [[circ(1, 48), 0.06, 0.3, 6], [star(7, 1, 0.5, 0.2), 0.06, -0.5, 0], [circ(0.3, 20), 0.06, 0, 0]] },
  frost: { c: [PAL.ice, PAL.teal], r: 3.4, p: () => [[circ(1, 48), 0.06, 0.1, 8], [flake(), 0.06, 0.15, 0], [circ(0.5, 6), 0.06, -0.4, 0]] },
};

export function createSpellPresentation({ scene, height, pointScale = 720, tickSeconds = 0.05, quality = 'high', reducedMotion = false }) {
  const H = (x, z) => { const h = height ? height(x, z) : 0; return Number.isFinite(h) ? h : 0; };
  const root = new THREE.Group(); root.name = 'SpellPresentation'; scene.add(root);
  const TIME = { value: 0 }; let clock = 0, disposed = false;
  let Q = QUALITY[quality] || QUALITY.high, qName = QUALITY[quality] ? quality : 'high', RM = !!reducedMotion;
  const M = () => (RM ? { shake: 0, flick: 0, spin: 0.35, swirl: 0.45, flash: 0.4 } : { shake: 1, flick: 1, spin: 1, swirl: 1, flash: 1 });
  let MO = M();
  const qn = (n) => Math.max(1, Math.round(n * Q.n)), qk = (n, min = 1) => Math.max(min, Math.round(n * Q.k)), qb = (n) => Math.round(n * Q.b);
  const cache = new Map(), pool = (k, f) => { let v = cache.get(k); if (!v) cache.set(k, (v = f())); return v; };
  const ribMat = (c1, c2, dash = 0, flow = 1, add = true) => pool(`r${c1}.${c2}.${dash}.${flow}.${add}`, () => new THREE.ShaderMaterial({
    uniforms: { c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, t: TIME, dash: { value: dash }, flow: { value: flow } },
    vertexShader: RIB_VS, fragmentShader: RIB_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const solid = (col, em = 0, ei = 0.5) => pool(`s${col}.${em}.${ei}`, () => new THREE.MeshStandardMaterial({ color: col, emissive: em, emissiveIntensity: ei, roughness: 0.85, metalness: 0.05, flatShading: true }));
  const glowMat = (col) => pool(`g${col}`, () => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));

  const core = new THREE.IcosahedronGeometry(1, 1), cp = core.attributes.position; // lumpy meteor, deformed by position so faces stay welded
  for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), k = 0.82 + 0.3 * Math.abs(Math.sin(x * 7.1 + y * 5.3 + z * 3.7)); cp.setXYZ(i, x * k, y * k, z * k * 1.4); }
  core.computeVertexNormals();
  const clod = new THREE.IcosahedronGeometry(1, 0), kp = clod.attributes.position; // faceted soil/rock clod, deterministic lumps
  for (let i = 0; i < kp.count; i++) { const x = kp.getX(i), y = kp.getY(i), z = kp.getZ(i), k = 0.78 + 0.32 * Math.abs(Math.sin(x * 4.3 + y * 6.1 + z * 2.9)); kp.setXYZ(i, x * k, y * k * 0.82, z * k); }
  clod.computeVertexNormals();
  const plate = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1), pp = plate.attributes.position; // torn ground plate: bevel-less box with a skewed broken edge
  for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i); if (y > 0) pp.setXYZ(i, x * (0.92 + 0.08 * Math.sign(z)), y, z + 0.06 * Math.sin(x * 9)); }
  plate.computeVertexNormals();
  const leafShape = new THREE.Shape(); leafShape.moveTo(0, -0.5); leafShape.quadraticCurveTo(0.5, -0.1, 0, 0.5); leafShape.quadraticCurveTo(-0.5, -0.1, 0, -0.5);
  const G = {
    bone: new THREE.CylinderGeometry(0.045, 0.07, 1, 6), slab: new THREE.BoxGeometry(1, 1, 1), rock: new THREE.DodecahedronGeometry(1, 0), core, clod, plate,
    plateA: fragGeo(0x51d3, PLATE), plateB: fragGeo(0xa77e, { ...PLATE, m: 8, r0: 0.7, taper: 0.5, off: [-0.1, 0.26], rot: 1.1 }),
    clodA: fragGeo(0x2c61, CLOD), clodB: fragGeo(0x93f0, { ...CLOD, m: 6, r0: 0.66, taper: 0.3, off: [-0.1, 0.12], rot: 2.1 }),
    meteor: meteorGeo(false), meteorHeat: meteorGeo(true),
    crystal: new THREE.LatheGeometry([[0, 0], [0.26, 0], [0.2, 0.72], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 6),
    disc: new THREE.RingGeometry(0.2, 1, 40).rotateX(-Math.PI / 2), flame: new THREE.ConeGeometry(0.55, 3.2, 8, 1, true).translate(0, 1.6, 0),
    shard: new THREE.OctahedronGeometry(1, 0).scale(0.35, 1, 0.35), leaf: new THREE.ShapeGeometry(leafShape).scale(0.35, 0.35, 1),
  };
  const tex = softTexture();
  const dust = new PointPool(CAPS.dust, false, tex, pointScale), glow = new PointPool(CAPS.glow, true, tex, pointScale);
  const shards = new InstPool(G.shard, new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true, emissive: 0x201814 }), CAPS.shard, H);
  const leaves = new InstPool(G.leaf, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, emissive: 0x10240c }), CAPS.leaf, H);
  // Shard-pool parameters plus vertex colours (strata bands); one extra instanced-standard variant, warmed by prepareShaders.
  const kinMat = new THREE.MeshStandardMaterial({ roughness: 0.82, flatShading: true, emissive: 0x201814, vertexColors: true });
  const slabs = new KinPool([G.plateA, G.plateB], kinMat, KCAPS.slab), rocks = new KinPool([G.clodA, G.clodB], kinMat, KCAPS.rock), kins = [slabs, rocks];
  const meteorMat = () => pool('meteorCore', () => new THREE.MeshStandardMaterial({ color: 0x2b2522, emissive: 0x3a1206, emissiveIntensity: 0.6, roughness: 0.95, metalness: 0, flatShading: true }));
  const heatMat = () => pool('meteorHeat', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pools = [dust, glow, shards, leaves]; root.add(dust.obj, glow.obj, shards.mesh, leaves.mesh, slabs.mesh, rocks.mesh);
  async function prepareShaders(renderer, camera, targetScene) {
    // Representatives share the real cached materials. This group is never
    // attached/rendered and never emits a spell or modifies authoritative state.
    const preview = new THREE.Group();
    const ribbon = new Ribbon(2, ribMat(PAL.amber, PAL.gold), H);
    preview.add(ribbon.mesh, new THREE.Mesh(G.core, solid(0x3a2a24, PAL.ember, 1.2)),
      new THREE.Mesh(G.disc, glowMat(PAL.amber)), new THREE.Mesh(G.meteor, meteorMat()), new THREE.Mesh(G.meteorHeat, heatMat()));
    root.traverse(node => { if (node.isMesh || node.isPoints) { const k = node.clone(false); k.visible = true; preview.add(k); } }); // pooled meshes may be hidden while idle
    try { await renderer.compileAsync(preview, camera, targetScene); }
    finally { ribbon.dispose(); preview.clear(); }
  }

  // ground helpers
  function dens(pts, sx, sz, sp = 0.35, cap = 160) {
    let tot = 0; for (let i = 1; i < pts.length; i++) tot += Math.hypot((pts[i][0] - pts[i - 1][0]) * sx, (pts[i][1] - pts[i - 1][1]) * sz);
    const step = Math.max(sp, tot / cap), o = [pts[0]];
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], k = Math.max(1, Math.round(Math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sz) / step)); for (let j = 1; j <= k; j++) o.push([lp(a[0], b[0], j / k), lp(a[1], b[1], j / k)]); }
    return o;
  }
  function place(rb, pts, cx, cz, sx, sz, ang, lift = 0.08) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < pts.length; i++) { const lx = pts[i][0] * sx, lz = pts[i][1] * sz, x = cx + ca * lx - sa * lz, z = cz + sa * lx + ca * lz; rb.set(i, x, H(x, z) + lift, z); }
  }
  const gRing = (rb, cx, cz, r, rot = 0, lift = 0.08, wob = 0, ph = 0) => {
    for (let i = 0; i < rb.n; i++) { const a = rot + (TAU * i) / (rb.n - 1), q = r * (1 + wob * Math.sin(a * 7 + ph)), x = cx + Math.cos(a) * q, z = cz + Math.sin(a) * q; rb.set(i, x, H(x, z) + lift, z); }
  };
  const gLine = (rb, ax, az, bx, bz, lift = 0.1) => { for (let i = 0; i < rb.n; i++) { const u = i / (rb.n - 1), x = lp(ax, bx, u), z = lp(az, bz, u); rb.set(i, x, H(x, z) + lift, z); } };

  // particle recipes (c.R is the event's deterministic random source)
  const puff = (c, x, z, n, spd, sz, col, al = 0.5, life = 1.5) => { n = qn(n); for (let i = 0; i < n; i++) { const a = c.R() * TAU, s = spd * (0.35 + c.R()); dust.emit({ x, y: H(x, z) + 0.15, z, vx: Math.cos(a) * s, vy: 0.4 + c.R() * 1.4, vz: Math.sin(a) * s, life: life * (0.7 + c.R() * 0.6), size: sz * (0.6 + c.R()), grow: 1.6, color: col, alpha: al, grav: -0.3, drag: 1.8 }); } };
  const debris = (c, x, z, n, spd, sz, cols, up = 5) => { n = qn(n); for (let i = 0; i < n; i++) { const a = c.R() * TAU, s = spd * (0.3 + c.R()); shards.emit({ R: c.R, x, y: H(x, z) + 0.1, z, vx: Math.cos(a) * s, vy: up * (0.5 + c.R()), vz: Math.sin(a) * s, life: 2 + c.R() * 1.2, size: sz * (0.6 + c.R() * 0.9), sy: 1 + c.R() * 1.5, color: cols[i % cols.length], grav: 14, drag: 0.3, spin: 4 * MO.spin }); } };
  const sparks = (c, x, y, z, n, spd, col, sz = 0.2, life = 1) => { n = qn(n); for (let i = 0; i < n; i++) { const a = c.R() * TAU, s = spd * c.R(); glow.emit({ x, y, z, vx: Math.cos(a) * s, vy: spd * (0.2 + c.R()), vz: Math.sin(a) * s, life: life * (0.6 + c.R() * 0.8), size: sz * (0.5 + c.R()), grow: -0.4, color: col, alpha: 0.9, grav: 4, drag: 1, floor: H(x, z) + 0.05 }); } };
  const motes = (c, x, z, r, col, sz = 0.2, rise = 1.2) => { const a = c.R() * TAU, q = r * c.R(), px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q; glow.emit({ x: px, y: H(px, pz) + 0.2, z: pz, vy: rise * (0.6 + c.R()), life: 1.4, size: sz, grow: -0.3, color: col, alpha: 0.8, drag: 0.5 }); };
  // Surface-attached directional dust: born on the terrain at (x,z), driven along (dx,dz) with a low billow.
  const dustDir = (c, x, z, dx, dz, spd, sz, col, al = 0.45, life = 1.8, spread = 0.35, lift = 0.5) => {
    const a = Math.atan2(dz, dx) + (c.R() - 0.5) * 2 * spread, s = spd * (0.55 + c.R() * 0.7);
    dust.emit({ x, y: H(x, z) + 0.12, z, vx: Math.cos(a) * s, vy: lift * (0.4 + c.R()), vz: Math.sin(a) * s, life: life * (0.75 + c.R() * 0.5), size: sz * (0.7 + c.R() * 0.6), grow: 1.8, color: col, alpha: al, grav: -0.12, drag: 1.7 });
  };
  // Ballistic ejecta that lands on the real terrain at distance d along angle a after flight time T.
  const ejecta = (c, x, z, a, d, T, sz, col, sy = 1.4) => {
    const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d, y0 = H(x, z) + 0.2, dh = H(tx, tz) - y0, g = 14;
    shards.emit({ R: c.R, x, y: y0, z, vx: (tx - x) / T, vy: (dh + 0.5 * g * T * T) / T, vz: (tz - z) / T, life: T + 1.4 + c.R() * 0.8, size: sz, sy, color: col, grav: g, drag: 0, spin: (3 + c.R() * 5) * MO.spin });
  };

  // ---------- events ----------
  const events = new Map(), recent = new Map();
  const mk = (ev, n, mat, gh = H) => { const r = new Ribbon(n, mat, gh); ev.g.add(r.mesh); ev.rib.push(r); return r; };
  const mesh = (ev, geo, mat) => { const m = new THREE.Mesh(geo, mat); ev.g.add(m); return m; };
  const own = (ev, geo, col) => { const mat = glowMat(col).clone(); ev.own.push(mat); return mesh(ev, geo, mat); };
  // Packed strips: k independent ground strands of m points in ONE ribbon (one draw). Zero-alpha join vertices separate strands.
  const strips = (ev, k, m, mat, gh = H) => ({ rb: k > 0 ? mk(ev, k * (m + 2), mat, gh) : null, k, m });
  const strand = (S, j, rv, alpha, wfn, pfn) => { // rv: grown fraction; pfn(s, out) writes the point at path parameter s into out
    const rb = S.rb, m = S.m, o = j * (m + 2), on = rv > 0.002;
    for (let i = 0; i < m; i++) { const s = Math.min(i / (m - 1), rv); pfn(s, P3); rb.set(o + 1 + i, P3[0], P3[1], P3[2]); rb.am[o + 1 + i] = on ? alpha : 0; rb.wm[o + 1 + i] = on ? wfn(s / rv) : 0; }
    const p = rb.p; for (let q = 0; q < 3; q++) { p[o * 3 + q] = p[(o + 1) * 3 + q]; p[(o + m + 1) * 3 + q] = p[(o + m) * 3 + q]; } rb.am[o] = rb.am[o + m + 1] = 0; rb.wm[o] = rb.wm[o + m + 1] = 0;
  };
  function kill(key) { const ev = events.get(key); if (!ev) return; root.remove(ev.g); ev.rib.forEach((r) => r.dispose()); ev.own.forEach((m) => m.dispose()); ev.kin.forEach(([p, i]) => p.release(i)); ev.kin.length = 0; events.delete(key); }
  function startEvent(key, persist, build, c) {
    if (disposed || events.has(key) || recent.has(key)) return null;
    if (events.size >= MAX_EVENTS) kill(events.keys().next().value);
    const ev = { key, age: 0, dur: 2, g: new THREE.Group(), rib: [], own: [], fx: [], kin: [], persist, closing: -1 }; root.add(ev.g); events.set(key, ev);
    build(ev, c); ev.dur = Math.min(ev.dur, MAX_LIFE); if (!persist) recent.set(key, clock + ev.dur + 8); return ev;
  }
  const pulse = (ev, c, mat, r0, r1, t0, t1, w = 0.4, x = c.x, z = c.z) => { // expanding/contracting ground ring
    const rb = mk(ev, 56, mat);
    ev.fx.push((age) => { const u = (age - t0) / (t1 - t0); rb.mesh.visible = u >= 0 && u <= 1; if (!rb.mesh.visible) return; gRing(rb, x, z, lp(r0, r1, easeOut(u)), age, 0.08, 0.04, age * 5); rb.commit(w * (1 - 0.5 * u), 1, 1 - u); });
  };
  // Ground annulus (scorch/soil/moss) that spreads then fades. Split into <=0.9 m concentric bands packed in ONE ribbon
  // so every band hugs the terrain (a single wide strip lets bumps poke through and leaves holes).
  const decal = (ev, c, mat, rIn, rOut, alpha, t0, t1, tEnd, x = c.x, z = c.z, wob = 0.08, ph = 0) => {
    const nb = Math.max(1, Math.ceil((rOut - rIn) / 0.9)), S = strips(ev, nb, 56, mat); S.rb.mesh.renderOrder = 1; let bw = 0.1;
    ev.fx.push((age) => {
      const g = easeOut((age - t0) / (t1 - t0)), f = alpha * g * (1 - sstep(tEnd - 0.7, tEnd, age)); S.rb.mesh.visible = f > 0.005; if (!S.rb.mesh.visible) return;
      const ro = lp(rIn + 0.05, rOut, g); bw = (ro - rIn) / nb;
      for (let j = 0; j < nb; j++) { const rc = rIn + bw * (j + 0.5); strand(S, j, 1, f, () => 1, (s, o) => { const a = ph + TAU * s, q = rc * (1 + wob * Math.sin(a * 7 + ph * 3)), px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q; o[0] = px; o[1] = H(px, pz) + 0.07; o[2] = pz; }); }
      S.rb.commit(bw * 1.38, 1, 1, 0); // smoothstep edges (.45..1 of half-width) are symmetric: 1.38x spacing sums neighbouring bands to ~flat coverage
    });
  };
  const amberM = () => ribMat(PAL.amber, PAL.gold, 0, 1.5), purpleM = () => ribMat(PAL.purple, PAL.teal, 0, 1), tealM = () => ribMat(PAL.teal, PAL.purple, 0, 1), greenM = () => ribMat(PAL.leaf, PAL.gold, 0, 1);
  const gougeM = () => ribMat(PAL.gouge, PAL.char, 0, 0, false), soilM = () => ribMat(PAL.soil, PAL.loam, 0, 0.3, false), barkM = () => ribMat(PAL.bark, PAL.barkHi, 0, 0.6, false);
  const moltenM = () => ribMat(PAL.ember, PAL.gold, 0, 2.2), veinM = () => ribMat(PAL.leaf, PAL.gold, 0, 1.6);
  const qRock = (q, rx, ry, rz) => q.setFromEuler(EU.set(rx, ry, rz, 'XYZ'));

  const summon = (ev, c, x, z, sc, t0) => { // bone/rock helix with ribs thrusting from the ground
    const R = c.R, hx = mk(ev, 44, ribMat(PAL.bone, PAL.purple, 0, 1.4), null), bones = []; let acc = 0, burst = false;
    for (let i = 0; i < 6; i++) bones.push({ m: mesh(ev, G.bone, solid(PAL.bone, PAL.violet, 0.35)), a: (i / 6) * TAU + R() * 0.4 });
    pulse(ev, c, purpleM(), 0.3 * sc, 1.6 * sc, t0, t0 + 0.9, 0.35 * sc, x, z);
    decal(ev, c, soilM(), 0.15 * sc, 1.25 * sc, 0.5, t0, t0 + 0.4, t0 + 2.2, x, z);
    ev.fx.push((age, dt) => {
      const t = age - t0, on = t >= 0 && t < 1.9; hx.mesh.visible = on; bones.forEach((b) => (b.m.visible = on)); if (!on) return;
      if (!burst) { burst = true; for (let i = 0; i < qn(10); i++) { const a = R() * TAU; dustDir(c, x + Math.cos(a) * 0.6 * sc, z + Math.sin(a) * 0.6 * sc, Math.cos(a), Math.sin(a), 2.2 * sc, 0.9 * sc, PAL.dust, 0.45); } debris(c, x, z, 8, 3.5 * sc, 0.12 * sc, [PAL.bone, PAL.slate], 4); }
      const grow = sstep(0, 0.7, t), fade = 1 - sstep(1.4, 1.9, t), gy = H(x, z);
      for (let i = 0; i < 44; i++) { const u = i / 43, a = u * TAU * 2.2 + age * 3 * MO.swirl, r = (0.95 - 0.5 * u) * sc; hx.set(i, x + Math.cos(a) * r, gy + 0.1 + u * 2.3 * sc * grow, z + Math.sin(a) * r); }
      hx.commit(0.16 * sc, grow, fade);
      for (const b of bones) {
        const len = (0.9 + 0.4 * Math.sin(b.a * 3)) * sc * backOut(t / 0.8) * (1 - sstep(1.4, 1.9, t)), bx = x + Math.cos(b.a) * 0.95 * sc, bz = z + Math.sin(b.a) * 0.95 * sc;
        V.set(-Math.cos(b.a) * 0.45, 1, -Math.sin(b.a) * 0.45).normalize();
        b.m.position.set(bx, H(bx, bz) - 0.05, bz).addScaledVector(V, len / 2); b.m.quaternion.setFromUnitVectors(UP, V); b.m.scale.set(sc, Math.max(len, 0.001), sc);
      }
      acc += dt * (t < 1.2 ? 18 * Q.n : 0);
      while (acc >= 1) { acc--; shards.emit({ R, orb: { cx: x, cz: z, a: R() * TAU, r: 1.1 * sc, w: 3.2 * MO.swirl, dr: -0.35 * sc }, y: gy + 0.1, vy: 1.1 + R(), grav: 0, life: 1, size: 0.07 * sc, color: R() < 0.5 ? PAL.bone : PAL.purple, spin: 7 * MO.spin, settle: false }); }
    });
  };

  // Living roots: staggered main roots + forking sub-roots, bark strands (normal blend) with a glowing sap vein, tip motes and sprouts.
  const groveRoots = (ev, c, n, radius, start, grow, opt = {}) => {
    const R = c.R, nb = opt.branches ?? qb(n), list = [];
    const order = Array.from({ length: n }, (_, k) => k); for (let k = n - 1; k > 0; k--) { const j = (R() * (k + 1)) | 0; [order[k], order[j]] = [order[j], order[k]]; }
    for (let k = 0; k < n; k++) { const t0 = start + order[k] * (grow * 0.32) + R() * 0.08; list.push({ a0: (k / n) * TAU + R() * 0.45, dir: R() < 0.5 ? -1 : 1, curl: 0.6 + R() * 0.8, len: radius * (0.72 + R() * 0.3), w: 0.28 + R() * 0.14, t0, T: grow * (0.8 + R() * 0.4), r0: 0.25, sprouted: false, motes: 0 }); }
    for (let k = 0; k < nb; k++) { const p = list[k % n], s0 = 0.35 + R() * 0.3; list.push({ parent: p, s0, a0: 0, dir: -p.dir, curl: 0.9 + R() * 0.8, len: p.len * (0.35 + R() * 0.2), w: p.w * 0.55, t0: p.t0 + p.T * s0, T: grow * 0.6, sprouted: false, motes: 0 }); }
    const bark = strips(ev, list.length, 14, barkM()), vein = strips(ev, n, 14, veinM()); if (vein.rb) vein.rb.mesh.renderOrder = 3;
    const path = (p) => {
      if (p.parent) { const q = p.parent, ps = [0, 0, 0]; pathOf(q)(p.s0, ps); const ba = q.a0 + q.dir * q.curl * p.s0 + p.dir * 0.9; return (s, o) => { const a = ba + p.dir * p.curl * s * 0.6 + Math.sin(s * 7 + p.len) * 0.1, r = p.len * s, x = ps[0] + Math.cos(a) * r, z = ps[2] + Math.sin(a) * r; o[0] = x; o[1] = H(x, z) + 0.06; o[2] = z; }; }
      return (s, o) => { const a = p.a0 + p.dir * p.curl * s + Math.sin(s * 9 + p.a0) * 0.1, r = p.r0 + (p.len - p.r0) * s, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; o[0] = x; o[1] = H(x, z) + 0.06; o[2] = z; };
    };
    const pathOf = (p) => p.fn || (p.fn = path(p)); list.forEach(pathOf);
    const tip = [0, 0, 0];
    ev.fx.push((age, dt) => {
      const fade = 1 - sstep(ev.dur - 0.8, ev.dur, age);
      list.forEach((p, j) => {
        const rv = easeOut((age - p.t0) / p.T), bw = p.w * (1 + 0.25 * Math.sin(age * 6 - j) * MO.shake * (rv < 1 ? 1 : 0));
        strand(bark, j, rv, fade, (u) => 1.35 * bw * (1 - 0.8 * u) * (u < 0.06 ? 0.4 + u * 10 : 1) / 0.28, p.fn);
        if (j < n && vein.rb) strand(vein, j, rv, fade * (0.55 + 0.45 * (1 - sstep(p.t0 + p.T, p.t0 + p.T + 1, age))), (u) => p.w * 0.45 * (1 - 0.85 * u) / 0.12, p.fn);
        if (rv > 0.02 && rv < 1) { p.motes += dt * 7 * Q.n; while (p.motes >= 1) { p.motes--; p.fn(rv, tip); glow.emit({ x: tip[0], y: tip[1] + 0.12, z: tip[2], vx: (R() - 0.5) * 0.4, vy: 0.5 + R() * 0.9, vz: (R() - 0.5) * 0.4, life: 1.1, size: 0.2 + R() * 0.12, grow: -0.4, color: R() < 0.55 ? PAL.gold : PAL.mint, alpha: 0.85, drag: 0.8 }); if (R() < 0.35) dust.emit({ x: tip[0], y: tip[1] + 0.05, z: tip[2], vy: 0.25, life: 1.2, size: 0.45, grow: 1.4, color: PAL.loam, alpha: 0.35, drag: 2 }); } }
        if (rv >= 1 && !p.sprouted) { p.sprouted = true; p.fn(1, tip); const ns = p.parent ? 1 : qn(3); for (let i = 0; i < ns; i++) leaves.emit({ R, x: tip[0] + (R() - 0.5) * 0.3, y: tip[1] + 0.12, z: tip[2] + (R() - 0.5) * 0.3, vy: 0.35 + R() * 0.3, grav: 0, drag: 3, life: ev.dur - age + 0.2, size: 0.4 + R() * 0.2, color: R() < 0.25 ? PAL.gold : R() < 0.6 ? PAL.leaf : PAL.moss, spin: 0.6 * MO.spin, settle: false }); }
      });
      bark.rb?.commit(0.28, 1, 1, 0); vein.rb?.commit(0.12, 1, 1, 0);
    });
  };
  const leafSwirl = (ev, c, r0, r1, w, until, rate, from = 0) => { let acc = 0; ev.fx.push((age, dt) => { if (age > until || age < from) return; acc += dt * rate * Q.n; while (acc >= 1) { acc--; leaves.emit({ R: c.R, orb: { cx: c.x, cz: c.z, a: c.R() * TAU, r: lp(r0, r1, c.R()), w: w * MO.swirl, dr: 0.25 }, y: c.y + 0.2, vy: 0.9 + c.R(), grav: 0, life: 1.9, size: 0.3, color: c.R() < 0.3 ? PAL.gold : c.R() < 0.6 ? PAL.leaf : PAL.moss, spin: 3 * MO.spin, settle: false }); } if (c.R() < dt * 8 * Q.n) motes(c, c.x, c.z, r1, PAL.gold, 0.18); }); };
  const chunks = (ev, c, n, r0, r1, dir) => { // lower (dir -1) / legacy raise chunks, now pooled kinematic clods
    const R = c.R, list = Array.from({ length: qk(n, 3) }, () => ({ i: rocks.claim(ev, R() < 0.5 ? PAL.earth : PAL.stone), a: R() * TAU, r: lp(r0, r1, R()), s: 0.22 + R() * 0.3, d: R() * 0.35, h: 0.4 + R() * 0.7, rot: R() * 4 }));
    ev.fx.push((age) => { for (const p of list) { const t = age - p.d, up = dir > 0 ? backOut(t / 0.55) * (1 - sstep(1.8, 2.4, age)) : 1 - sstep(p.d, p.d + 0.9, age), x = c.x + Math.cos(p.a) * p.r, z = c.z + Math.sin(p.a) * p.r; if (!(t > 0 && up > 0.01)) { rocks.hide(p.i); continue; } qRock(QT, p.rot + age * 0.4 * dir * MO.spin, p.rot * 2, 0); rocks.put(p.i, x, H(x, z) + (dir > 0 ? p.h * up * 0.5 : 0.3 - (1 - up) * 1.2), z, QT, p.s * (dir > 0 ? up : 1), p.s * 0.8, p.s); } });
  };

  const FX = {
    skeleton(ev, c) { ev.dur = 2.3; summon(ev, c, c.x, c.z, 1, 0); },
    squad(ev, c) { ev.dur = 2.7; for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; summon(ev, c, c.x + Math.cos(a) * 1.7, c.z + Math.sin(a) * 1.7, 0.75, i * 0.25); } pulse(ev, c, ribMat(PAL.gold, PAL.purple, 0, 1), 0.5, 3.2, 0, 1, 0.3); },
    golem(ev, c) {
      ev.dur = 3.2; const { x, z, R } = c, gy = c.y, ring = mk(ev, 64, ribMat(PAL.gold, PAL.ember, 0, 1.5));
      const parts = [[-0.36, 0, 0.42, 0.9, 0.46], [0.36, 0, 0.42, 0.9, 0.46], [0, 0.9, 1.2, 1, 0.7], [0, 1.95, 0.52, 0.46, 0.5], [-0.88, 0.95, 0.36, 0.95, 0.42], [0.88, 0.95, 0.36, 0.95, 0.42]].map(([px, py, w, h, d], i) => {
        const a = R() * TAU, r = 2.2 + R(); return { m: mesh(ev, i === 3 ? G.rock : G.slab, solid(i === 3 ? PAL.earth : PAL.stone, PAL.amber, 0.12)), px, py, w, h, d, sx: x + Math.cos(a) * r, sz: z + Math.sin(a) * r, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)), t0: 0.15 + i * 0.17, landed: false, dug: false };
      });
      pulse(ev, c, ribMat(PAL.gold, PAL.amber, 0, 1.2), 0.5, 3, 0, 1.1, 0.4); pulse(ev, c, ribMat(PAL.amber, PAL.ember, 0, 1), 0.5, 2.2, 1.6, 2.5, 0.35);
      decal(ev, c, soilM(), 0.2, 1.6, 0.45, 0.1, 0.6, 3.2);
      ev.fx.push((age) => {
        const k = 1 - sstep(2.4, 3, age); gRing(ring, x, z, 1.5 + 0.3 * Math.sin(age * 2), age, 0.1, 0.14, age * 3); ring.commit(0.2, easeOut(age / 0.8), k * sstep(0, 0.3, age));
        for (const p of parts) {
          const u = clamp((age - p.t0) / 0.9), e = easeOut(u), fx = x + p.px, fy = gy + p.py + p.h / 2;
          p.m.visible = u > 0 && k > 0.01; if (!p.m.visible) continue;
          if (!p.dug) { p.dug = true; const dx = x - p.sx, dz = z - p.sz; for (let i = 0; i < qn(4); i++) dustDir(c, p.sx, p.sz, dx, dz, 1.6, 0.7, PAL.dust, 0.4, 1.4, 0.6); debris(c, p.sx, p.sz, 2, 1.5, 0.1, [PAL.earth], 3); }
          p.m.position.set(lp(p.sx, fx, e), lp(H(p.sx, p.sz) - 0.4, fy, e) + Math.sin(u * Math.PI) * 1.4, lp(p.sz, z, e)); p.m.quaternion.slerpQuaternions(p.q, QI, e); p.m.scale.set(p.w * k, p.h * k, p.d * k);
          if (u >= 1 && !p.landed) { p.landed = true; for (let i = 0; i < qn(5); i++) { const a = R() * TAU; dustDir(c, fx, z, Math.cos(a), Math.sin(a), 1.8, 0.7, PAL.dust, 0.45, 1.5, 0.3, 0.3); } debris(c, fx, z, 2, 2, 0.1, [PAL.stone], 3); }
        }
        if (age > 2.4 && age < 3) puff(c, x + (R() - 0.5) * 1.5, z, 1, 1.5, 1, PAL.dust, 0.4);
      });
    },
    // RAISE EARTH: ground shudders (soil decal + radial fissures), clods churn up from below in a spiral and heap into a mound,
    // a crown of soil is flung up, loose rocks tumble down the flanks and a low dust skirt rolls outward over the terrain.
    raise(ev, c) {
      ev.dur = 2.9; const { x, z, R } = c, r = c.radius ?? 2.4;
      pulse(ev, c, amberM(), 0.3, r * 1.1, 0, 0.7, 0.32);
      decal(ev, c, soilM(), 0.1, r * 1.05, 0.62, 0, 0.45, 2.9, x, z, 0.1, R() * 6);
      const nf = qk(8, 4), fis = strips(ev, nf, 10, gougeM()), fl = Array.from({ length: nf }, (_, k) => ({ a: (k / nf) * TAU + R() * 0.5, L: r * (0.85 + R() * 0.45), t0: R() * 0.12, j: Array.from({ length: 10 }, () => (R() - 0.5) * 0.5) }));
      const clods = Array.from({ length: qk(22, 8) }, (_, k) => { const r0 = r * (0.3 + 0.75 * Math.sqrt(R())), s = 0.22 + R() * 0.24 + (1 - r0 / r) * 0.18; return { i: rocks.claim(ev, [PAL.clay, 0xb39874, PAL.stone, PAL.clay, 0xc9b28c][k % 5]), a0: R() * TAU, r0, s, d: 0.05 + (r0 / r) * 0.22 + R() * 0.12, w: (k % 2 ? 1 : -1) * (0.7 + R() * 0.6), rx: R() * 6, ry: R() * 6, sp: 2 + R() * 3, settle: 0.85 + R() * 0.3 }; });
      const cores = Array.from({ length: qk(3, 2) }, (_, k) => ({ i: rocks.claim(ev, k ? 0xb4afa6 : PAL.stone), a: R() * TAU, o: k ? 0.35 + R() * 0.25 : 0, s: 0.55 + R() * 0.2, t0: 0.16 + k * 0.08, rx: R() * 3, ry: R() * 6 }));
      const mound = (rr, age) => 1.35 * Math.max(0, 1 - rr / r) ** 1.3 * backOut((age - 0.12) / 0.8) * (1 - 0.15 * sstep(1.4, 2.2, age));
      let crown = false, accT = 0, accS = 0, accC = 0;
      ev.fx.push((age, dt) => {
        const fade = 1 - sstep(ev.dur - 0.6, ev.dur, age), sink = sstep(ev.dur - 0.7, ev.dur, age), shake = MO.shake * 0.04 * (1 - sstep(0.2, 1.1, age));
        fl.forEach((f, j) => { const rv = easeOut((age - f.t0) / 0.35); strand(fis, j, rv, 0.85 * fade, (u) => 0.22 * (1 - 0.85 * u) / 0.2, (s, o) => { const i = Math.min(9, Math.floor(s * 9)), a = f.a + f.j[i] * 0.25, q = 0.25 + (f.L - 0.25) * s, px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q; o[0] = px; o[1] = H(px, pz) + 0.07; o[2] = pz; }); });
        fis.rb.commit(0.2, 1, 1, 0);
        for (const p of clods) {
          const tp = age - p.d; if (tp <= 0) { rocks.hide(p.i); continue; }
          const em = sstep(0, 0.4, tp), churn = p.w * (1 - Math.exp(-tp * 2.2)) * MO.swirl, rr = p.r0 * (1 - 0.32 * sstep(0.05, 1.3, tp)), a = p.a0 + churn, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
          const top = mound(rr, age) * p.settle, y = H(px, pz) - p.s + em * (p.s * 0.7 + top) - sink * (p.s + top + 0.2) + Math.sin(age * 31 + p.rx) * shake, tumble = (p.rx - 3) * 0.35 * (1 - sstep(0.15, 0.9, tp)) * MO.spin;
          // upheaved wedge: crust stays up and leans outward with the mound flank; a brief churn tumble decays as it settles
          EU.set(0, -a + (p.ry - 3) * 0.25, 0, 'YXZ'); QT.setFromEuler(EU); q2r.setFromAxisAngle(V.set(0, 0, 1), -(0.25 + 0.55 * (rr / r)) * em + tumble); QT.multiply(q2r); q2r.setFromAxisAngle(V.set(1, 0, 0), (p.sp - 3.5) * 0.12 + tumble * 0.6); QT.multiply(q2r);
          rocks.put(p.i, px, y, pz, QT, p.s * 1.25 * (1 - sink * 0.6), p.s * 0.95, p.s * (0.8 + 0.12 * p.sp));
        }
        for (const p of cores) { const t = backOut((age - p.t0) / 0.6), px = x + Math.cos(p.a) * p.o, pz = z + Math.sin(p.a) * p.o; if (t <= 0.01) { rocks.hide(p.i); continue; } // upthrust stratified wedges, leaning apart from the centre
          EU.set(0, -p.a + p.ry * 0.2, 0, 'YXZ'); QT.setFromEuler(EU); q2r.setFromAxisAngle(V.set(0, 0, 1), -(0.18 + p.rx * 0.12) * t); QT.multiply(q2r);
          rocks.put(p.i, px, H(px, pz) - p.s * 0.7 + t * (mound(p.o, age) * 0.75 + p.s * 0.45) - sink * (p.s + 1), pz, QT, p.s * 1.1 * (1 - sink * 0.5), p.s * 1.25 * t, p.s * 0.85); }
        if (!crown && age > 0.14) { crown = true; for (let i = 0; i < qn(12); i++) { const a = R() * TAU, s = 0.6 + R() * 1.2; dust.emit({ x: x + Math.cos(a) * 0.4, y: H(x, z) + 0.4, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * s, vy: 2.4 + R() * 2.2, vz: Math.sin(a) * s, life: 1.3, size: 0.5 + R() * 0.4, grow: 0.8, color: R() < 0.5 ? PAL.clay : PAL.earth, alpha: 0.55, grav: 5, drag: 0.6 }); } for (let i = 0; i < qn(16); i++) ejecta(c, x, z, R() * TAU, r * (0.7 + R() * 0.7), 0.55 + R() * 0.35, 0.09 + R() * 0.08, [PAL.soil, PAL.earth, PAL.stone, PAL.clay][i % 4]); }
        if (age > 0.1 && age < 0.75) { accS += dt * 70 * Q.n; while (accS >= 1) { accS--; const a = R() * TAU, q = r * (0.8 + 0.25 * R()); dustDir(c, x + Math.cos(a) * q, z + Math.sin(a) * q, Math.cos(a), Math.sin(a), 2.6, 1.1, R() < 0.6 ? PAL.dust : PAL.clay, 0.42, 1.7, 0.25, 0.35); } }
        if (age > 0.45 && age < 1.7) { accT += dt * 11 * Q.n; while (accT >= 1) { accT--; const a = R() * TAU, q = r * 0.15 * R(), px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q, top = H(px, pz) + mound(q, age); shards.emit({ R, x: px, y: top, z: pz, vx: Math.cos(a) * (1.4 + R() * 1.2), vy: 0.6 + R() * 0.8, vz: Math.sin(a) * (1.4 + R() * 1.2), life: 1.6 + R() * 0.6, size: 0.1 + R() * 0.1, sy: 1.1, color: R() < 0.5 ? PAL.stone : PAL.loam, grav: 12, drag: 0.4, spin: 6 * MO.spin }); } }
        if (age < 1.9) { accC += dt * 14 * Q.n; while (accC >= 1) { accC--; const a = R() * TAU, q = r * 0.7 * R(); dustDir(c, x + Math.cos(a) * q, z + Math.sin(a) * q, Math.cos(a), Math.sin(a), 0.6, 0.8, PAL.loam, 0.3, 1.5, 1, 0.8); } }
      });
    },
    lower(ev, c) {
      ev.dur = 2.4; pulse(ev, c, purpleM(), 2.8, 0.3, 0, 0.9, 0.4); pulse(ev, c, tealM(), 2.2, 0.2, 0.4, 1.3, 0.3); chunks(ev, c, 9, 0.2, 1.8, -1);
      decal(ev, c, gougeM(), 0.1, 2.0, 0.5, 0.2, 1.2, 2.4);
      for (let i = 0; i < qn(14); i++) { const a = c.R() * TAU, q = 2.2 + c.R() * 0.4; dustDir(c, c.x + Math.cos(a) * q, c.z + Math.sin(a) * q, -Math.cos(a), -Math.sin(a), 1.8, 1, PAL.dust, 0.42, 1.6, 0.2, 0.25); }
      for (let i = 0; i < qn(16); i++) shards.emit({ R: c.R, orb: { cx: c.x, cz: c.z, a: c.R() * TAU, r: 1.2 + c.R() * 1.2, w: 1.2 * MO.swirl, dr: -1.1 }, y: c.y + 0.4 + c.R() * 0.6, vy: -0.4, grav: 0, life: 1.4, size: 0.12, color: i % 2 ? PAL.purple : PAL.earth, settle: false, spin: 4 * MO.spin });
    },
    // SUNDER: a fracture front races lengthwise from start to end. Behind it the gouge widens, a molten seam cools, side
    // cracks fork off, ground plates heave up on their outer hinges and settle; dust is thrown outward and forward off the front.
    sunder(ev, c) {
      const { ax, az, bx, bz, len, ang, R } = c, dx = Math.cos(ang), dz = Math.sin(ang), nx = -dz, nz = dx;
      const T = clamp(0.4 + len * 0.07, 0.55, 1.5), t0 = 0.06; ev.dur = T + 2.5;
      const n = Math.min(110, Math.max(24, Math.ceil(len / 0.4))), jit = Float32Array.from({ length: n }, () => R() * 2 - 1);
      const env = (u) => Math.min(1, u * 6, (1 - u) * 6), off = (u) => { const f = u * (n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i; return lp(jit[i], jit[i + 1], k * k * (3 - 2 * k)) * 0.34 * env(u); };
      const at = (u, o) => { const w = off(u); o[0] = lp(ax, bx, u) + nx * w; o[2] = lp(az, bz, u) + nz * w; o[1] = H(o[0], o[2]) + 0.09; return o; };
      const lip = mk(ev, n, soilM()), dark = mk(ev, n, gougeM()), heat = mk(ev, n, moltenM()); lip.mesh.renderOrder = 0; dark.mesh.renderOrder = 1;
      const nbr = qb(10), br = strips(ev, nbr, 8, gougeM()), bl = Array.from({ length: nbr }, (_, k) => { const s = k % 2 ? 1 : -1, th = (0.55 + R() * 0.6) * s; return { u: clamp((k + 0.5) / nbr + (R() - 0.5) * 0.06, 0.05, 0.95), dxb: dx * Math.cos(th) + nx * Math.sin(th), dzb: dz * Math.cos(th) + nz * Math.sin(th), L: 0.6 + R() * 0.9 + len * 0.03, j: Array.from({ length: 8 }, () => (R() - 0.5) * 0.35) }; });
      const np = qk(Math.min(13, Math.max(4, Math.ceil(len / 0.95))), 3), pl = [];
      // The two banks are staggered (different counts and half-slot offset) with independent length/width/thickness, flip, lean and
      // hinge pitch, so the torn wedges never pair up into matching paving slabs.
      for (const s of [-1, 1]) { const ns = s < 0 ? np : Math.max(3, np - 1 + ((R() * 2) | 0)), sh = s < 0 ? 0 : 0.5; for (let k = 0; k < ns; k++) pl.push({ s, u: clamp((k + sh * 0.5 + 0.5 + (R() - 0.5) * 0.45) / ns, 0.03, 0.97), lm: (np / ns) * (0.7 + R() * 0.6), i: slabs.claim(ev, [0xffffff, 0xeee4d8, 0xd9d2c8, 0xf6efe2, 0xe2d6c4][(k * 2 + (s > 0 ? 1 : 0)) % 5]), w: 0.4 + R() * 0.75, th: 0.24 + R() * 0.26, tilt: 0.22 + R() * 0.75, d: R() * 0.08, yaw: (R() - 0.5) * 0.6, pitch: (R() - 0.5) * 0.42, flip: R() < 0.5, lift: 0.06 + R() * 0.16 }); }
      const rest = 0.55 + R() * 0.15; let accD = 0, accB = 0, accE = 0, done = false; const fp = [0, 0, 0], q2 = new THREE.Quaternion();
      ev.fx.push((age, dt) => {
        const front = clamp((age - t0) / T), fade = 1 - sstep(ev.dur - 1.0, ev.dur, age), cool = 1 - 0.75 * sstep(T, T + 1.6, age), hp = MO.flick ? 0.8 + 0.2 * Math.sin(age * 11) : 0.9;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), behind = front - u, open = behind > 0 ? easeOut(behind * len / 1.1) : 0; at(u, fp);
          lip.set(i, fp[0], fp[1], fp[2]); dark.set(i, fp[0], fp[1], fp[2]); heat.set(i, fp[0], fp[1] + 0.01, fp[2]);
          lip.wm[i] = open * (1 + 0.25 * jit[(i * 7) % n]); lip.am[i] = open > 0 ? 1 : 0;
          dark.wm[i] = open * (0.75 + 0.25 * Math.abs(jit[i])); dark.am[i] = open > 0 ? 1 : 0;
          heat.wm[i] = open * (0.5 + 0.5 * Math.exp(-behind * len / 1.4)); heat.am[i] = open > 0 ? hp * (0.25 + 0.75 * Math.exp(-behind * len / 2)) * cool : 0;
        }
        lip.commit(1.9, 1, fade * 0.7, 0); dark.commit(0.62, 1, fade * 0.92, 0); heat.commit(0.26, 1, fade, 0);
        bl.forEach((b, j) => { const rv = easeOut((front - b.u) * len / 1.2); at(b.u, fp); const x0 = fp[0], z0 = fp[2]; strand(br, j, rv, fade * 0.85, (u2) => 0.17 * (1 - 0.85 * u2) / 0.18, (s, o) => { const i = Math.min(7, Math.floor(s * 7)), q = b.L * s, px = x0 + b.dxb * q + nx * b.j[i] * s, pz = z0 + b.dzb * q + nz * b.j[i] * s; o[0] = px; o[1] = H(px, pz) + 0.08; o[2] = pz; }); });
        br.rb?.commit(0.18, 1, 1, 0);
        for (const p of pl) {
          const tp = age - t0 - T * p.u - p.d; if (tp <= 0) { slabs.hide(p.i); continue; }
          const heave = backOut(tp / 0.32), settle = lp(1, rest, sstep(0.35, 1.2, tp)), sink = sstep(ev.dur - 0.9, ev.dur, age), jolt = MO.shake * 0.05 * Math.sin(tp * 40) * (1 - sstep(0, 0.4, tp));
          const tilt = p.tilt * heave * settle * (1 - sink), L = (len / np) * 0.92 * p.lm, hw = p.w * 0.5, cxu = lp(ax, bx, p.u), czu = lp(az, bz, p.u), w0 = off(p.u), dist = 0.3 * heave + hw + Math.abs(w0) * 0.2;
          const x = cxu + nx * (w0 + p.s * dist), z = czu + nz * (w0 + p.s * dist), y = H(x, z) - p.th * 0.5 + Math.sin(tilt) * hw * 0.9 + p.lift * heave * (1 - sink) + jolt - sink * 0.4;
          const sg = p.flip ? -p.s : p.s; q2.setFromEuler(EU.set(0, -ang + p.yaw + (p.flip ? Math.PI : 0), 0, 'YXZ')); QT.setFromAxisAngle(V.set(1, 0, 0), sg * tilt); q2.multiply(QT); // inner edge lifts, outer edge hinges on the ground
          QT.setFromAxisAngle(V.set(0, 0, 1), p.pitch * heave * (1 - sink)); q2.multiply(QT); // uneven hinge: one end rides higher
          slabs.put(p.i, x, y, z, q2, L, p.th, p.w * (1 - sink * 0.3));
        }
        if (front > 0 && front < 1) {
          at(front, fp); const fx = fp[0], fz = fp[2];
          accD += dt * 46 * Q.n; while (accD >= 1) { accD--; const s = R() < 0.5 ? -1 : 1; dustDir(c, fx + nx * s * 0.3, fz + nz * s * 0.3, nx * s * 1.4 + dx * 0.8, nz * s * 1.4 + dz * 0.8, 2.6, 1.05, R() < 0.55 ? PAL.dust : PAL.clay, 0.5, 1.9, 0.3, 0.7); }
          accB += dt * 16 * Q.n; while (accB >= 1) { accB--; const s = R() < 0.5 ? -1 : 1, a = Math.atan2(nz * s * 1.6 + dz * 0.6, nx * s * 1.6 + dx * 0.6); ejecta(c, fx, fz, a + (R() - 0.5) * 0.6, 0.9 + R() * 1.8, 0.45 + R() * 0.35, 0.09 + R() * 0.09, [PAL.stone, PAL.earth, PAL.loam][(R() * 3) | 0]); }
          if (R() < dt * 30 * Q.n) glow.emit({ x: fx, y: H(fx, fz) + 0.15, z: fz, vx: dx * 1.5, vy: 0.6 + R(), vz: dz * 1.5, life: 0.4, size: 0.55, grow: -0.6, color: R() < 0.5 ? PAL.gold : PAL.amber, alpha: 0.9, drag: 2 });
        }
        if (front >= 1 && !done) { done = true; at(1, fp); for (let i = 0; i < qn(8); i++) dustDir(c, fp[0], fp[2], dx + (R() - 0.5), dz + (R() - 0.5), 2.2, 1.2, PAL.dust, 0.5, 1.8, 0.5, 0.5); debris(c, fp[0], fp[2], 5, 2.2, 0.12, [PAL.stone, PAL.earth], 5); }
        if (age > t0 + 0.2 && age < T + 1.6) { accE += dt * 9 * Q.n; while (accE >= 1) { accE--; at(R() * front, fp); glow.emit({ x: fp[0], y: fp[1] + 0.08, z: fp[2], vx: (R() - 0.5) * 0.3, vy: 0.5 + R() * 0.8, vz: (R() - 0.5) * 0.3, life: 1.2, size: 0.14 + R() * 0.1, grow: -0.5, color: R() < 0.6 ? PAL.ember : PAL.amber, alpha: 0.85, drag: 0.6 }); if (R() < 0.4) dust.emit({ x: fp[0], y: fp[1] + 0.1, z: fp[2], vy: 0.4 + R() * 0.3, life: 1.8, size: 0.6, grow: 1.6, color: PAL.smoke, alpha: 0.24, grav: -0.15, drag: 1 }); } }
      });
    },
    wall(ev, c) {
      ev.dur = 3.4; const { ax, az, bx, bz, len, ang, R } = c, N = Math.max(3, Math.ceil(len / 1.3)), segL = len / N;
      const pl = Array.from({ length: N }, (_, k) => { const u = (k + 0.5) / N; return { m: mesh(ev, G.slab, solid(k % 2 ? PAL.stone : 0x9a968c, PAL.gold, 0.08)), x: lp(ax, bx, u), z: lp(az, bz, u), h: 1.7 + R() * 0.7, t0: 0.12 + u, puffed: false }; });
      const trim = mk(ev, Math.min(100, Math.ceil(len / 0.5) + 2), ribMat(PAL.gold, PAL.amber, 6, 1.2)), scar = mk(ev, Math.min(100, Math.ceil(len / 0.5) + 2), soilM()); scar.mesh.renderOrder = 1;
      const nx = -Math.sin(ang), nz = Math.cos(ang);
      ev.fx.push((age) => {
        const sink = 1 - sstep(2.7, 3.4, age); gLine(trim, ax, az, bx, bz, 0.12); trim.commit(0.35, sstep(0, 1.1, age), sink * (0.75 + 0.25 * Math.sin(age * 8) * MO.flick));
        gLine(scar, ax, az, bx, bz, 0.06); scar.commit(1.5, sstep(0, 1.15, age), sink * 0.6, 0);
        for (const p of pl) {
          const t = age - p.t0, rise = backOut(t / 0.55) * sink; p.m.visible = t > 0 && rise > 0.01; if (!p.m.visible) continue;
          p.m.rotation.set(0, -ang, 0); p.m.scale.set(segL * 0.96, p.h * rise, 0.55); p.m.position.set(p.x, H(p.x, p.z) + (p.h * rise) / 2 - 0.1, p.z);
          if (!p.puffed) { p.puffed = true; for (let i = 0; i < qn(6); i++) { const s = i % 2 ? 1 : -1; dustDir(c, p.x + nx * s * 0.4, p.z + nz * s * 0.4, nx * s, nz * s, 1.8, 0.7, PAL.dust, 0.45, 1.5, 0.5, 0.4); } debris(c, p.x, p.z, 3, 2.5, 0.1, [PAL.stone], 4); }
        }
      });
    },
    // GROVE: roots break the soil one after another, fork, and sprout leaves at their tips while sap motes chase the growth.
    grove(ev, c) {
      ev.dur = 3.6; const r = c.radius ?? 3.5; pulse(ev, c, greenM(), 0.3, r, 0, 1, 0.3);
      decal(ev, c, ribMat(PAL.moss, 0x3d6b2a, 0, 0.4, false), 0.2, r * 0.95, 0.22, 0.15, 1.6, 3.6, c.x, c.z, 0.12, c.R() * 6);
      decal(ev, c, soilM(), 0.05, 0.9, 0.55, 0, 0.3, 3.6);
      groveRoots(ev, c, qk(7, 4), r, 0.05, 0.95); leafSwirl(ev, c, 0.4, r * 0.7, 1.4, 2.6, 12, 0.6);
      for (let i = 0; i < qn(10); i++) { const a = c.R() * TAU; dustDir(c, c.x + Math.cos(a) * 0.5, c.z + Math.sin(a) * 0.5, Math.cos(a), Math.sin(a), 1.4, 0.75, PAL.clay, 0.25, 1.4, 0.3, 0.4); }
    },
    // TREE RING: standing stones heave up one after another around the circle; roots knit each stone to the next.
    ring(ev, c) {
      ev.dur = 3.6; const r = c.radius ?? 4, R = c.R, band = [0, 1].map((i) => mk(ev, 72, i ? ribMat(PAL.leaf, PAL.gold, 0, 1) : tealM())), N = qk(12, 6);
      const st = Array.from({ length: N }, (_, k) => ({ i: rocks.claim(ev, k % 3 ? PAL.stone : PAL.slate), a: (k / N) * TAU + (R() - 0.5) * 0.12, h: 0.9 + R() * 0.7, t0: 0.2 + (k / N) * 0.9, rx: (R() - 0.5) * 0.25, ry: R() * 6, burst: false }));
      const knit = strips(ev, N, 10, barkM()), glowK = strips(ev, N, 10, ribMat(PAL.teal, PAL.leaf, 0, 1.4)); glowK.rb.mesh.renderOrder = 3;
      decal(ev, c, ribMat(PAL.moss, PAL.deepTeal, 0, 0.4, false), r * 0.82, r * 1.18, 0.4, 0.1, 1.2, 3.6);
      ev.fx.push((age) => {
        const rv = easeOut(age / 1.1), fade = 1 - sstep(2.8, 3.6, age); band.forEach((rb, i) => { gRing(rb, c.x, c.z, r * (1 - i * 0.08), age * (i ? -0.4 : 0.4) * MO.swirl, 0.1, 0.06, age * 3 + i); rb.commit(0.26 - i * 0.08, rv, fade * 0.8); });
        st.forEach((s, k) => {
          const t = backOut((age - s.t0) / 0.5) * fade, x = c.x + Math.cos(s.a) * r, z = c.z + Math.sin(s.a) * r;
          if (age > s.t0 && !s.burst) { s.burst = true; for (let i = 0; i < qn(3); i++) dustDir(c, x, z, Math.cos(s.a + (i - 1) * 1.6), Math.sin(s.a + (i - 1) * 1.6), 1.4, 0.7, PAL.dust, 0.4, 1.3, 0.4, 0.4); debris(c, x, z, 2, 1.6, 0.09, [PAL.soil, PAL.stone], 4); sparks(c, x, H(x, z) + 0.6, z, 2, 1.2, PAL.teal, 0.2, 1.1); }
          if (t <= 0.01) rocks.hide(s.i); else { qRock(QT, s.rx, s.ry, s.rx * 0.5); rocks.put(s.i, x, H(x, z) - 0.15 + s.h * t * 0.42, z, QT, 0.34, s.h * t * 0.62, 0.3); }
          const b = st[(k + 1) % N], a1 = b.a < s.a ? b.a + TAU : b.a, kr = easeOut((age - s.t0 - 0.35) / 0.45);
          const pf = (q, o) => { const a = lp(s.a, a1, q), rr = r * (1 - 0.06 * Math.sin(q * Math.PI)) + Math.sin(q * 17 + k) * 0.06, px = c.x + Math.cos(a) * rr, pz = c.z + Math.sin(a) * rr; o[0] = px; o[1] = H(px, pz) + 0.07; o[2] = pz; };
          strand(knit, k, kr, fade * 0.95, (u) => 0.85 + 0.15 * Math.sin(u * 9), pf); strand(glowK, k, kr, fade * 0.7, () => 1, pf);
        });
        knit.rb.commit(0.2, 1, 1, 0); glowK.rb.commit(0.07, 1, 1, 0);
      });
      groveRoots(ev, c, qk(6, 3), r * 0.85, 0.15, 1.0, { branches: qb(3) }); leafSwirl(ev, c, r * 0.85, r * 1.05, 1.4, 2.4, 14); pulse(ev, c, tealM(), 0.5, r * 1.1, 0, 1, 0.3);
    },
    // STARFALL: approach (meteor + trail, ground target tightens and wind lifts dust), impact (attached flash disc, shockwave,
    // crater rim burst, terrain-landing ejecta, outward dust wall), settling (molten fissures cool, smoke column, embers, rim sinks).
    starfall(ev, c) {
      const { x, z, R } = c, gy = c.y, fl = c.flight ?? LAUNCH, r = c.radius ?? 4; ev.dur = fl + 3.4;
      const da = R() * TAU, S = new THREE.Vector3(x + Math.cos(da) * 10, gy + 36, z + Math.sin(da) * 10), T = new THREE.Vector3(x, gy + 0.4, z);
      const back = S.clone().sub(T).normalize(), grp = new THREE.Group(); ev.g.add(grp); grp.quaternion.setFromUnitVectors(UP, back);
      // Head: a dark, faceted, lit rock (teardrop: blunt leading face) wrapped in an additive heat shell whose vertex colours carry
      // glowing crack seams and a lopsided white-hot leading face. Two meshes replace the old glowing ball + two flame cones.
      const rock = new THREE.Mesh(G.meteor, meteorMat()), heat = new THREE.Mesh(G.meteorHeat, heatMat()), spinG = new THREE.Group();
      rock.scale.setScalar(0.95); heat.scale.setScalar(0.95 * 1.025); spinG.add(rock, heat); grp.add(spinG); spinG.rotation.y = R() * TAU;
      const hist = Array.from({ length: 22 }, () => S.clone()), tr = [mk(ev, 22, ribMat(PAL.ember, 0x5a1a08, 0, 2), null), mk(ev, 22, ribMat(PAL.gold, PAL.ember, 0, 2), null)]; tr[1].side = [Math.cos(da), Math.sin(da)];
      const flash = own(ev, G.disc, PAL.gold), target = mk(ev, 64, ribMat(PAL.ember, PAL.gold, 5, 2));
      decal(ev, c, gougeM(), 0.05, r * 0.68, 0.8, fl, fl + 0.25, ev.dur, x, z, 0.07, R() * 6);
      decal(ev, c, soilM(), r * 0.55, r * 1.2, 0.36, fl + 0.05, fl + 0.6, ev.dur, x, z, 0.05, R() * 6);
      const nm = qk(10, 5), mol = strips(ev, nm, 10, moltenM()), ml = Array.from({ length: nm }, (_, k) => ({ a: (k / nm) * TAU + R() * 0.4, L: r * (0.75 + R() * 0.5), j: Array.from({ length: 10 }, () => (R() - 0.5) * 0.4), d: R() * 0.12 }));
      const rim = Array.from({ length: qk(16, 7) }, (_, k, a = (k / 16) * TAU + R() * 0.3) => ({ i: rocks.claim(ev, [PAL.slate, PAL.stone, PAL.cinder, PAL.clay][k % 4]), a, q: r * (0.5 + R() * 0.16), s: 0.3 + R() * 0.3, d: R() * 0.08, rx: R() * 6, sp: 0.4 + R() * 0.4 }));
      pulse(ev, c, amberM(), 0.5, r * 1.8, fl, fl + 0.8, 0.9); pulse(ev, c, ribMat(PAL.gold, PAL.amber, 0, 1), 0.3, r * 1.1, fl + 0.08, fl + 0.7, 0.4);
      flash.visible = false; let hit = false, acc = 0, accW = 0, accD = 0, accS = 0, accE = 0;
      ev.fx.push((age, dt) => {
        const tFade = 1 - sstep(ev.dur - 0.7, ev.dur, age);
        if (age < fl) {
          const e = Math.pow(age / fl, 1.4); V.copy(S).lerp(T, e); grp.position.copy(V); const last = hist.pop(); last.copy(V); hist.unshift(last); spinG.rotation.y += dt * 2.2 * MO.spin; // slow roll about the flight axis keeps the hot face leading
          heat.scale.setScalar(0.95 * (1.025 + (MO.flick ? 0.012 * Math.sin(age * 37) : 0)));
          for (const rb of tr) { hist.forEach((h, i) => rb.set(i, h.x + back.x * 0.25, h.y + back.y * 0.25, h.z + back.z * 0.25)); }
          tr[0].commit(1.15, 1, 0.8, 1); tr[1].commit(0.42, 1, 0.9, 1);
          glow.emit({ x: V.x - back.x * 0.75, y: V.y - back.y * 0.75, z: V.z - back.z * 0.75, life: 0.08, size: 1.5, grow: 0.3, color: PAL.amber, alpha: 0.32 }); // small heat haze just behind the head (pooled, 1 slot/frame)
          if (R() < dt * 26 * Q.n) dust.emit({ x: V.x + back.x * 0.9, y: V.y + back.y * 0.9, z: V.z + back.z * 0.9, vx: back.x * 2 + (R() - 0.5), vy: back.y * 2 + (R() - 0.5), vz: back.z * 2 + (R() - 0.5), life: 0.9, size: 0.9, grow: 1.6, color: 0x3b3430, alpha: 0.4, drag: 1.5 }); // dark ablation smoke
          acc += dt * 40 * Q.n; while (acc >= 1) { acc--; glow.emit({ x: V.x, y: V.y, z: V.z, vx: back.x * 6 + (R() - 0.5) * 3, vy: back.y * 6 + (R() - 0.5) * 3, vz: back.z * 6 + (R() - 0.5) * 3, life: 0.5, size: 0.35, grow: -0.5, color: R() < 0.5 ? PAL.amber : PAL.gold, alpha: 0.9, grav: 3, drag: 2 }); }
          gRing(target, x, z, lp(r * 1.05, r * 0.3, e), -age * 2 * MO.swirl, 0.1, 0.03, 0); target.commit(0.22 + 0.3 * e, 1, 0.3 + 0.7 * e);
          if (e > 0.55) { accW += dt * 40 * Q.n; while (accW >= 1) { accW--; const a = R() * TAU, q = r * (0.25 + 0.7 * R()); dustDir(c, x + Math.cos(a) * q, z + Math.sin(a) * q, Math.cos(a), Math.sin(a), 2 + e * 2, 0.9, PAL.dust, 0.3, 1.2, 0.2, 0.3); } }
          return;
        }
        const tp = age - fl, u = tp / 2.4;
        if (!hit) { hit = true; grp.visible = false; target.mesh.visible = false; tr.forEach((rb) => (rb.mesh.visible = false)); flash.visible = true;
          for (let i = 0; i < qn(34); i++) { const a = R() * TAU; ejecta(c, x, z, a, r * (0.6 + R() * 1.3), 0.55 + R() * 0.65, 0.12 + R() * 0.16, [PAL.stone, PAL.earth, PAL.cinder, PAL.slate][i % 4]); }
          for (let i = 0; i < qn(18); i++) { const a = R() * TAU, d = r * (0.4 + R()), Tq = 0.5 + R() * 0.5, tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d; glow.emit({ x, y: gy + 0.4, z, vx: (tx - x) / Tq, vy: (H(tx, tz) - gy + 4.5 * Tq * Tq) / Tq, vz: (tz - z) / Tq, life: Tq + 0.6, size: 0.26, grow: -0.3, color: R() < 0.5 ? PAL.amber : PAL.gold, alpha: 0.95, grav: 9, drag: 0, floor: H(tx, tz) + 0.06 }); }
          for (let i = 0; i < qn(10); i++) { const a = R() * TAU; dust.emit({ x, y: gy + 0.5, z, vx: Math.cos(a) * 1.2, vy: 3 + R() * 3, vz: Math.sin(a) * 1.2, life: 1.6, size: 1.2, grow: 1.4, color: PAL.ash, alpha: 0.5, grav: 2.5, drag: 1.2 }); }
        }
        flash.position.set(x, H(x, z) + 0.2, z); flash.scale.setScalar(r * (0.25 + 0.8 * easeOut(u * 3))); flash.material.opacity = 0.75 * MO.flash * (1 - clamp(u * 8)); flash.visible = u < 0.125; // flat disc: keep it to the first 0.3 s so it never floats over sloped craters
        if (tp < 0.65) { accD += dt * 110 * Q.n; while (accD >= 1) { accD--; const a = R() * TAU, q = r * (0.35 + 1.5 * easeOut(tp / 0.65)); dustDir(c, x + Math.cos(a) * q, z + Math.sin(a) * q, Math.cos(a), Math.sin(a), 4.5, 1.9, R() < 0.6 ? PAL.dust : PAL.clay, 0.5, 2.4, 0.15, 0.9); } }
        if (tp > 0.08 && tp < 2.8) { accS += dt * 12 * Q.n; while (accS >= 1) { accS--; const a = R() * TAU, q = r * 0.35 * R(), px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q; dust.emit({ x: px, y: H(px, pz) + 0.3, z: pz, vx: (R() - 0.5) * 0.6, vy: 1.4 + R() * 1.2, vz: (R() - 0.5) * 0.6, life: 2.2 + R() * 0.6, size: 1.4 + R() * 0.8, grow: 1.8, color: R() < 0.5 ? PAL.smoke : PAL.ash, alpha: 0.26 * (1 - sstep(1.2, 2.8, tp)) + 0.04, grav: -0.35, drag: 0.7 }); } }
        if (tp > 0.2 && tp < 2.6) { accE += dt * 10 * Q.n; while (accE >= 1) { accE--; const f = ml[(R() * nm) | 0], q = f.L * R(), px = x + Math.cos(f.a) * q, pz = z + Math.sin(f.a) * q; glow.emit({ x: px, y: H(px, pz) + 0.1, z: pz, vy: 0.6 + R() * 1.2, vx: (R() - 0.5) * 0.4, vz: (R() - 0.5) * 0.4, life: 1.3, size: 0.16 + R() * 0.1, grow: -0.5, color: R() < 0.6 ? PAL.ember : PAL.amber, alpha: 0.85, drag: 0.6 }); } }
        const coolA = (1 - sstep(0.3, 2.8, tp) * 0.8) * tFade, hp = MO.flick ? 0.85 + 0.15 * Math.sin(age * 9) : 0.92;
        ml.forEach((f, j) => { const rv = easeOut((tp - f.d) / 0.28); strand(mol, j, rv, coolA * hp, (q) => (1 - 0.8 * q) * (0.6 + 0.4 * Math.abs(f.j[(q * 9) | 0])) / 0.3 * 0.3, (s, o) => { const i = Math.min(9, Math.floor(s * 9)), a = f.a + f.j[i] * 0.22, q = r * 0.12 + (f.L - r * 0.12) * s, px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q; o[0] = px; o[1] = H(px, pz) + 0.08; o[2] = pz; }); });
        mol.rb.commit(0.3, 1, 1, 0);
        const sink = sstep(ev.dur - 0.9, ev.dur, age);
        for (const p of rim) { const t = backOut((tp - p.d) / 0.3), px = x + Math.cos(p.a) * p.q * (0.8 + 0.2 * t), pz = z + Math.sin(p.a) * p.q * (0.8 + 0.2 * t); if (t <= 0.01) { rocks.hide(p.i); continue; } EU.set(0, -p.a, 0, 'YXZ'); QT.setFromEuler(EU); q2r.setFromAxisAngle(V.set(0, 0, 1), p.sp * t); QT.multiply(q2r); rocks.put(p.i, px, H(px, pz) - p.s * 0.6 + t * p.s * 0.75 - sink * p.s * 1.2, pz, QT, p.s * 1.25, p.s * 0.75 * (1 - sink * 0.4), p.s); }
      });
    },
    crystal(ev, c) {
      ev.dur = 3.6; const R = c.R, list = Array.from({ length: 7 }, (_, i) => {
        const a = R() * TAU, r = i ? 0.5 + R() * 0.9 : 0, k = i % 2; return { m: mesh(ev, G.crystal, solid(k ? 0x8f6bff : 0x2fd9c4, k ? 0x4d2a8f : 0x127f78, 0.9)), x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, h: i ? 1.1 + R() * 1.2 : 2.8, w: i ? 0.9 : 1.4, t0: i * 0.07, d: new THREE.Vector3(Math.cos(a) * 0.3 * (i ? 1 : 0), 1, Math.sin(a) * 0.3 * (i ? 1 : 0)).normalize(), puffed: false };
      });
      pulse(ev, c, tealM(), 0.3, 2.6, 0, 0.9, 0.35); pulse(ev, c, ribMat(PAL.purple, PAL.teal, 6, 1), 0.3, 1.8, 0.3, 1.4, 0.25); let acc = 0;
      decal(ev, c, soilM(), 0.1, 1.7, 0.5, 0, 0.4, 3.6);
      ev.fx.push((age, dt) => {
        const k = 1 - sstep(3, 3.6, age);
        for (const p of list) { const t = backOut((age - p.t0) / 0.5) * k; p.m.visible = t > 0.01; p.m.position.set(p.x, H(p.x, p.z) - 0.05, p.z); p.m.quaternion.setFromUnitVectors(UP, p.d); p.m.scale.set(p.w * t, p.h * t, p.w * t); if (age > p.t0 && !p.puffed) { p.puffed = true; debris(c, p.x, p.z, 3, 3, 0.1, [PAL.teal, PAL.purple, PAL.ice], 6); for (let i = 0; i < qn(3); i++) { const a = c.R() * TAU; dustDir(c, p.x, p.z, Math.cos(a), Math.sin(a), 1.2, 0.5, PAL.dust, 0.35, 1.3, 0.4, 0.4); } } }
        acc += dt * (age < 3 ? 14 * Q.n : 0); while (acc >= 1) { acc--; motes(c, c.x, c.z, 1.6, c.R() < 0.5 ? PAL.teal : PAL.purple, 0.22, 1.5); }
      });
    },
    heal(ev, c) {
      ev.dur = 2.8; const hs = [0, 1, 2, 3].map((i) => ({ rb: mk(ev, 36, i % 2 ? ribMat(PAL.gold, PAL.mint, 0, 1.5) : ribMat(PAL.mint, PAL.gold, 0, 1.2), null), o: (i * Math.PI) / 2 })), sigil = mk(ev, 96, ribMat(PAL.mint, PAL.gold, 7, 1)); let acc = 0;
      pulse(ev, c, ribMat(PAL.mint, PAL.gold, 0, 1), 0.3, 2.6, 0, 1, 0.35); pulse(ev, c, ribMat(PAL.gold, PAL.mint, 0, 1), 0.3, 2, 0.5, 1.5, 0.3);
      ev.fx.push((age, dt) => {
        const rv = easeOut(age / 1.2), fade = 1 - sstep(2.1, 2.8, age), gy = H(c.x, c.z);
        for (const h of hs) { for (let i = 0; i < 36; i++) { const u = i / 35, a = u * TAU * 1.5 + h.o + age * 2.5 * MO.swirl, r = 1.1 * (1 - 0.3 * u); h.rb.set(i, c.x + Math.cos(a) * r, gy + 0.1 + u * 3, c.z + Math.sin(a) * r); } h.rb.commit(0.3, rv, fade); }
        gRing(sigil, c.x, c.z, 1.7, age * 0.6 * MO.swirl, 0.1, 0.12, 0); sigil.commit(0.12, 1, fade * sstep(0, 0.4, age));
        acc += dt * (age < 2.2 ? 22 * Q.n : 0); while (acc >= 1) { acc--; motes(c, c.x, c.z, 1.5, c.R() < 0.5 ? PAL.gold : PAL.mint, 0.22, 1.8); }
      });
    },
    lightning(ev, c) {
      ev.dur = 1.9; const { x, z, y, R } = c, top = c.hasLine ? [c.ax, c.ay, c.az] : [x + (R() - 0.5) * 5, y + 30, z + (R() - 0.5) * 5], bot = c.hasLine ? [c.bx, c.by, c.bz] : [x, y, z], N = 26;
      const m0 = ribMat(0xffffff, PAL.bolt, 0, 0), m1 = ribMat(PAL.purple, 0x6fb7ff, 0, 3), sides = [[1, 0], [0, 1]];
      const cores = sides.map((s) => { const r = mk(ev, N, m0, null); r.side = s; return r; }), aura = sides.map((s) => { const r = mk(ev, N, m1, null); r.side = s; return r; });
      const forks = [0, 1, 2].map(() => { const r = mk(ev, 12, m1, null); r.side = [1, 0]; return r; }), arcs = [0, 1, 2, 3].map(() => mk(ev, 18, m0)), scar = mk(ev, 48, ribMat(PAL.slate, 0x0d0a10, 0, 0, false)), arcLen = arcs.map(() => 2.4 + R() * 1.5);
      const roll = (rb, p0, p1, amp) => { for (let i = 0; i < rb.n; i++) { const u = i / (rb.n - 1), e = Math.min(1, u * 5, (1 - u) * 5) * amp; rb.set(i, lp(p0[0], p1[0], u) + (R() - 0.5) * 2 * e, lp(p0[1], p1[1], u), lp(p0[2], p1[2], u) + (R() - 0.5) * 2 * e); } };
      let last = -1, burst = false; pulse(ev, c, ribMat(PAL.purple, PAL.bolt, 0, 2), 0.3, 2.8, 0, 0.5, 0.3);
      ev.fx.push((age) => {
        const a = 1 - sstep(0.75, 1.6, age), on = a > 0.01; [...cores, ...aura, ...forks, ...arcs].forEach((rb) => (rb.mesh.visible = on));
        if (!burst) { burst = true; sparks(c, bot[0], bot[1] + 0.3, bot[2], 14, 7, PAL.bolt, 0.22, 0.7); for (let i = 0; i < qn(6); i++) { const q = c.R() * TAU; dustDir(c, bot[0], bot[2], Math.cos(q), Math.sin(q), 2.5, 0.7, PAL.dust, 0.4, 1.3, 0.4, 0.5); } }
        if (age < 0.8 && age - last > (MO.flick ? 0.055 : 0.2)) {
          last = age; roll(cores[0], top, bot, 1.4); cores[1].p.set(cores[0].p); aura.forEach((rb) => rb.p.set(cores[0].p));
          for (const f of forks) { const k = 4 + Math.floor(R() * 14) * 3 % 18, p = cores[0].p, s0 = [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]; roll(f, s0, [s0[0] + (R() - 0.5) * 9, Math.max(bot[1], s0[1] - 8 - R() * 8), s0[2] + (R() - 0.5) * 9], 0.8); }
          arcs.forEach((rb, i) => { const ang = (i / 4) * TAU + R(); for (let j = 0; j < rb.n; j++) { const u = j / (rb.n - 1), q = u * arcLen[i], o = (R() - 0.5) * 0.5 * Math.min(1, u * 4), px = bot[0] + Math.cos(ang) * q - Math.sin(ang) * o, pz = bot[2] + Math.sin(ang) * q + Math.cos(ang) * o; rb.set(j, px, H(px, pz) + 0.1, pz); } });
        }
        const fl = age < 0.8 ? (MO.flick ? 0.55 + 0.45 * R() : 0.8) : 1; cores.forEach((rb) => rb.commit(0.2, 1, a * fl)); aura.forEach((rb) => rb.commit(0.9, 1, a * fl * 0.6)); forks.forEach((rb) => rb.commit(0.14, 1, a * fl * 0.8)); arcs.forEach((rb) => rb.commit(0.14, easeOut(age / 0.2), a));
        gRing(scar, bot[0], bot[2], 1.1 + 0.5 * easeOut(age), 0, 0.05, 0.25, 3); scar.commit(0.9, 1, 0.5 * (1 - sstep(0.4, 1.9, age)));
      });
    },
    frost(ev, c) {
      ev.dur = 3.8; const R = c.R, r = c.radius ?? 3, fp = dens(flake(), r, r, 0.35), fr = mk(ev, fp.length, ribMat(PAL.ice, PAL.teal, 0, 1.2)), rim = mk(ev, 64, ribMat(PAL.teal, PAL.ice, 8, 0.8));
      const sp = Array.from({ length: 12 }, (_, i) => { const a = Math.floor(i / 2) * (TAU / 6) + (i % 2 ? 0.2 : 0), q = i % 2 ? 0.55 : 0.98; return { m: mesh(ev, G.crystal, solid(PAL.ice, PAL.deepTeal, 0.7)), x: c.x + Math.cos(a) * r * q, z: c.z + Math.sin(a) * r * q, h: (i % 2 ? 0.9 : 1.6) * (0.8 + R() * 0.5), t0: 0.5 + R() * 0.5, d: new THREE.Vector3((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize(), puffed: false }; });
      pulse(ev, c, ribMat(PAL.ice, PAL.teal, 0, 1), 0.3, r * 1.2, 0, 1.0, 0.35); let acc = 0;
      decal(ev, c, ribMat(0x9fd8e8, 0xe8fbff, 0, 0.3, false), 0.1, r * 1.0, 0.32, 0.1, 1.2, 3.8);
      ev.fx.push((age, dt) => {
        const rv = easeOut(age / 1.1), k = 1 - sstep(3.2, 3.8, age); place(fr, fp, c.x, c.z, r, r, 0, 0.1); fr.commit(0.14, rv, k);
        gRing(rim, c.x, c.z, r * 1.02, age * 0.2 * MO.swirl, 0.09, 0.03, 0); rim.commit(0.1, 1, k * sstep(0, 0.5, age));
        for (const p of sp) { const t = backOut((age - p.t0) / 0.45) * k; p.m.visible = t > 0.01; p.m.position.set(p.x, H(p.x, p.z) - 0.05, p.z); p.m.quaternion.setFromUnitVectors(UP, p.d); p.m.scale.set(0.7 * t, p.h * t, 0.7 * t); if (age > p.t0 && !p.puffed) { p.puffed = true; debris(c, p.x, p.z, 3, 2.5, 0.09, [PAL.ice, PAL.teal], 5); sparks(c, p.x, c.y + 0.4, p.z, 3, 2, PAL.ice, 0.16, 0.8); } }
        acc += dt * (age < 3 ? 16 * Q.n : 0); while (acc >= 1) { acc--; const a = R() * TAU, q = r * R(), px = c.x + Math.cos(a) * q, pz = c.z + Math.sin(a) * q; dust.emit({ x: px, y: H(px, pz) + 0.1, z: pz, vx: Math.cos(a) * 0.5, vy: 0.3, vz: Math.sin(a) * 0.5, life: 2, size: 0.9, grow: 1.2, color: PAL.ice, alpha: 0.28, drag: 1 }); if (R() < 0.5) motes(c, c.x, c.z, r, PAL.ice, 0.14, 0.5); }
      });
    },
  };
  const q2r = new THREE.Quaternion();
  const WARN = (ev, c) => { // persistent in-world starfall warning: ground rings, star, sky beacon
    ev.info = { x: c.x, z: c.z, r: c.radius, at: c.at }; const R = mulberry(hashStr(ev.key)), rr = mk(ev, 64, ribMat(PAL.ember, PAL.gold, 5, 2)), st = dens(star(5, 1, 0.4), 1, 1, 0.05, 60), sr = mk(ev, st.length, ribMat(PAL.amber, PAL.ember, 0, 1));
    const bm = [[1, 0], [0, 1]].map((s) => { const b = mk(ev, 2, ribMat(PAL.amber, PAL.gold, 0, 2), null); b.side = s; return b; }); let acc = 0;
    ev.fx.push((age, dt) => {
      const i = ev.info, left = i.at - clock, urg = 1 - clamp(left / 4), pl = MO.flick ? 0.5 + 0.5 * Math.sin(age * (4 + urg * 14)) : 0.5 + 0.5 * urg, gy = H(i.x, i.z);
      const fade = (ev.closing >= 0 ? 1 - clamp((age - (ev.closing - 0.35)) / 0.35) : 1) * sstep(0, 0.3, age);
      gRing(rr, i.x, i.z, i.r * (1 + 0.02 * pl), age * 0.5 * MO.swirl, 0.08, 0.02, age * 3); rr.commit(0.28 + 0.2 * urg, 1, fade * (0.55 + 0.45 * pl));
      place(sr, st, i.x, i.z, i.r * 0.8, i.r * 0.8, -age * (0.4 + urg) * MO.swirl, 0.1); sr.commit(0.12, 1, fade * (0.4 + 0.4 * urg));
      bm.forEach((b) => { b.set(0, i.x, gy, i.z); b.set(1, i.x, gy + 40, i.z); b.commit(0.4 + urg * 0.5, 1, fade * (0.12 + 0.2 * urg), 0); });
      acc += dt * (3 + urg * 12) * Q.n; while (acc >= 1) { acc--; const a = R() * TAU, px = i.x + Math.cos(a) * i.r, pz = i.z + Math.sin(a) * i.r; glow.emit({ x: px, y: H(px, pz) + 0.2, z: pz, vy: 1 + R() * 1.5, life: 1.2, size: 0.25, grow: -0.4, color: R() < 0.5 ? PAL.amber : PAL.gold, alpha: 0.8 }); }
    });
  };

  // ---------- public play / sync ----------
  const LINE = { sunder: 1, wall: 1 };
  function play({ spell, position, start, end, id, tick, phase, radius, flight } = {}) {
    const fn = FX[spell]; if (!fn || disposed) return false;
    const p = vec(position), a = vec(start), b = vec(end), ctr = p || (a && b ? [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2] : b || a || [0, 0, 0]);
    const key = spell === 'starfall' && id != null ? `sf:${id}` : `${spell}:${id ?? `${tick}:${ctr[0].toFixed(2)}:${ctr[2].toFixed(2)}`}`;
    if (spell === 'starfall' && phase === 'impact' && (events.has(key) || recent.has(key))) return false;
    const c = { x: ctr[0], z: ctr[2], y: H(ctr[0], ctr[2]), R: mulberry(hashStr(key)), radius, flight: clamp(flight ?? LAUNCH, 0.15, LAUNCH), hasLine: !!(a && b), tick };
    if (c.hasLine) Object.assign(c, { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
    else if (LINE[spell]) { const q = 3; Object.assign(c, { ax: c.x - q, az: c.z, bx: c.x + q, bz: c.z }); }
    else Object.assign(c, { ax: c.x, ay: c.y, az: c.z, bx: c.x, by: c.y, bz: c.z });
    c.len = Math.max(0.5, Math.hypot(c.bx - c.ax, c.bz - c.az)); c.ang = Math.atan2(c.bz - c.az, c.bx - c.ax);
    if (spell === 'starfall' && phase === 'impact') c.flight = 0.001;
    return !!startEvent(key, false, fn, c);
  }
  const warns = new Map(), launched = new Set();
  function sync(snapshot) {
    if (disposed || !snapshot) return;
    const list = snapshot.pendingStarfalls || [], tick = snapshot.tick ?? 0, seen = new Set();
    for (const s of list) {
      const key = `warn:${s.id}`, at = clock + (s.impactTick - tick) * tickSeconds, c = { x: s.x, z: s.z, radius: s.radius ?? 4, at }; seen.add(s.id);
      let ev = events.get(key); if (!ev) ev = startEvent(key, true, WARN, c); if (ev) { ev.info = { x: s.x, z: s.z, r: c.radius, at }; warns.set(s.id, { x: s.x, z: s.z, radius: c.radius }); }
      if (at - clock <= LAUNCH && !launched.has(s.id)) { launched.add(s.id); play({ spell: 'starfall', position: [s.x, 0, s.z], id: s.id, radius: c.radius, flight: at - clock }); }
    }
    for (const [id, w] of [...warns]) {
      if (seen.has(id)) continue; warns.delete(id); const ev = events.get(`warn:${id}`); if (ev) ev.closing = ev.age + 0.35;
      if (!launched.has(id)) play({ spell: 'starfall', position: [w.x, 0, w.z], id, radius: w.radius, phase: 'impact' });
      launched.delete(id);
    }
  }

  // ---------- reticle ----------
  const ret = { g: new THREE.Group(), paths: [], key: '', fade: 0, want: null, pose: null, acc: 0, def: null };
  root.add(ret.g);
  function clearRet() { for (const p of ret.paths) { ret.g.remove(p.rb.mesh); p.rb.dispose(); } ret.paths = []; }
  function buildRet(w) {
    clearRet(); const def = (ret.def = RET[w.spell]), sx = def.line ? w.len : w.rad;
    for (const [pts, width, spin, dash] of def.p()) { const d = dens(pts, sx, def.line ? 1 : w.rad); ret.paths.push({ pts: d, w: width, spin, rb: new Ribbon(d.length, ribMat(def.c[0], def.c[1], dash, 1), H), good: ribMat(def.c[0], def.c[1], dash, 1), bad: ribMat(PAL.bad, PAL.badDark, dash, 0.4) }); }
    ret.paths.forEach((p) => { p.rb.mesh.renderOrder = 4; ret.g.add(p.rb.mesh); });
  }
  function setTarget(t) {
    if (!t || !RET[t.spell]) { ret.want = null; return; }
    const def = RET[t.spell], p = vec(t.point), a = vec(t.start), b = vec(t.end), w = { spell: t.spell, valid: t.valid !== false, rad: t.radius ?? def.r ?? 3, line: !!def.line };
    if (def.line && a && b) Object.assign(w, { cx: (a[0] + b[0]) / 2, cz: (a[2] + b[2]) / 2, ang: Math.atan2(b[2] - a[2], b[0] - a[0]), len: Math.max(0.5, Math.hypot(b[0] - a[0], b[2] - a[2])) });
    else if (p) Object.assign(w, { cx: p[0], cz: p[2], ang: 0, len: def.line ? 6 : 0 });
    else { ret.want = null; return; }
    ret.want = w;
  }
  function updateReticle(dt) {
    const w = ret.want; ret.fade = clamp(ret.fade + (w ? dt * 6 : -dt * 7));
    ret.g.visible = ret.fade > 0.01 && ret.paths.length > 0 || !!w;
    if (!w) { if (ret.fade <= 0.01) ret.pose = null; if (ret.fade <= 0.01 && !ret.paths.length) return; }
    if (w) {
      const key = w.spell + (w.line ? Math.round(w.len / 2) : Math.round(w.rad * 4)); if (key !== ret.key) { ret.key = key; buildRet(w); }
      const k = ret.pose && ret.fade > 0.05 ? 1 - Math.exp(-dt * 18) : 1; ret.pose = ret.pose || {};
      for (const f of ['cx', 'cz', 'len']) ret.pose[f] = ret.pose[f] === undefined ? w[f] : lp(ret.pose[f], w[f], k);
      ret.pose.ang = w.ang; ret.pose.rad = w.rad; ret.pose.line = w.line; ret.pose.valid = w.valid;
    }
    const s = ret.pose; if (!s) return;
    const pulseS = 1 + 0.03 * Math.sin(clock * 3) * MO.flick, sx = s.line ? s.len : s.rad * pulseS, sz = s.line ? 1 : s.rad * pulseS, a = ret.fade * (s.valid ? 0.9 + 0.1 * Math.sin(clock * 5) * MO.flick : 0.55);
    for (const p of ret.paths) { p.rb.mesh.material = s.valid ? p.good : p.bad; place(p.rb, p.pts, s.cx, s.cz, sx, sz, s.ang + p.spin * clock * MO.swirl, 0.08); p.rb.commit(p.w, 1, a); }
    ret.acc += w ? dt * 6 * Q.n : 0;
    while (ret.acc >= 1) { ret.acc--; const d = ret.def, ang = Math.random() * TAU, q = d.line ? 0 : s.rad * (0.7 + 0.3 * Math.random()); const px = s.cx + (d.line ? (Math.random() - 0.5) * s.len * Math.cos(s.ang) : Math.cos(ang) * q), pz = s.cz + (d.line ? (Math.random() - 0.5) * s.len * Math.sin(s.ang) : Math.sin(ang) * q); glow.emit({ x: px, y: H(px, pz) + 0.15, z: pz, vy: 0.5 + Math.random() * 0.6, life: 1.2, size: 0.18, grow: -0.4, color: s.valid ? d.c[Math.random() < 0.6 ? 0 : 1] : PAL.bad, alpha: 0.7 }); }
  }

  function update(nowMs, dt) {
    if (disposed) return; dt = clamp(dt || 0, 0, 0.1); clock += dt; TIME.value = ((nowMs || 0) / 1000) % 1000;
    for (const ev of events.values()) { ev.age += dt; for (const f of ev.fx) f(ev.age, dt); if ((!ev.persist && ev.age >= ev.dur) || (ev.closing >= 0 && ev.age >= ev.closing)) kill(ev.key); }
    for (const [k, t] of recent) if (t < clock) recent.delete(k);
    updateReticle(dt); pools.forEach((p) => p.update(dt)); kins.forEach((p) => { p.flush(); p.mesh.visible = p.live() > 0; });
  }
  function configure({ quality: q, reducedMotion: rm } = {}) { // optional live settings; events already running keep their spawned counts
    if (q !== undefined && QUALITY[q]) { Q = QUALITY[q]; qName = q; }
    if (rm !== undefined) { RM = !!rm; MO = M(); }
  }
  function stats() {
    const live = { dust: dust.live(), glow: glow.live(), shards: shards.live(), leaves: leaves.live() };
    let draws = 0; root.traverseVisible((o) => { if (o.isMesh || o.isPoints) draws++; });
    return { events: events.size, maxEvents: MAX_EVENTS, warnings: warns.size, ribbons: [...events.values()].reduce((n, e) => n + e.rib.length, 0) + ret.paths.length, particles: { ...live, total: live.dust + live.glow + live.shards + live.leaves, budget: 512 }, pooledMaterials: cache.size, reticle: !!ret.want, recent: recent.size,
      kinematic: { slabs: slabs.live(), rocks: rocks.live(), budget: KCAPS.slab + KCAPS.rock }, draws, quality: qName, reducedMotion: RM };
  }
  function dispose() {
    if (disposed) return; disposed = true; for (const k of [...events.keys()]) kill(k); clearRet(); pools.forEach((p) => p.dispose()); kins.forEach((p) => p.dispose()); shards.mesh.material.dispose(); leaves.mesh.material.dispose(); kinMat.dispose();
    Object.values(G).forEach((g) => g.dispose()); cache.forEach((m) => m.dispose()); cache.clear(); tex.dispose(); scene.remove(root); events.clear(); recent.clear(); warns.clear(); launched.clear();
  }
  return { setTarget, play, update, sync, dispose, stats, prepareShaders, configure };
}
