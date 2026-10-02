// Spell presentation: ground-conforming reticles and fantasy RTS/VR spell effects.
// Y-up metres. Pooled geometry/materials, 512 particle slots, 32 event groups, 5 s effect cap.
import * as THREE from 'three';

const TAU = Math.PI * 2, MAX_EVENTS = 32, MAX_LIFE = 5, LAUNCH = 0.8;
const CAPS = { dust: 224, glow: 96, shard: 112, leaf: 80 }; // 512 particles in total
const PAL = { gold: 0xffc857, amber: 0xff8f2e, ember: 0xff4a1f, teal: 0x37e0c8, deepTeal: 0x0f7f86, purple: 0x9b6bff, violet: 0x4d2a8f,
  bone: 0xf2e8c9, earth: 0x7b5b3a, stone: 0x8d8a84, slate: 0x55525a, leaf: 0x73d96b, moss: 0x2f7a3e, ice: 0xc4f1ff, mint: 0x9ff7c8,
  bolt: 0xcfeaff, bad: 0xd24a4a, badDark: 0x6b2a2a, dust: 0xc9b48f };
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), QI = new THREE.Quaternion(), V = new THREE.Vector3();
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
class Ribbon {
  constructor(n, mat, gh) {
    this.n = n; this.gh = gh; this.side = null; this.p = new Float32Array(n * 3);
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.at = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const ix = []; for (let i = 0; i < n - 1; i++) { const k = i * 2; ix.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    g.setAttribute('position', this.pos); g.setAttribute('a', this.at); g.setIndex(ix);
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  set(i, x, y, z) { const p = this.p; p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; }
  commit(width, reveal = 1, fade = 1, taper = 1) {
    const { n, p, pos, at, side, gh } = this;
    for (let i = 0; i < n; i++) {
      const a = Math.max(i - 1, 0) * 3, b = Math.min(i + 1, n - 1) * 3; let sx, sz;
      if (side) [sx, sz] = side;
      else { sx = -(p[b + 2] - p[a + 2]); sz = p[b] - p[a]; const l = Math.hypot(sx, sz); if (l < 1e-5) { sx = 1; sz = 0; } else { sx /= l; sz /= l; } }
      const u = i / (n - 1), w = width * 0.5 * (taper ? 0.25 + 0.75 * Math.sin(Math.PI * u) : 1), al = fade * clamp((reveal * 1.1 - u) * 10);
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
    Object.assign(s, { live: true, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.5, grow: 1, alpha: 0.5, grav: 0, drag: 1 }, p);
    this.c.set(p.color ?? 0xffffff); this.C.setXYZ(i, this.c.r, this.c.g, this.c.b); this.C.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const s = this.s[i]; if (!s.live) continue; any = true; s.age += dt; const u = s.age / s.life;
      if (u >= 1) { s.live = false; this.A.setXY(i, 0, 0); continue; }
      const k = Math.exp(-s.drag * dt); s.vy -= s.grav * dt; s.vx *= k; s.vz *= k; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      this.P.setXYZ(i, s.x, s.y, s.z); this.A.setXY(i, s.size * (1 + s.grow * u), s.alpha * sstep(0, 0.1, u) * (1 - sstep(0.4, 1, u)));
    }
    if (any) this.P.needsUpdate = this.A.needsUpdate = true;
  }
  live() { return this.s.reduce((n, s) => n + (s.live ? 1 : 0), 0); }
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
    const i = this.n, s = this.s[i]; this.n = (i + 1) % this.cap;
    Object.assign(s, { live: true, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.2, sy: 1, grav: 9, drag: 0, spin: 4, settle: true, orb: null }, p);
    s.ax.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); s.q.setFromAxisAngle(s.ax, Math.random() * TAU);
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
  dispose() { this.mesh.dispose(); }
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

export function createSpellPresentation({ scene, height, pointScale = 720, tickSeconds = 0.05 }) {
  const H = (x, z) => { const h = height ? height(x, z) : 0; return Number.isFinite(h) ? h : 0; };
  const root = new THREE.Group(); root.name = 'SpellPresentation'; scene.add(root);
  const TIME = { value: 0 }; let clock = 0, disposed = false;
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
  const leafShape = new THREE.Shape(); leafShape.moveTo(0, -0.5); leafShape.quadraticCurveTo(0.5, -0.1, 0, 0.5); leafShape.quadraticCurveTo(-0.5, -0.1, 0, -0.5);
  const G = {
    bone: new THREE.CylinderGeometry(0.045, 0.07, 1, 6), slab: new THREE.BoxGeometry(1, 1, 1), rock: new THREE.DodecahedronGeometry(1, 0), core,
    crystal: new THREE.LatheGeometry([[0, 0], [0.26, 0], [0.2, 0.72], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 6),
    disc: new THREE.RingGeometry(0.2, 1, 40).rotateX(-Math.PI / 2), flame: new THREE.ConeGeometry(0.55, 3.2, 8, 1, true).translate(0, 1.6, 0),
    shard: new THREE.OctahedronGeometry(1, 0).scale(0.35, 1, 0.35), leaf: new THREE.ShapeGeometry(leafShape).scale(0.35, 0.35, 1),
  };
  const tex = softTexture();
  const dust = new PointPool(CAPS.dust, false, tex, pointScale), glow = new PointPool(CAPS.glow, true, tex, pointScale);
  const shards = new InstPool(G.shard, new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true, emissive: 0x201814 }), CAPS.shard, H);
  const leaves = new InstPool(G.leaf, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, emissive: 0x10240c }), CAPS.leaf, H);
  const pools = [dust, glow, shards, leaves]; root.add(dust.obj, glow.obj, shards.mesh, leaves.mesh);
  async function prepareShaders(renderer, camera, targetScene) {
    // Representatives share the real cached materials. This group is never
    // attached/rendered and never emits a spell or modifies authoritative state.
    const preview = new THREE.Group();
    const ribbon = new Ribbon(2, ribMat(PAL.amber, PAL.gold), H);
    preview.add(ribbon.mesh, new THREE.Mesh(G.core, solid(0x3a2a24, PAL.ember, 1.2)),
      new THREE.Mesh(G.disc, glowMat(PAL.amber)));
    root.traverse(node => { if (node.isMesh || node.isPoints) preview.add(node.clone(false)); });
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
  const puff = (c, x, z, n, spd, sz, col, al = 0.5, life = 1.5) => { for (let i = 0; i < n; i++) { const a = c.R() * TAU, s = spd * (0.35 + c.R()); dust.emit({ x, y: H(x, z) + 0.15, z, vx: Math.cos(a) * s, vy: 0.4 + c.R() * 1.4, vz: Math.sin(a) * s, life: life * (0.7 + c.R() * 0.6), size: sz * (0.6 + c.R()), grow: 1.6, color: col, alpha: al, grav: -0.3, drag: 1.8 }); } };
  const debris = (c, x, z, n, spd, sz, cols, up = 5) => { for (let i = 0; i < n; i++) { const a = c.R() * TAU, s = spd * (0.3 + c.R()); shards.emit({ x, y: H(x, z) + 0.1, z, vx: Math.cos(a) * s, vy: up * (0.5 + c.R()), vz: Math.sin(a) * s, life: 2 + c.R() * 1.2, size: sz * (0.6 + c.R() * 0.9), sy: 1 + c.R() * 1.5, color: cols[i % cols.length], grav: 14, drag: 0.3 }); } };
  const sparks = (c, x, y, z, n, spd, col, sz = 0.2, life = 1) => { for (let i = 0; i < n; i++) { const a = c.R() * TAU, s = spd * c.R(); glow.emit({ x, y, z, vx: Math.cos(a) * s, vy: spd * (0.2 + c.R()), vz: Math.sin(a) * s, life: life * (0.6 + c.R() * 0.8), size: sz * (0.5 + c.R()), grow: -0.4, color: col, alpha: 0.9, grav: 4, drag: 1 }); } };
  const motes = (c, x, z, r, col, sz = 0.2, rise = 1.2) => { const a = c.R() * TAU, q = r * c.R(), px = x + Math.cos(a) * q, pz = z + Math.sin(a) * q; glow.emit({ x: px, y: H(px, pz) + 0.2, z: pz, vy: rise * (0.6 + c.R()), life: 1.4, size: sz, grow: -0.3, color: col, alpha: 0.8, drag: 0.5 }); };

  // ---------- events ----------
  const events = new Map(), recent = new Map();
  const mk = (ev, n, mat, gh = H) => { const r = new Ribbon(n, mat, gh); ev.g.add(r.mesh); ev.rib.push(r); return r; };
  const mesh = (ev, geo, mat) => { const m = new THREE.Mesh(geo, mat); ev.g.add(m); return m; };
  const own = (ev, geo, col) => { const mat = glowMat(col).clone(); ev.own.push(mat); return mesh(ev, geo, mat); };
  function kill(key) { const ev = events.get(key); if (!ev) return; root.remove(ev.g); ev.rib.forEach((r) => r.dispose()); ev.own.forEach((m) => m.dispose()); events.delete(key); }
  function startEvent(key, persist, build, c) {
    if (disposed || events.has(key) || recent.has(key)) return null;
    if (events.size >= MAX_EVENTS) kill(events.keys().next().value);
    const ev = { key, age: 0, dur: 2, g: new THREE.Group(), rib: [], own: [], fx: [], persist, closing: -1 }; root.add(ev.g); events.set(key, ev);
    build(ev, c); ev.dur = Math.min(ev.dur, MAX_LIFE); if (!persist) recent.set(key, clock + ev.dur + 8); return ev;
  }
  const pulse = (ev, c, mat, r0, r1, t0, t1, w = 0.4, x = c.x, z = c.z) => { // expanding/contracting ground ring
    const rb = mk(ev, 56, mat);
    ev.fx.push((age) => { const u = (age - t0) / (t1 - t0); rb.mesh.visible = u >= 0 && u <= 1; if (!rb.mesh.visible) return; gRing(rb, x, z, lp(r0, r1, easeOut(u)), age, 0.08, 0.04, age * 5); rb.commit(w * (1 - 0.5 * u), 1, 1 - u); });
  };
  const amberM = () => ribMat(PAL.amber, PAL.gold, 0, 1.5), purpleM = () => ribMat(PAL.purple, PAL.teal, 0, 1), tealM = () => ribMat(PAL.teal, PAL.purple, 0, 1), greenM = () => ribMat(PAL.leaf, PAL.gold, 0, 1);

  const summon = (ev, c, x, z, sc, t0) => { // bone/rock helix with ribs thrusting from the ground
    const R = c.R, hx = mk(ev, 44, ribMat(PAL.bone, PAL.purple, 0, 1.4), null), bones = []; let acc = 0, burst = false;
    for (let i = 0; i < 6; i++) bones.push({ m: mesh(ev, G.bone, solid(PAL.bone, PAL.violet, 0.35)), a: (i / 6) * TAU + R() * 0.4 });
    pulse(ev, c, purpleM(), 0.3 * sc, 1.6 * sc, t0, t0 + 0.9, 0.35 * sc, x, z);
    ev.fx.push((age, dt) => {
      const t = age - t0, on = t >= 0 && t < 1.9; hx.mesh.visible = on; bones.forEach((b) => (b.m.visible = on)); if (!on) return;
      if (!burst) { burst = true; puff(c, x, z, 10, 2.2 * sc, 0.9 * sc, PAL.dust); debris(c, x, z, 8, 3.5 * sc, 0.12 * sc, [PAL.bone, PAL.slate], 4); }
      const grow = sstep(0, 0.7, t), fade = 1 - sstep(1.4, 1.9, t), gy = H(x, z);
      for (let i = 0; i < 44; i++) { const u = i / 43, a = u * TAU * 2.2 + age * 3, r = (0.95 - 0.5 * u) * sc; hx.set(i, x + Math.cos(a) * r, gy + 0.1 + u * 2.3 * sc * grow, z + Math.sin(a) * r); }
      hx.commit(0.16 * sc, grow, fade);
      for (const b of bones) {
        const len = (0.9 + 0.4 * Math.sin(b.a * 3)) * sc * backOut(t / 0.8) * (1 - sstep(1.4, 1.9, t)), bx = x + Math.cos(b.a) * 0.95 * sc, bz = z + Math.sin(b.a) * 0.95 * sc;
        V.set(-Math.cos(b.a) * 0.45, 1, -Math.sin(b.a) * 0.45).normalize();
        b.m.position.set(bx, H(bx, bz) - 0.05, bz).addScaledVector(V, len / 2); b.m.quaternion.setFromUnitVectors(UP, V); b.m.scale.set(sc, Math.max(len, 0.001), sc);
      }
      acc += dt * (t < 1.2 ? 18 : 0);
      while (acc >= 1) { acc--; shards.emit({ orb: { cx: x, cz: z, a: R() * TAU, r: 1.1 * sc, w: 3.2, dr: -0.35 * sc }, y: gy + 0.1, vy: 1.1 + R(), grav: 0, life: 1, size: 0.07 * sc, color: R() < 0.5 ? PAL.bone : PAL.purple, spin: 7, settle: false }); }
    });
  };
  const roots = (ev, c, n, radius, t1) => { // ground roots spiralling outward
    const R = c.R, list = Array.from({ length: n }, (_, k) => ({ rb: mk(ev, 30, greenM()), a0: (k / n) * TAU + R() * 0.3, dir: k % 2 ? -1 : 1, len: 0.8 + R() * 0.2, w: 0.14 + R() * 0.1 }));
    ev.fx.push((age) => { const rv = easeOut(age / t1), fade = 1 - sstep(ev.dur - 0.8, ev.dur, age); for (const p of list) { for (let i = 0; i < 30; i++) { const u = i / 29, a = p.a0 + p.dir * 1.3 * u + Math.sin(u * 9 + p.a0) * 0.12, r = radius * p.len * u, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; p.rb.set(i, x, H(x, z) + 0.1, z); } p.rb.commit(p.w, rv, fade); } });
  };
  const leafSwirl = (ev, c, r0, r1, w, until, rate) => { let acc = 0; ev.fx.push((age, dt) => { if (age > until) return; acc += dt * rate; while (acc >= 1) { acc--; leaves.emit({ orb: { cx: c.x, cz: c.z, a: c.R() * TAU, r: lp(r0, r1, c.R()), w, dr: 0.25 }, y: c.y + 0.2, vy: 0.9 + c.R(), grav: 0, life: 1.9, size: 0.3, color: c.R() < 0.3 ? PAL.gold : c.R() < 0.6 ? PAL.leaf : PAL.moss, spin: 3, settle: false }); } if (c.R() < dt * 8) motes(c, c.x, c.z, r1, PAL.gold, 0.18); }); };
  const chunks = (ev, c, n, r0, r1, dir) => { // raise (dir 1) / lower (dir -1) earth chunks
    const R = c.R, list = Array.from({ length: n }, () => ({ m: mesh(ev, G.rock, solid(R() < 0.5 ? PAL.earth : PAL.stone, PAL.amber, 0.1)), a: R() * TAU, r: lp(r0, r1, R()), s: 0.22 + R() * 0.3, d: R() * 0.35, h: 0.4 + R() * 0.7, rot: R() * 4 }));
    ev.fx.push((age) => { for (const p of list) { const t = age - p.d, up = dir > 0 ? backOut(t / 0.55) * (1 - sstep(1.8, 2.4, age)) : 1 - sstep(p.d, p.d + 0.9, age), x = c.x + Math.cos(p.a) * p.r, z = c.z + Math.sin(p.a) * p.r; p.m.visible = t > 0 && up > 0.01; p.m.position.set(x, H(x, z) + (dir > 0 ? p.h * up * 0.5 + Math.sin(age * 2 + p.rot) * 0.04 : 0.3 - (1 - up) * 1.2), z); p.m.rotation.set(p.rot + age * 0.4 * dir, p.rot * 2, 0); p.m.scale.set(p.s * (dir > 0 ? up : 1), p.s * 0.8, p.s); } });
  };

  const FX = {
    skeleton(ev, c) { ev.dur = 2.3; summon(ev, c, c.x, c.z, 1, 0); },
    squad(ev, c) { ev.dur = 2.7; for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; summon(ev, c, c.x + Math.cos(a) * 1.7, c.z + Math.sin(a) * 1.7, 0.75, i * 0.25); } pulse(ev, c, ribMat(PAL.gold, PAL.purple, 0, 1), 0.5, 3.2, 0, 1, 0.3); },
    golem(ev, c) {
      ev.dur = 3.2; const { x, z, R } = c, gy = c.y, ring = mk(ev, 64, ribMat(PAL.gold, PAL.ember, 0, 1.5));
      const parts = [[-0.36, 0, 0.42, 0.9, 0.46], [0.36, 0, 0.42, 0.9, 0.46], [0, 0.9, 1.2, 1, 0.7], [0, 1.95, 0.52, 0.46, 0.5], [-0.88, 0.95, 0.36, 0.95, 0.42], [0.88, 0.95, 0.36, 0.95, 0.42]].map(([px, py, w, h, d], i) => {
        const a = R() * TAU, r = 2.2 + R(); return { m: mesh(ev, i === 3 ? G.rock : G.slab, solid(i === 3 ? PAL.earth : PAL.stone, PAL.amber, 0.12)), px, py, w, h, d, sx: x + Math.cos(a) * r, sz: z + Math.sin(a) * r, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)), t0: 0.15 + i * 0.17, landed: false };
      });
      pulse(ev, c, ribMat(PAL.gold, PAL.amber, 0, 1.2), 0.5, 3, 0, 1.1, 0.4); pulse(ev, c, ribMat(PAL.amber, PAL.ember, 0, 1), 0.5, 2.2, 1.6, 2.5, 0.35);
      ev.fx.push((age) => {
        const k = 1 - sstep(2.4, 3, age); gRing(ring, x, z, 1.5 + 0.3 * Math.sin(age * 2), age, 0.1, 0.14, age * 3); ring.commit(0.2, easeOut(age / 0.8), k * sstep(0, 0.3, age));
        for (const p of parts) {
          const u = clamp((age - p.t0) / 0.9), e = easeOut(u), fx = x + p.px, fy = gy + p.py + p.h / 2;
          p.m.visible = u > 0 && k > 0.01; if (!p.m.visible) continue;
          p.m.position.set(lp(p.sx, fx, e), lp(H(p.sx, p.sz) - 0.4, fy, e) + Math.sin(u * Math.PI) * 1.4, lp(p.sz, z, e)); p.m.quaternion.slerpQuaternions(p.q, QI, e); p.m.scale.set(p.w * k, p.h * k, p.d * k);
          if (u >= 1 && !p.landed) { p.landed = true; puff(c, fx, z, 4, 1.8, 0.7, PAL.dust, 0.45); debris(c, fx, z, 2, 2, 0.1, [PAL.stone], 3); }
        }
        if (age > 2.4 && age < 3) puff(c, x + (R() - 0.5) * 1.5, z, 1, 1.5, 1, PAL.dust, 0.4);
      });
    },
    raise(ev, c) { ev.dur = 2.4; pulse(ev, c, amberM(), 0.3, 2.6, 0, 0.8, 0.45); pulse(ev, c, ribMat(PAL.gold, PAL.earth, 0, 1), 0.3, 1.8, 0.2, 1.0, 0.3); chunks(ev, c, 9, 0.2, 1.8, 1); puff(c, c.x, c.z, 18, 3, 1, PAL.dust, 0.55); debris(c, c.x, c.z, 14, 4, 0.16, [PAL.earth, PAL.stone, PAL.gold], 8); },
    lower(ev, c) {
      ev.dur = 2.4; pulse(ev, c, purpleM(), 2.8, 0.3, 0, 0.9, 0.4); pulse(ev, c, tealM(), 2.2, 0.2, 0.4, 1.3, 0.3); chunks(ev, c, 9, 0.2, 1.8, -1); puff(c, c.x, c.z, 14, 2.2, 1, PAL.dust, 0.5);
      for (let i = 0; i < 16; i++) shards.emit({ orb: { cx: c.x, cz: c.z, a: c.R() * TAU, r: 1.2 + c.R() * 1.2, w: 1.2, dr: -1.1 }, y: c.y + 0.4 + c.R() * 0.6, vy: -0.4, grav: 0, life: 1.4, size: 0.12, color: i % 2 ? PAL.purple : PAL.earth, settle: false });
    },
    sunder(ev, c) {
      ev.dur = 3.2; const { ax, az, bx, bz, len, ang, R } = c, n = Math.min(110, Math.max(24, Math.ceil(len / 0.45))), jit = Float32Array.from({ length: n }, () => R() * 2 - 1);
      const nx = -Math.sin(ang), nz = Math.cos(ang), np = Math.min(14, Math.max(4, Math.ceil(len / 1.1))), pl = [];
      const dark = mk(ev, n, ribMat(PAL.slate, 0x120d16, 0, 0, false)), heat = mk(ev, n, ribMat(PAL.ember, PAL.gold, 0, 2.2)); dark.mesh.renderOrder = 1; let acc = 0;
      for (const s of [-1, 1]) for (let k = 0; k < np; k++) { const m = mesh(ev, G.slab, solid([PAL.earth, PAL.stone, 0x6b5a49, PAL.slate][(k + (s > 0 ? 1 : 0)) % 4], PAL.ember, 0.08)); m.rotation.order = 'YXZ'; pl.push({ s, u: (k + 0.5) / np, m, w: 0.35 + R() * 0.5, tilt: 0.35 + R() * 0.45 }); }
      ev.fx.push((age, dt) => {
        const rv = easeOut(age / 1.2), fade = 1 - sstep(2.3, 3.2, age), hp = 0.75 + 0.25 * Math.sin(age * 9);
        for (const rb of [dark, heat]) for (let i = 0; i < n; i++) { const u = i / (n - 1), o = jit[i] * 0.38 * Math.min(1, u * 6, (1 - u) * 6), x = lp(ax, bx, u) + nx * o, z = lp(az, bz, u) + nz * o; rb.set(i, x, H(x, z) + 0.1, z); }
        dark.commit(0.9 + 0.5 * rv, rv, fade * 0.85); heat.commit(0.28 + 0.2 * hp, rv, fade * hp * (1 - sstep(1.2, 2.6, age) * 0.6));
        for (const p of pl) {
          const r = clamp((rv * 1.05 - p.u) * 7), k = r * fade; p.m.visible = k > 0.01; if (!p.m.visible) continue;
          const x = lp(ax, bx, p.u) + nx * p.s * (0.55 + p.w * 0.3), z = lp(az, bz, p.u) + nz * p.s * (0.55 + p.w * 0.3), h = (0.5 + p.w) * k;
          p.m.rotation.set(p.tilt * p.s * r, -ang, 0); p.m.scale.set((len / np) * 0.95, h, p.w); p.m.position.set(x, H(x, z) + h * 0.35, z);
        }
        acc += dt * (age < 1.3 ? 26 : 0);
        while (acc >= 1) { acc--; const u = Math.min(1, rv), x = lp(ax, bx, u), z = lp(az, bz, u); puff(c, x, z, 1, 1.5, 0.7, PAL.dust, 0.5, 1.6); if (R() < 0.5) debris(c, x, z, 1, 3, 0.12, [PAL.stone, PAL.earth], 5); }
      });
    },
    wall(ev, c) {
      ev.dur = 3.4; const { ax, az, bx, bz, len, ang, R } = c, N = Math.max(3, Math.ceil(len / 1.3)), segL = len / N;
      const pl = Array.from({ length: N }, (_, k) => { const u = (k + 0.5) / N; return { m: mesh(ev, G.slab, solid(k % 2 ? PAL.stone : 0x9a968c, PAL.gold, 0.08)), x: lp(ax, bx, u), z: lp(az, bz, u), h: 1.7 + R() * 0.7, t0: 0.12 + u, puffed: false }; });
      const trim = mk(ev, Math.min(100, Math.ceil(len / 0.5) + 2), ribMat(PAL.gold, PAL.amber, 6, 1.2));
      ev.fx.push((age) => {
        const sink = 1 - sstep(2.7, 3.4, age); gLine(trim, ax, az, bx, bz, 0.12); trim.commit(0.35, sstep(0, 1.1, age), sink * (0.75 + 0.25 * Math.sin(age * 8)));
        for (const p of pl) {
          const t = age - p.t0, rise = backOut(t / 0.55) * sink; p.m.visible = t > 0 && rise > 0.01; if (!p.m.visible) continue;
          p.m.rotation.set(0, -ang, 0); p.m.scale.set(segL * 0.96, p.h * rise, 0.55); p.m.position.set(p.x, H(p.x, p.z) + (p.h * rise) / 2 - 0.1, p.z);
          if (!p.puffed) { p.puffed = true; puff(c, p.x, p.z, 5, 1.6, 0.6, PAL.dust, 0.45); debris(c, p.x, p.z, 3, 2.5, 0.1, [PAL.stone], 4); }
        }
      });
    },
    grove(ev, c) { ev.dur = 3.4; const r = c.radius ?? 3.5; pulse(ev, c, greenM(), 0.3, r, 0, 1, 0.4); roots(ev, c, 7, r, 1.2); leafSwirl(ev, c, 0.5, r, 2.2, 2.2, 20); puff(c, c.x, c.z, 8, 1.8, 0.8, PAL.dust, 0.35); },
    ring(ev, c) {
      ev.dur = 3.4; const r = c.radius ?? 4, R = c.R, band = [0, 1].map((i) => mk(ev, 72, i ? ribMat(PAL.leaf, PAL.gold, 0, 1) : tealM())), N = 12;
      const st = Array.from({ length: N }, (_, k) => ({ m: mesh(ev, G.rock, solid(PAL.stone, PAL.deepTeal, 0.3)), a: (k / N) * TAU, h: 0.9 + R() * 0.7, t0: 0.2 + (k / N) * 0.7 }));
      ev.fx.push((age) => {
        const rv = easeOut(age / 1.1), fade = 1 - sstep(2.6, 3.4, age); band.forEach((rb, i) => { gRing(rb, c.x, c.z, r * (1 - i * 0.08), age * (i ? -0.4 : 0.4), 0.1, 0.06, age * 3 + i); rb.commit(0.3 - i * 0.08, rv, fade); });
        for (const s of st) { const t = backOut((age - s.t0) / 0.6) * fade, x = c.x + Math.cos(s.a) * r, z = c.z + Math.sin(s.a) * r; s.m.visible = t > 0.01; s.m.position.set(x, H(x, z) + s.h * t * 0.45, z); s.m.scale.set(0.3, s.h * t * 0.6, 0.3); s.m.rotation.y = s.a; }
      });
      roots(ev, c, 6, r, 1.2); leafSwirl(ev, c, r * 0.85, r * 1.05, 1.4, 2.4, 18); pulse(ev, c, tealM(), 0.5, r * 1.1, 0, 1, 0.35);
    },
    starfall(ev, c) {
      const { x, z, R } = c, gy = c.y, fl = c.flight ?? LAUNCH, r = c.radius ?? 4; ev.dur = fl + 2.6;
      const da = R() * TAU, S = new THREE.Vector3(x + Math.cos(da) * 10, gy + 36, z + Math.sin(da) * 10), T = new THREE.Vector3(x, gy + 0.4, z);
      const back = S.clone().sub(T).normalize(), grp = new THREE.Group(); ev.g.add(grp); grp.quaternion.setFromUnitVectors(UP, back);
      const rock = new THREE.Mesh(G.core, solid(0x3a2a24, PAL.ember, 1.2)); grp.add(rock);
      const f1 = own(ev, G.flame, PAL.amber), f2 = own(ev, G.flame, PAL.gold); f2.scale.setScalar(0.55); grp.add(f1, f2);
      const hist = Array.from({ length: 22 }, () => S.clone()), tr = [mk(ev, 22, ribMat(PAL.amber, PAL.ember, 0, 2), null), mk(ev, 22, ribMat(PAL.gold, PAL.amber, 0, 2), null)]; tr[1].side = [Math.cos(da), Math.sin(da)];
      const flash = own(ev, G.disc, PAL.gold), crater = mk(ev, 72, ribMat(PAL.ember, PAL.gold, 0, 1.4)), cpts = dens(star(9, 1, 0.45), r, r, 0.4);
      const cr2 = mk(ev, cpts.length, ribMat(PAL.ember, PAL.gold, 0, 1.4)); ev.g.remove(crater.mesh); ev.rib.splice(ev.rib.indexOf(crater), 1).forEach((q) => q.dispose());
      pulse(ev, c, amberM(), 0.5, r * 1.7, fl, fl + 0.9, 0.8); pulse(ev, c, ribMat(PAL.gold, PAL.amber, 0, 1), 0.3, r * 1.1, fl + 0.1, fl + 0.8, 0.4);
      flash.visible = false; let hit = false, acc = 0;
      ev.fx.push((age, dt) => {
        if (age < fl) {
          const e = Math.pow(age / fl, 1.4); V.copy(S).lerp(T, e); grp.position.copy(V); const last = hist.pop(); last.copy(V); hist.unshift(last); rock.rotation.x += dt * 6;
          for (const rb of tr) { hist.forEach((h, i) => rb.set(i, h.x, h.y, h.z)); rb.commit(1.1, 1, 1, 1); }
          acc += dt * 40; while (acc >= 1) { acc--; sparks(c, V.x, V.y, V.z, 1, 2, PAL.amber, 0.3, 0.6); }
          return;
        }
        const u = (age - fl) / 2.4;
        if (!hit) { hit = true; grp.visible = false; tr.forEach((rb) => (rb.mesh.visible = false)); flash.visible = true; puff(c, x, z, 26, 6, 1.6, PAL.dust, 0.6, 2.2); debris(c, x, z, 30, 9, 0.2, [PAL.stone, PAL.earth, PAL.ember], 11); sparks(c, x, gy + 0.5, z, 24, 10, PAL.amber, 0.3, 1.2); }
        flash.position.set(x, gy + 0.2, z); flash.scale.setScalar(r * (0.3 + 1.4 * easeOut(u * 2))); flash.material.opacity = 0.9 * (1 - clamp(u * 2));
        place(cr2, cpts, x, z, r * (0.6 + 0.4 * easeOut(u * 3)), r * (0.6 + 0.4 * easeOut(u * 3)), age * 0.1, 0.1); cr2.commit(0.35, easeOut(u * 3), 1 - sstep(0.5, 1, u));
      });
    },
    crystal(ev, c) {
      ev.dur = 3.6; const R = c.R, list = Array.from({ length: 7 }, (_, i) => {
        const a = R() * TAU, r = i ? 0.5 + R() * 0.9 : 0, k = i % 2; return { m: mesh(ev, G.crystal, solid(k ? 0x8f6bff : 0x2fd9c4, k ? 0x4d2a8f : 0x127f78, 0.9)), x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, h: i ? 1.1 + R() * 1.2 : 2.8, w: i ? 0.9 : 1.4, t0: i * 0.07, d: new THREE.Vector3(Math.cos(a) * 0.3 * (i ? 1 : 0), 1, Math.sin(a) * 0.3 * (i ? 1 : 0)).normalize(), puffed: false };
      });
      pulse(ev, c, tealM(), 0.3, 2.6, 0, 0.9, 0.35); pulse(ev, c, ribMat(PAL.purple, PAL.teal, 6, 1), 0.3, 1.8, 0.3, 1.4, 0.25); let acc = 0;
      ev.fx.push((age, dt) => {
        const k = 1 - sstep(3, 3.6, age);
        for (const p of list) { const t = backOut((age - p.t0) / 0.5) * k; p.m.visible = t > 0.01; p.m.position.set(p.x, H(p.x, p.z) - 0.05, p.z); p.m.quaternion.setFromUnitVectors(UP, p.d); p.m.scale.set(p.w * t, p.h * t, p.w * t); if (age > p.t0 && !p.puffed) { p.puffed = true; debris(c, p.x, p.z, 3, 3, 0.1, [PAL.teal, PAL.purple, PAL.ice], 6); puff(c, p.x, p.z, 3, 1.2, 0.5, PAL.dust, 0.35); } }
        acc += dt * (age < 3 ? 14 : 0); while (acc >= 1) { acc--; motes(c, c.x, c.z, 1.6, c.R() < 0.5 ? PAL.teal : PAL.purple, 0.22, 1.5); }
      });
    },
    heal(ev, c) {
      ev.dur = 2.8; const hs = [0, 1, 2, 3].map((i) => ({ rb: mk(ev, 36, i % 2 ? ribMat(PAL.gold, PAL.mint, 0, 1.5) : ribMat(PAL.mint, PAL.gold, 0, 1.2), null), o: (i * Math.PI) / 2 })), sigil = mk(ev, 96, ribMat(PAL.mint, PAL.gold, 7, 1)); let acc = 0;
      pulse(ev, c, ribMat(PAL.mint, PAL.gold, 0, 1), 0.3, 2.6, 0, 1, 0.35); pulse(ev, c, ribMat(PAL.gold, PAL.mint, 0, 1), 0.3, 2, 0.5, 1.5, 0.3);
      ev.fx.push((age, dt) => {
        const rv = easeOut(age / 1.2), fade = 1 - sstep(2.1, 2.8, age), gy = H(c.x, c.z);
        for (const h of hs) { for (let i = 0; i < 36; i++) { const u = i / 35, a = u * TAU * 1.5 + h.o + age * 2.5, r = 1.1 * (1 - 0.3 * u); h.rb.set(i, c.x + Math.cos(a) * r, gy + 0.1 + u * 3, c.z + Math.sin(a) * r); } h.rb.commit(0.3, rv, fade); }
        gRing(sigil, c.x, c.z, 1.7, age * 0.6, 0.1, 0.12, 0); sigil.commit(0.12, 1, fade * sstep(0, 0.4, age));
        acc += dt * (age < 2.2 ? 22 : 0); while (acc >= 1) { acc--; motes(c, c.x, c.z, 1.5, c.R() < 0.5 ? PAL.gold : PAL.mint, 0.22, 1.8); }
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
        if (!burst) { burst = true; sparks(c, bot[0], bot[1] + 0.3, bot[2], 14, 7, PAL.bolt, 0.22, 0.7); puff(c, bot[0], bot[2], 6, 2.5, 0.7, PAL.dust, 0.4); }
        if (age < 0.8 && age - last > 0.055) {
          last = age; roll(cores[0], top, bot, 1.4); cores[1].p.set(cores[0].p); aura.forEach((rb) => rb.p.set(cores[0].p));
          for (const f of forks) { const k = 4 + Math.floor(R() * 14) * 3 % 18, p = cores[0].p, s0 = [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]; roll(f, s0, [s0[0] + (R() - 0.5) * 9, Math.max(bot[1], s0[1] - 8 - R() * 8), s0[2] + (R() - 0.5) * 9], 0.8); }
          arcs.forEach((rb, i) => { const ang = (i / 4) * TAU + R(); for (let j = 0; j < rb.n; j++) { const u = j / (rb.n - 1), q = u * arcLen[i], o = (R() - 0.5) * 0.5 * Math.min(1, u * 4), px = bot[0] + Math.cos(ang) * q - Math.sin(ang) * o, pz = bot[2] + Math.sin(ang) * q + Math.cos(ang) * o; rb.set(j, px, H(px, pz) + 0.1, pz); } });
        }
        const fl = age < 0.8 ? 0.55 + 0.45 * R() : 1; cores.forEach((rb) => rb.commit(0.2, 1, a * fl)); aura.forEach((rb) => rb.commit(0.9, 1, a * fl * 0.6)); forks.forEach((rb) => rb.commit(0.14, 1, a * fl * 0.8)); arcs.forEach((rb) => rb.commit(0.14, easeOut(age / 0.2), a));
        gRing(scar, bot[0], bot[2], 1.1 + 0.5 * easeOut(age), 0, 0.05, 0.25, 3); scar.commit(0.9, 1, 0.5 * (1 - sstep(0.4, 1.9, age)));
      });
    },
    frost(ev, c) {
      ev.dur = 3.8; const R = c.R, r = c.radius ?? 3, fp = dens(flake(), r, r, 0.35), fr = mk(ev, fp.length, ribMat(PAL.ice, PAL.teal, 0, 1.2)), rim = mk(ev, 64, ribMat(PAL.teal, PAL.ice, 8, 0.8));
      const sp = Array.from({ length: 12 }, (_, i) => { const a = Math.floor(i / 2) * (TAU / 6) + (i % 2 ? 0.2 : 0), q = i % 2 ? 0.55 : 0.98; return { m: mesh(ev, G.crystal, solid(PAL.ice, PAL.deepTeal, 0.7)), x: c.x + Math.cos(a) * r * q, z: c.z + Math.sin(a) * r * q, h: (i % 2 ? 0.9 : 1.6) * (0.8 + R() * 0.5), t0: 0.5 + R() * 0.5, d: new THREE.Vector3((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize(), puffed: false }; });
      pulse(ev, c, ribMat(PAL.ice, PAL.teal, 0, 1), 0.3, r * 1.2, 0, 1.0, 0.35); let acc = 0;
      ev.fx.push((age, dt) => {
        const rv = easeOut(age / 1.1), k = 1 - sstep(3.2, 3.8, age); place(fr, fp, c.x, c.z, r, r, 0, 0.1); fr.commit(0.14, rv, k);
        gRing(rim, c.x, c.z, r * 1.02, age * 0.2, 0.09, 0.03, 0); rim.commit(0.1, 1, k * sstep(0, 0.5, age));
        for (const p of sp) { const t = backOut((age - p.t0) / 0.45) * k; p.m.visible = t > 0.01; p.m.position.set(p.x, H(p.x, p.z) - 0.05, p.z); p.m.quaternion.setFromUnitVectors(UP, p.d); p.m.scale.set(0.7 * t, p.h * t, 0.7 * t); if (age > p.t0 && !p.puffed) { p.puffed = true; debris(c, p.x, p.z, 3, 2.5, 0.09, [PAL.ice, PAL.teal], 5); sparks(c, p.x, c.y + 0.4, p.z, 3, 2, PAL.ice, 0.16, 0.8); } }
        acc += dt * (age < 3 ? 16 : 0); while (acc >= 1) { acc--; const a = R() * TAU, q = r * R(), px = c.x + Math.cos(a) * q, pz = c.z + Math.sin(a) * q; dust.emit({ x: px, y: H(px, pz) + 0.1, z: pz, vx: (R() - 0.5) * 0.5, vy: 0.3, vz: (R() - 0.5) * 0.5, life: 2, size: 0.9, grow: 1.2, color: PAL.ice, alpha: 0.28, drag: 1 }); if (R() < 0.5) motes(c, c.x, c.z, r, PAL.ice, 0.14, 0.5); }
      });
    },
  };
  const WARN = (ev, c) => { // persistent in-world starfall warning: ground rings, star, sky beacon
    ev.info = { x: c.x, z: c.z, r: c.radius, at: c.at }; const rr = mk(ev, 64, ribMat(PAL.ember, PAL.gold, 5, 2)), st = dens(star(5, 1, 0.4), 1, 1, 0.05, 60), sr = mk(ev, st.length, ribMat(PAL.amber, PAL.ember, 0, 1));
    const bm = [[1, 0], [0, 1]].map((s) => { const b = mk(ev, 2, ribMat(PAL.amber, PAL.gold, 0, 2), null); b.side = s; return b; }); let acc = 0;
    ev.fx.push((age, dt) => {
      const i = ev.info, left = i.at - clock, urg = 1 - clamp(left / 4), pl = 0.5 + 0.5 * Math.sin(age * (4 + urg * 14)), gy = H(i.x, i.z);
      const fade = (ev.closing >= 0 ? 1 - clamp((age - (ev.closing - 0.35)) / 0.35) : 1) * sstep(0, 0.3, age);
      gRing(rr, i.x, i.z, i.r * (1 + 0.02 * pl), age * 0.5, 0.08, 0.02, age * 3); rr.commit(0.28 + 0.2 * urg, 1, fade * (0.55 + 0.45 * pl));
      place(sr, st, i.x, i.z, i.r * 0.8, i.r * 0.8, -age * (0.4 + urg), 0.1); sr.commit(0.12, 1, fade * (0.4 + 0.4 * urg));
      bm.forEach((b) => { b.set(0, i.x, gy, i.z); b.set(1, i.x, gy + 40, i.z); b.commit(0.4 + urg * 0.5, 1, fade * (0.12 + 0.2 * urg), 0); });
      acc += dt * (3 + urg * 12); while (acc >= 1) { acc--; const a = Math.random() * TAU, px = i.x + Math.cos(a) * i.r, pz = i.z + Math.sin(a) * i.r; glow.emit({ x: px, y: H(px, pz) + 0.2, z: pz, vy: 1 + Math.random() * 1.5, life: 1.2, size: 0.25, grow: -0.4, color: Math.random() < 0.5 ? PAL.amber : PAL.gold, alpha: 0.8 }); }
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
    const pulseS = 1 + 0.03 * Math.sin(clock * 3), sx = s.line ? s.len : s.rad * pulseS, sz = s.line ? 1 : s.rad * pulseS, a = ret.fade * (s.valid ? 0.9 + 0.1 * Math.sin(clock * 5) : 0.55);
    for (const p of ret.paths) { p.rb.mesh.material = s.valid ? p.good : p.bad; place(p.rb, p.pts, s.cx, s.cz, sx, sz, s.ang + p.spin * clock, 0.08); p.rb.commit(p.w, 1, a); }
    ret.acc += w ? dt * 6 : 0;
    while (ret.acc >= 1) { ret.acc--; const c = { R: Math.random }, d = ret.def, ang = Math.random() * TAU, q = d.line ? 0 : s.rad * (0.7 + 0.3 * Math.random()); const px = s.cx + (d.line ? (Math.random() - 0.5) * s.len * Math.cos(s.ang) : Math.cos(ang) * q), pz = s.cz + (d.line ? (Math.random() - 0.5) * s.len * Math.sin(s.ang) : Math.sin(ang) * q); glow.emit({ x: px, y: H(px, pz) + 0.15, z: pz, vy: 0.5 + Math.random() * 0.6, life: 1.2, size: 0.18, grow: -0.4, color: s.valid ? d.c[Math.random() < 0.6 ? 0 : 1] : PAL.bad, alpha: 0.7 }); void c; }
  }

  function update(nowMs, dt) {
    if (disposed) return; dt = clamp(dt || 0, 0, 0.1); clock += dt; TIME.value = ((nowMs || 0) / 1000) % 1000;
    for (const ev of events.values()) { ev.age += dt; for (const f of ev.fx) f(ev.age, dt); if ((!ev.persist && ev.age >= ev.dur) || (ev.closing >= 0 && ev.age >= ev.closing)) kill(ev.key); }
    for (const [k, t] of recent) if (t < clock) recent.delete(k);
    updateReticle(dt); pools.forEach((p) => p.update(dt));
  }
  function stats() {
    const live = { dust: dust.live(), glow: glow.live(), shards: shards.live(), leaves: leaves.live() };
    return { events: events.size, maxEvents: MAX_EVENTS, warnings: warns.size, ribbons: [...events.values()].reduce((n, e) => n + e.rib.length, 0) + ret.paths.length, particles: { ...live, total: live.dust + live.glow + live.shards + live.leaves, budget: 512 }, pooledMaterials: cache.size, reticle: !!ret.want, recent: recent.size };
  }
  function dispose() {
    if (disposed) return; disposed = true; for (const k of [...events.keys()]) kill(k); clearRet(); pools.forEach((p) => p.dispose()); shards.mesh.material.dispose(); leaves.mesh.material.dispose();
    Object.values(G).forEach((g) => g.dispose()); cache.forEach((m) => m.dispose()); cache.clear(); tex.dispose(); scene.remove(root); events.clear(); recent.clear(); warns.clear(); launched.clear();
  }
  return { setTarget, play, update, sync, dispose, stats, prepareShaders };
}
